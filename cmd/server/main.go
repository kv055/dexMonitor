package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	_ "modernc.org/sqlite"
)

var (
	dbPath              string
	snapshotIntervalMin int
	frontendDir         string
	db                  *sql.DB
)

func init() {
	dbPath = os.Getenv("DB_PATH")
	if dbPath == "" {
		dbPath = "/home/claudio_clawd_bot/orderbook/orderbook.db"
	}
	interval := os.Getenv("SNAPSHOT_INTERVAL_MIN")
	if interval == "" {
		snapshotIntervalMin = 15
	} else {
		v, err := strconv.Atoi(interval)
		if err != nil {
			snapshotIntervalMin = 15
		} else {
			snapshotIntervalMin = v
		}
	}

	exe, _ := os.Executable()
	frontendDir = filepath.Join(filepath.Dir(exe), "react-frontend", "dist")
	if dir := os.Getenv("FRONTEND_DIR"); dir != "" {
		frontendDir = dir
	}
}

func main() {
	var err error
	db, err = sql.Open("sqlite", dbPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)

	mux := http.NewServeMux()

	// Static frontend
	mux.HandleFunc("GET /", serveFrontend)
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", http.FileServer(http.Dir(filepath.Join(frontendDir, "assets")))))

	// API
	mux.HandleFunc("GET /api/offers", handleOffers)
	mux.HandleFunc("GET /api/premium_offers", handlePremiumOffers)
	mux.HandleFunc("GET /api/stats", handleStats)
	mux.HandleFunc("GET /api/ohlc", handleOHLC)
	mux.HandleFunc("GET /api/snapshot-log", handleSnapshotLog)
	mux.HandleFunc("GET /health", handleHealth)

	handler := corsMiddleware(mux)

	fmt.Println("Starting orderbook API server on http://127.0.0.1:5000")
	if err := http.ListenAndServe(":5000", handler); err != nil {
		fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		os.Exit(1)
	}
}

// --- Middleware ---

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// --- Handlers ---

func serveFrontend(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
}

func handleOffers(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 1000)

	rows, err := db.Query("SELECT * FROM offers ORDER BY last_seen DESC LIMIT ?", limit)
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()

	offers, err := scanOffers(rows)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, offers)
}

func handlePremiumOffers(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 1000)
	hours := queryIntPtr(r, "hours")

	var rows *sql.Rows
	var err error

	if hours != nil {
		rows, err = db.Query(`
			SELECT * FROM offers
			WHERE ((direction = 'sell' AND price < ref_price)
			   OR  (direction = 'buy'  AND price > ref_price))
			  AND last_seen >= datetime('now', ?)
			ORDER BY price_diff_percent DESC
			LIMIT ?
		`, fmt.Sprintf("-%d hours", *hours), limit)
	} else {
		rows, err = db.Query(`
			SELECT * FROM offers
			WHERE (direction = 'sell' AND price < ref_price)
			   OR (direction = 'buy'  AND price > ref_price)
			ORDER BY price_diff_percent DESC
			LIMIT ?
		`, limit)
	}
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()

	offers, err := scanOffers(rows)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, offers)
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	hours := queryInt(r, "hours", 24)
	hoursArg := fmt.Sprintf("-%d hours", hours)

	// Price stats
	priceRows, err := db.Query(`
		SELECT exchange, COUNT(*) as snapshot_count,
		       MIN(btc_price) as min_price, MAX(btc_price) as max_price, AVG(btc_price) as avg_price
		FROM snapshots
		WHERE timestamp >= datetime('now', ?)
		GROUP BY exchange
	`, hoursArg)
	if err != nil {
		writeError(w, err)
		return
	}
	defer priceRows.Close()

	var priceStats []map[string]any
	for priceRows.Next() {
		var exchange string
		var count int
		var minP, maxP, avgP float64
		if err := priceRows.Scan(&exchange, &count, &minP, &maxP, &avgP); err != nil {
			writeError(w, err)
			return
		}
		priceStats = append(priceStats, map[string]any{
			"exchange":       exchange,
			"snapshot_count": count,
			"min_price":      minP,
			"max_price":      maxP,
			"avg_price":      avgP,
		})
	}

	// Offer counts
	countRows, err := db.Query(`
		SELECT exchange, COUNT(*) as offer_count
		FROM offers
		WHERE last_seen >= datetime('now', ?)
		GROUP BY exchange
	`, hoursArg)
	if err != nil {
		writeError(w, err)
		return
	}
	defer countRows.Close()

	var offerCounts []map[string]any
	for countRows.Next() {
		var exchange string
		var count int
		if err := countRows.Scan(&exchange, &count); err != nil {
			writeError(w, err)
			return
		}
		offerCounts = append(offerCounts, map[string]any{
			"exchange":    exchange,
			"offer_count": count,
		})
	}

	writeJSON(w, map[string]any{
		"price_stats":  priceStats,
		"offer_counts": offerCounts,
		"hours":        hours,
	})
}

