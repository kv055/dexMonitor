package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	_ "modernc.org/sqlite"
	"golang.org/x/net/websocket"
)

var (
	dbPath              string
	snapshotIntervalMin int
	frontendDir         string
	db                  *sql.DB
)

var (
	krakPriceMu sync.RWMutex
	krakPrice   float64
)

var tradeCostEstimator *TradeCostEstimator

// seedHubFromDB loads is_live=1 offers from the DB into the hub once at startup
// so live data is available before the first snapshot push arrives.
func seedHubFromDB() {
	rows, err := db.Query(`
		SELECT id, exchange, direction, price, btc_min, btc_max,
		       fiat_min, fiat_max, payment_method, offer_id, first_seen, last_seen
		FROM offers WHERE is_live = 1
	`)
	if err != nil {
		fmt.Printf("[Hub] seed error: %v\n", err)
		return
	}
	defer rows.Close()

	offers := make([]LiveOffer, 0)
	for rows.Next() {
		var o LiveOffer
		var btcMin, btcMax sql.NullFloat64
		var fiatMin, fiatMax sql.NullInt64
		var paymentMethod, offerID sql.NullString
		if err := rows.Scan(
			&o.ID, &o.Exchange, &o.Direction, &o.Price,
			&btcMin, &btcMax, &fiatMin, &fiatMax,
			&paymentMethod, &offerID, &o.FirstSeen, &o.LastSeen,
		); err != nil {
			continue
		}
		if btcMin.Valid        { o.BTCMin = &btcMin.Float64 }
		if btcMax.Valid        { o.BTCMax = &btcMax.Float64 }
		if fiatMin.Valid       { o.FiatMin = &fiatMin.Int64 }
		if fiatMax.Valid       { o.FiatMax = &fiatMax.Int64 }
		if paymentMethod.Valid { o.PaymentMethod = &paymentMethod.String }
		if offerID.Valid       { o.OfferID = &offerID.String }
		offers = append(offers, o)
	}
	hub.setOffers(offers)
	fmt.Printf("[Hub] seeded %d live offers from DB\n", len(offers))
}

func getKrakenPrice() float64 {
	krakPriceMu.RLock()
	defer krakPriceMu.RUnlock()
	return krakPrice
}

func setKrakenPrice(p float64) {
	krakPriceMu.Lock()
	krakPrice = p
	krakPriceMu.Unlock()
	hub.broadcastNow()
}

// --- Kraken WebSocket price feed ---

func runKrakenPriceFeed(ctx context.Context) {
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		ws, err := websocket.Dial("wss://ws.kraken.com/v2", "", "https://ws.kraken.com")
		if err != nil {
			fmt.Printf("[KrakenWSS] connect error: %v, retrying in %s\n", err, backoff)
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				return
			}
			if backoff < 30*time.Second {
				backoff *= 2
			}
			continue
		}
		backoff = time.Second
		fmt.Println("[KrakenWSS] connected")

		sub := `{"method":"subscribe","params":{"channel":"ticker","symbol":["BTC/EUR"]}}`
		if err := websocket.Message.Send(ws, sub); err != nil {
			fmt.Printf("[KrakenWSS] subscribe error: %v\n", err)
			ws.Close()
			continue
		}

		for {
			var msg string
			if err := websocket.Message.Receive(ws, &msg); err != nil {
				fmt.Printf("[KrakenWSS] receive error: %v\n", err)
				ws.Close()
				break
			}
			var envelope struct {
				Channel string `json:"channel"`
				Data    []struct {
					Last float64 `json:"last"`
				} `json:"data"`
			}
			if err := json.Unmarshal([]byte(msg), &envelope); err != nil {
				continue
			}
			if envelope.Channel == "ticker" && len(envelope.Data) > 0 && envelope.Data[0].Last > 0 {
				setKrakenPrice(envelope.Data[0].Last)
			}
		}

		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return
		}
		if backoff < 30*time.Second {
			backoff *= 2
		}
	}
}