func handleOHLC(w http.ResponseWriter, r *http.Request) {
	hours := queryInt(r, "hours", 24)

	// Fetch Kraken OHLC
	candles := fetchKrakenOHLC(hours)

	// Fetch offers from DB
	rows, err := db.Query(`
		SELECT price, price_diff_percent, payment_method, exchange, direction, first_seen
		FROM offers
		WHERE last_seen >= datetime('now', ?)
		  AND ((direction = 'sell' AND price <= ref_price)
		    OR (direction = 'buy' AND price >= ref_price))
	`, fmt.Sprintf("-%d hours", hours))
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()

	var offers []map[string]any
	for rows.Next() {
		var price, premium float64
		var paymentMethod, exchange, direction, firstSeen string
		if err := rows.Scan(&price, &premium, &paymentMethod, &exchange, &direction, &firstSeen); err != nil {
			writeError(w, err)
			return
		}
		offers = append(offers, map[string]any{
			"time":           firstSeen,
			"price":          price,
			"premium":        premium,
			"exchange":       exchange,
			"direction":      direction,
			"payment_method": paymentMethod,
		})
	}

	writeJSON(w, map[string]any{
		"candles":      candles,
		"offers":       offers,
		"interval_min": snapshotIntervalMin,
	})
}

func handleSnapshotLog(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 50)

	rows, err := db.Query(
		"SELECT id, timestamp, exchanges, offers_count FROM snapshot_log ORDER BY timestamp DESC LIMIT ?",
		limit,
	)
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()

	var result []map[string]any
	for rows.Next() {
		var id, offersCount int
		var ts, exchangesJSON string
		if err := rows.Scan(&id, &ts, &exchangesJSON, &offersCount); err != nil {
			writeError(w, err)
			return
		}
		var exchanges any
		json.Unmarshal([]byte(exchangesJSON), &exchanges)
		result = append(result, map[string]any{
			"id":           id,
			"timestamp":    ts,
			"exchanges":    exchanges,
			"offers_count": offersCount,
		})
	}

	writeJSON(w, result)
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{
		"status":    "ok",
		"timestamp": time.Now().UTC().Format("2006-01-02T15:04:05"),
	})
}

// --- Kraken OHLC ---

func fetchKrakenOHLC(hours int) []map[string]any {
	client := &http.Client{Timeout: 15 * time.Second}
	url := fmt.Sprintf("https://api.kraken.com/0/public/OHLC?pair=XBTEUR&interval=%d", snapshotIntervalMin)

	resp, err := client.Get(url)
	if err != nil {
		fmt.Printf("[OHLC] Kraken error: %v\n", err)
		return nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("[OHLC] read error: %v\n", err)
		return nil
	}

	var data struct {
		Result map[string]json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		fmt.Printf("[OHLC] parse error: %v\n", err)
		return nil
	}

	cutoff := float64(time.Now().UTC().Unix() - int64(hours*3600))
	var candles []map[string]any

	for key, raw := range data.Result {
		if key == "last" {
			continue
		}
		var ohlcData [][]json.RawMessage
		if err := json.Unmarshal(raw, &ohlcData); err != nil {
			continue
		}
		for _, c := range ohlcData {
			if len(c) < 5 {
				continue
			}
			var ts float64
			json.Unmarshal(c[0], &ts)
			if ts < cutoff {
				continue
			}
			var open, high, low, close string
			json.Unmarshal(c[1], &open)
			json.Unmarshal(c[2], &high)
			json.Unmarshal(c[3], &low)
			json.Unmarshal(c[4], &close)

			candles = append(candles, map[string]any{
				"time":  time.Unix(int64(ts), 0).UTC().Format("2006-01-02T15:04:05"),
				"open":  parseFloat(open),
				"high":  parseFloat(high),
				"low":   parseFloat(low),
				"close": parseFloat(close),
			})
		}
		break // only process the first non-"last" key
	}
	return candles
}

// --- Helpers ---

func scanOffers(rows *sql.Rows) ([]map[string]any, error) {
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	var result []map[string]any
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := make(map[string]any, len(cols))
		for i, col := range cols {
			row[col] = values[i]
		}
		result = append(result, row)
	}
	return result, nil
}

func queryInt(r *http.Request, key string, defaultVal int) int {
	s := r.URL.Query().Get(key)
	if s == "" {
		return defaultVal
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return defaultVal
	}
	return v
}

func queryIntPtr(r *http.Request, key string) *int {
	s := r.URL.Query().Get(key)
	if s == "" {
		return nil
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return nil
	}
	return &v
}

func parseFloat(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

func writeJSON(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, err error) {
	http.Error(w, err.Error(), http.StatusInternalServerError)
}