// --- Init & Main ---

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

	// Enable WAL mode for concurrent snapshot writes
	db.Exec("PRAGMA journal_mode=WAL")

	cex := os.Getenv("CEX_EXCHANGE")
	if cex == "" {
		cex = "kraken"
	}
	tradeCostEstimator = NewTradeCostEstimator(cex)
	fmt.Printf("[TradeCost] configured for %s (taker fallback %.2f%%, withdrawal fallback %.8f BTC — live fetch on first use)\n",
		cex, takerFeeFallbacks[cex]*100, withdrawalFallbacks[cex])

	// Migrations
	db.Exec("ALTER TABLE offers ADD COLUMN is_live BOOLEAN NOT NULL DEFAULT 0")
	db.Exec("ALTER TABLE offers ADD COLUMN duration INTEGER")
	db.Exec(`CREATE TABLE IF NOT EXISTS kraken_ohlc (
		time  DATETIME PRIMARY KEY,
		open  REAL NOT NULL,
		high  REAL NOT NULL,
		low   REAL NOT NULL,
		close REAL NOT NULL
	)`)

	// Seed hub from DB so live offers are available before the first snapshot push
	seedHubFromDB()

	// Start Kraken WebSocket price feed
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go runKrakenPriceFeed(ctx)

	mux := http.NewServeMux()

	// Static frontend
	mux.HandleFunc("GET /", serveFrontend)
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", http.FileServer(http.Dir(filepath.Join(frontendDir, "assets")))))

	// API
	mux.HandleFunc("GET /api/past_offers", handlePastOffers)
	mux.HandleFunc("GET /api/live_offers", handleLiveOffersREST)
	mux.Handle("GET /ws/live_offers", websocket.Server{
		Handshake: func(_ *websocket.Config, _ *http.Request) error { return nil },
		Handler:   handleLiveOffersWS,
	})
	mux.HandleFunc("GET /api/stats", handleStats)
	mux.HandleFunc("GET /api/ohlc", handleOHLC)
	mux.HandleFunc("GET /api/snapshot-log", handleSnapshotLog)
	mux.HandleFunc("GET /health", handleHealth)

	// Internal: snapshot tool pushes live offer data after each run
	mux.HandleFunc("POST /internal/live_offers", handleInternalLiveOffers)

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
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
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
	hours := queryInt(r, "hours", 24)
	hoursArg := fmt.Sprintf("-%d hours", hours)

	rows, err := db.Query(
		"SELECT * FROM offers WHERE last_seen >= datetime('now', ?) ORDER BY last_seen DESC LIMIT ?",
		hoursArg, limit,
	)
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

// handleLiveOffersREST is the REST fallback for /ws/live_offers.
// Returns the current in-memory live offers with premiums computed against
// the latest Kraken price. No filtering — client handles that.
func handleLiveOffersREST(w http.ResponseWriter, r *http.Request) {
	payload := hub.computePayload(getKrakenPrice())
	if payload == nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(payload)
}

// handlePastOffers serves closed offers (is_live=0) from the DB.
func handlePastOffers(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 1000)
	hours := queryInt(r, "hours", 24)
	hoursArg := fmt.Sprintf("-%d hours", hours)

	rows, err := db.Query(
		"SELECT * FROM offers WHERE is_live = 0 AND last_seen >= datetime('now', ?) ORDER BY last_seen DESC LIMIT ?",
		hoursArg, limit,
	)
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

// handleInternalLiveOffers receives the live offer list from the snapshot tool
// and updates the hub. No DB read needed — data comes directly from the source.
func handleInternalLiveOffers(w http.ResponseWriter, r *http.Request) {
	var offers []LiveOffer
	if err := json.NewDecoder(r.Body).Decode(&offers); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	hub.setOffers(offers)
	fmt.Printf("[LiveHub] updated with %d live offers from snapshot\n", len(offers))
	w.WriteHeader(http.StatusNoContent)
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	hours := queryInt(r, "hours", 24)
	hoursArg := fmt.Sprintf("-%d hours", hours)

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

	priceStats := make([]map[string]any, 0)
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

	offerCounts := make([]map[string]any, 0)
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

	candles := fetchKrakenOHLC(hours)

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

	offers := make([]map[string]any, 0)
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

	result := make([]map[string]any, 0)
	for rows.Next() {
		var id, offersCount int
		var ts, exchangesJSON string
		if err := rows.Scan(&id, &ts, &exchangesJSON, &offersCount); err != nil {
			writeError(w, err)
			return
		}
		exchanges := map[string]any{}
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

// --- Kraken OHLC (REST, for chart) ---

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
	candles := make([]map[string]any, 0)

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
		break
	}
	return candles
}

// --- Helpers ---

func parseDBTime(s string) time.Time {
	for _, layout := range []string{"2006-01-02T15:04:05Z", "2006-01-02T15:04:05", "2006-01-02 15:04:05"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t
		}
	}
	return time.Time{}
}

func scanOffers(rows *sql.Rows) ([]map[string]any, error) {
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	result := make([]map[string]any, 0)
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
