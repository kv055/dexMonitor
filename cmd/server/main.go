package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"dexmonitor/internal/pastorders"

	gorillaws "github.com/gorilla/websocket"
	_ "modernc.org/sqlite"
)

var (
	dbPath              string
	snapshotIntervalMin int
	frontendDir         string
	mmControllerAPIURL  string
	db                  *sql.DB
)

var (
	cexPricesMu sync.RWMutex
	cexPrices   = map[string]float64{}
)

// defaultCEX and defaultCEXPair define the default exchange and trading pair.
const (
	defaultCEX     = "kraken"
	defaultCEXPair = "BTC/EUR"
)

// supportedCEXes lists all exchanges available for selection in the UI.
var supportedCEXes = []string{"kraken", "binance", "bitstamp", "coinbase"}

var tradeCostEstimators map[string]*TradeCostEstimator
var tradeRouteOptimizer *TradeRouteOptimizer

// seedHubFromDB loads is_live=1 offers from the DB into the hub once at startup
// so live data is available before the first snapshot push arrives.
func seedHubFromDB() {
	rows, err := db.Query(`
		SELECT id, exchange, direction, price, btc_min, btc_max,
		       fiat_min, fiat_max, payment_method, offer_id, first_seen, last_seen, price_type
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
		var paymentMethod, offerID, priceType sql.NullString
		if err := rows.Scan(
			&o.ID, &o.Exchange, &o.Direction, &o.Price,
			&btcMin, &btcMax, &fiatMin, &fiatMax,
			&paymentMethod, &offerID, &o.FirstSeen, &o.LastSeen, &priceType,
		); err != nil {
			continue
		}
		if btcMin.Valid {
			o.BTCMin = &btcMin.Float64
		}
		if btcMax.Valid {
			o.BTCMax = &btcMax.Float64
		}
		if fiatMin.Valid {
			o.FiatMin = &fiatMin.Int64
		}
		if fiatMax.Valid {
			o.FiatMax = &fiatMax.Int64
		}
		if paymentMethod.Valid {
			o.PaymentMethod = &paymentMethod.String
		}
		if offerID.Valid {
			o.OfferID = &offerID.String
		}
		if priceType.Valid {
			o.PriceType = &priceType.String
		}
		offers = append(offers, o)
	}
	hub.setOffers(offers)
	fmt.Printf("[Hub] seeded %d live offers from DB\n", len(offers))
}

func getCexPrice(cex string) float64 {
	cexPricesMu.RLock()
	defer cexPricesMu.RUnlock()
	return cexPrices[cex]
}

func setCexPrice(cex string, p float64) {
	cexPricesMu.Lock()
	cexPrices[cex] = p
	cexPricesMu.Unlock()
	hub.broadcastForCex(cex)
}

// --- CEX WebSocket price feeds ---

// runCexPriceFeed starts a reconnecting price feed for the given exchange.
func runCexPriceFeed(ctx context.Context, cex string) {
	backoff := time.Second
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		var err error
		switch cex {
		case "kraken":
			err = runKrakenFeed(ctx, cex)
		case "binance":
			err = runBinanceFeed(ctx, cex)
		case "bitstamp":
			err = runBitstampFeed(ctx, cex)
		case "coinbase":
			err = runCoinbaseFeed(ctx, cex)
		default:
			return
		}

		if err != nil {
			fmt.Printf("[%sFeed] error: %v, retrying in %s\n", cex, err, backoff)
		}
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return
		}
		if backoff < 30*time.Second {
			backoff *= 2
		} else {
			backoff = time.Second
		}
	}
}

func runKrakenFeed(ctx context.Context, cex string) error {
	ws, _, err := gorillaws.DefaultDialer.DialContext(ctx, "wss://ws.kraken.com/v2", nil)
	if err != nil {
		return err
	}
	defer ws.Close()
	fmt.Printf("[%sFeed] connected\n", cex)

	sub := fmt.Sprintf(`{"method":"subscribe","params":{"channel":"ticker","symbol":["%s"]}}`, defaultCEXPair)
	if err := ws.WriteMessage(gorillaws.TextMessage, []byte(sub)); err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		_, msgBytes, err := ws.ReadMessage()
		if err != nil {
			return err
		}
		var envelope struct {
			Channel string `json:"channel"`
			Data    []struct {
				Last float64 `json:"last"`
			} `json:"data"`
		}
		if json.Unmarshal(msgBytes, &envelope) == nil &&
			envelope.Channel == "ticker" && len(envelope.Data) > 0 && envelope.Data[0].Last > 0 {
			setCexPrice(cex, envelope.Data[0].Last)
		}
	}
}

func runBinanceFeed(ctx context.Context, cex string) error {
	// BTC/EUR miniTicker stream — symbol must be lowercase for stream URL
	ws, _, err := gorillaws.DefaultDialer.DialContext(ctx, "wss://stream.binance.com:9443/ws/btceur@miniTicker", nil)
	if err != nil {
		return err
	}
	defer ws.Close()
	fmt.Printf("[%sFeed] connected\n", cex)

	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		_, msgBytes, err := ws.ReadMessage()
		if err != nil {
			return err
		}
		var msg struct {
			EventType string `json:"e"`
			Close     string `json:"c"` // last price
		}
		if json.Unmarshal(msgBytes, &msg) == nil && msg.EventType == "24hrMiniTicker" {
			if p, err := strconv.ParseFloat(msg.Close, 64); err == nil && p > 0 {
				setCexPrice(cex, p)
			}
		}
	}
}

func runBitstampFeed(ctx context.Context, cex string) error {
	ws, _, err := gorillaws.DefaultDialer.DialContext(ctx, "wss://ws.bitstamp.net", nil)
	if err != nil {
		return err
	}
	defer ws.Close()
	fmt.Printf("[%sFeed] connected\n", cex)

	sub := `{"event":"bts:subscribe","data":{"channel":"live_trades_btceur"}}`
	if err := ws.WriteMessage(gorillaws.TextMessage, []byte(sub)); err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		_, msgBytes, err := ws.ReadMessage()
		if err != nil {
			return err
		}
		var msg struct {
			Event   string `json:"event"`
			Channel string `json:"channel"`
			Data    struct {
				Price float64 `json:"price"`
			} `json:"data"`
		}
		if json.Unmarshal(msgBytes, &msg) == nil &&
			msg.Event == "trade" && msg.Data.Price > 0 {
			setCexPrice(cex, msg.Data.Price)
		}
	}
}

func runCoinbaseFeed(ctx context.Context, cex string) error {
	ws, _, err := gorillaws.DefaultDialer.DialContext(ctx, "wss://advanced-trade-ws.coinbase.com", nil)
	if err != nil {
		return err
	}
	defer ws.Close()
	fmt.Printf("[%sFeed] connected\n", cex)

	sub := `{"type":"subscribe","product_ids":["BTC-EUR"],"channel":"ticker"}`
	if err := ws.WriteMessage(gorillaws.TextMessage, []byte(sub)); err != nil {
		return err
	}
	for {
		select {
		case <-ctx.Done():
			return nil
		default:
		}
		_, msgBytes, err := ws.ReadMessage()
		if err != nil {
			return err
		}
		var msg struct {
			Channel string `json:"channel"`
			Events  []struct {
				Tickers []struct {
					Price string `json:"price"`
				} `json:"tickers"`
			} `json:"events"`
		}
		if json.Unmarshal(msgBytes, &msg) == nil && msg.Channel == "ticker" {
			for _, ev := range msg.Events {
				for _, t := range ev.Tickers {
					if p, err := strconv.ParseFloat(t.Price, 64); err == nil && p > 0 {
						setCexPrice(cex, p)
					}
				}
			}
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
		snapshotIntervalMin = 1
	} else {
		v, err := strconv.Atoi(interval)
		if err != nil {
			snapshotIntervalMin = 1
		} else {
			snapshotIntervalMin = v
		}
	}

	exe, _ := os.Executable()
	frontendDir = filepath.Join(filepath.Dir(exe), "react-frontend", "dist")
	if dir := os.Getenv("FRONTEND_DIR"); dir != "" {
		frontendDir = dir
	}

	mmControllerAPIURL = os.Getenv("MM_CONTROLLER_API_URL")
	if mmControllerAPIURL == "" {
		mmControllerAPIURL = "http://localhost:5001"
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

	tradeCostEstimators = make(map[string]*TradeCostEstimator, len(supportedCEXes))
	for _, c := range supportedCEXes {
		tradeCostEstimators[c] = NewTradeCostEstimator(c)
		fmt.Printf("[TradeCost] initialized %s (taker fallback %.2f%%, onchain withdrawal fallback %.8f BTC)\n",
			c, takerFeeFallbacks[c]*100, withdrawalFallbacks[c][MethodOnchain])
	}
	tradeRouteOptimizer = NewTradeRouteOptimizer(tradeCostEstimators)

	// Schema initialization (idempotent — safe to run on every startup)
	for _, stmt := range []string{
		`CREATE TABLE IF NOT EXISTS snapshots (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
			exchange TEXT NOT NULL,
			fiat_currency TEXT NOT NULL,
			direction TEXT NOT NULL,
			btc_price REAL NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS offers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			exchange TEXT NOT NULL,
			direction TEXT NOT NULL,
			price REAL NOT NULL,
			price_diff_percent REAL,
			btc_min REAL,
			btc_max REAL,
			fiat_min INTEGER,
			fiat_max INTEGER,
			payment_method TEXT,
			offer_id TEXT,
			ref_price REAL,
			first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
			is_live BOOLEAN NOT NULL DEFAULT 0,
			duration INTEGER,
			historical_analysis_status TEXT,
			avg_ref_price REAL,
			avg_premium_pct REAL,
			avg_trade_cost_pct REAL,
			avg_trade_cost_btc REAL,
			avg_net_premium_pct REAL,
			avg_estimated_profit_btc REAL,
			avg_estimated_profit_fiat REAL,
			avg_btc_amount REAL,
			price_type TEXT,
			best_route_cex TEXT,
			best_route_method TEXT
		)`,
		`CREATE TABLE IF NOT EXISTS order_lifecycle (
			id               INTEGER PRIMARY KEY AUTOINCREMENT,
			offer_db_id      INTEGER NOT NULL,
			snapshot_time    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			price            REAL    NOT NULL,
			ref_price        REAL    NOT NULL,
			premium_pct      REAL    NOT NULL,
			trade_cost_pct   REAL,
			trade_cost_btc   REAL,
			net_premium_pct  REAL,
			net_premium_btc  REAL,
			btc_amount       REAL
		)`,
		`CREATE TABLE IF NOT EXISTS snapshot_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
			exchanges TEXT NOT NULL,
			offers_count INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS kraken_ohlc (
			time  DATETIME PRIMARY KEY,
			open  REAL NOT NULL,
			high  REAL NOT NULL,
			low   REAL NOT NULL,
			close REAL NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_snapshots_time ON snapshots(timestamp)`,
		`CREATE INDEX IF NOT EXISTS idx_snapshots_exchange ON snapshots(exchange)`,
		`CREATE INDEX IF NOT EXISTS idx_offers_exchange ON offers(exchange)`,
		`CREATE INDEX IF NOT EXISTS idx_offers_direction ON offers(direction)`,
		`CREATE INDEX IF NOT EXISTS idx_offers_last_seen ON offers(last_seen)`,
		`CREATE INDEX IF NOT EXISTS idx_offers_fingerprint ON offers(exchange, direction, price, btc_min, btc_max, payment_method)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_offers_offer_id ON offers(offer_id) WHERE offer_id IS NOT NULL`,
		`CREATE INDEX IF NOT EXISTS idx_lifecycle_offer ON order_lifecycle(offer_db_id)`,
		`CREATE INDEX IF NOT EXISTS idx_lifecycle_time  ON order_lifecycle(snapshot_time)`,
	} {
		if _, err := db.Exec(stmt); err != nil {
			fmt.Fprintf(os.Stderr, "schema init error: %v\n", err)
		}
	}

	// Migrations (for databases created before schema versioning)
	db.Exec("ALTER TABLE offers ADD COLUMN is_live BOOLEAN NOT NULL DEFAULT 0")
	db.Exec("ALTER TABLE offers ADD COLUMN duration INTEGER")
	db.Exec("ALTER TABLE offers ADD COLUMN historical_analysis_status TEXT")
	db.Exec("ALTER TABLE offers ADD COLUMN price_type TEXT")
	db.Exec("ALTER TABLE offers ADD COLUMN best_route_cex TEXT")
	db.Exec("ALTER TABLE offers ADD COLUMN best_route_method TEXT")
	// Clean lifecycle-based analysis columns (replace _10m variants)
	db.Exec("ALTER TABLE offers ADD COLUMN avg_ref_price REAL")
	db.Exec("ALTER TABLE offers ADD COLUMN avg_premium_pct REAL")
	db.Exec("ALTER TABLE offers ADD COLUMN avg_trade_cost_pct REAL")
	db.Exec("ALTER TABLE offers ADD COLUMN avg_trade_cost_btc REAL")
	db.Exec("ALTER TABLE offers ADD COLUMN avg_net_premium_pct REAL")
	db.Exec("ALTER TABLE offers ADD COLUMN avg_estimated_profit_btc REAL")
	db.Exec("ALTER TABLE offers ADD COLUMN avg_estimated_profit_fiat REAL")
	db.Exec("ALTER TABLE offers ADD COLUMN avg_btc_amount REAL")
	// Drop obsolete 10-minute-window columns (SQLite 3.35+ / modernc.org/sqlite v1.48)
	db.Exec("ALTER TABLE offers DROP COLUMN avg_ref_price_10m")
	db.Exec("ALTER TABLE offers DROP COLUMN avg_premium_10m_pct")
	db.Exec("ALTER TABLE offers DROP COLUMN avg_trade_cost_pct_10m")
	db.Exec("ALTER TABLE offers DROP COLUMN avg_trade_cost_btc_10m")
	db.Exec("ALTER TABLE offers DROP COLUMN avg_net_premium_10m_pct")
	db.Exec("ALTER TABLE offers DROP COLUMN avg_estimated_profit_btc_10m")
	db.Exec("ALTER TABLE offers DROP COLUMN avg_estimated_profit_fiat_10m")
	db.Exec("ALTER TABLE offers DROP COLUMN avg_btc_amount_10m")
	db.Exec("ALTER TABLE offers DROP COLUMN best_route_cex_10m")
	db.Exec("ALTER TABLE offers DROP COLUMN best_route_method_10m")

	// Seed hub from DB in the background — computing trade costs makes outbound
	// HTTP requests (mempool.space, exchange APIs) that must not block startup.
	go seedHubFromDB()

	// Start WebSocket price feeds for all supported CEX exchanges
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for _, c := range supportedCEXes {
		go runCexPriceFeed(ctx, c)
	}

	mux := http.NewServeMux()

	// Static frontend
	mux.HandleFunc("GET /", serveFrontend)
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", http.FileServer(http.Dir(filepath.Join(frontendDir, "assets")))))

	// API
	mux.HandleFunc("GET /api/past_offers", handlePastOffers)
	mux.HandleFunc("GET /api/past_order_stats", handlePastOrderStats)
	mux.HandleFunc("GET /api/general_stats", handleGeneralStats)
	mux.HandleFunc("GET /api/live_offers", handleLiveOffersREST)
	mux.HandleFunc("GET /ws/live_offers", handleLiveOffersWS)
	mux.HandleFunc("GET /api/stats", handleStats)
	mux.HandleFunc("GET /api/ohlc", handleOHLC)
	mux.HandleFunc("GET /api/snapshot-log", handleSnapshotLog)
	mux.HandleFunc("GET /api/mm-controller/transactions", handleMmControllerTransactions)
	mux.HandleFunc("GET /api/mm-controller/transactions/{id}", handleMmControllerTransactionByID)
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
// Accepts optional ?cex= query param (default: "kraken").
func handleLiveOffersREST(w http.ResponseWriter, r *http.Request) {
	cex := queryCex(r)
	payload := hub.computePayload(getCexPrice(cex), cex)
	if payload == nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(payload)
}

// handlePastOffers serves closed offers (is_live=0) from the DB.
// Costing uses the cheapest available CEX→DEX route for each premium offer.
func handlePastOffers(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 1000)
	hours := queryInt(r, "hours", 24)
	hoursArg := fmt.Sprintf("-%d hours", hours)
	excludedPaymentMethods := queryExcludedPaymentMethods(r)

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

	filtered := make([]map[string]any, 0, len(offers))
	for _, o := range offers {
		if isPaymentMethodExcluded(offerString(o, "payment_method"), excludedPaymentMethods) {
			continue
		}
		addPastOfferCostFields(o)
		filtered = append(filtered, o)
	}

	// Embed lifecycle price history for chart visualization.
	ids := make([]int64, 0, len(filtered))
	for _, o := range filtered {
		ids = append(ids, int64(offerFloat(o, "id")))
	}
	lifecycle := fetchOfferLifecycle(ids)
	for _, o := range filtered {
		id := int64(offerFloat(o, "id"))
		if pts, ok := lifecycle[id]; ok {
			o["lifecycle"] = pts
		}
	}

	writeJSON(w, filtered)
}

// fetchOfferLifecycle returns lifecycle (snapshot_time, price) points grouped by offer_db_id.
func fetchOfferLifecycle(ids []int64) map[int64][]map[string]any {
	result := make(map[int64][]map[string]any, len(ids))
	if len(ids) == 0 {
		return result
	}
	placeholders := strings.Repeat("?,", len(ids))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	rows, err := db.Query(fmt.Sprintf(
		`SELECT offer_db_id, snapshot_time, price FROM order_lifecycle WHERE offer_db_id IN (%s) ORDER BY offer_db_id, snapshot_time`,
		placeholders,
	), args...)
	if err != nil {
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var offerID int64
		var snapTime string
		var price float64
		if err := rows.Scan(&offerID, &snapTime, &price); err != nil {
			continue
		}
		result[offerID] = append(result[offerID], map[string]any{
			"time":  snapTime,
			"price": price,
		})
	}
	return result
}

func handlePastOrderStats(w http.ResponseWriter, r *http.Request) {
	excludedPaymentMethods := queryExcludedPaymentMethods(r)
	fiatCurrency := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("fiat")))
	if fiatCurrency == "" {
		fiatCurrency = "EUR"
	}

	rows, err := db.Query(
		"SELECT * FROM offers WHERE is_live = 0 AND last_seen >= datetime('now', ?) ORDER BY last_seen DESC",
		"-168 hours",
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

	premiumOrders := make([]pastorders.PremiumOrder, 0, len(offers))
	for _, o := range offers {
		analysis := addPastOfferCostFields(o)
		if !analysis.isPremium {
			continue
		}
		premiumOrders = append(premiumOrders, pastorders.PremiumOrder{
			PaymentMethod: offerString(o, "payment_method"),
			LastSeen:      parseDBTime(offerString(o, "last_seen")),
			BTCAmount:     analysis.btcSize,
			NetProfitBTC:  analysis.estimatedProfitBTC,
			NetProfitFiat: analysis.estimatedProfitBTC * analysis.refPrice,
		})
	}

	writeJSON(w, pastorders.BuildStats(premiumOrders, time.Now(), fiatCurrency, excludedPaymentMethods))
}

func handleGeneralStats(w http.ResponseWriter, r *http.Request) {
	hours := queryInt(r, "hours", 24)
	historyHours := hours
	if historyHours < 168 {
		historyHours = 168
	}
	hoursArg := fmt.Sprintf("-%d hours", historyHours)
	excludedPaymentMethods := queryExcludedPaymentMethods(r)

	rows, err := db.Query(
		"SELECT * FROM offers WHERE last_seen >= datetime('now', ?) ORDER BY last_seen DESC",
		hoursArg,
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

	generalOffers := make([]pastorders.Offer, 0, len(offers))
	for _, o := range offers {
		direction := offerString(o, "direction")
		price := offerFloat(o, "price")
		refPrice := offerFloat(o, "ref_price")
		priceDiff := computeDirectionalPremiumPct(direction, price, refPrice)
		var priceDiffPtr *float64
		if refPrice > 0 {
			priceDiffPtr = &priceDiff
		}
		generalOffers = append(generalOffers, pastorders.Offer{
			Exchange:         offerString(o, "exchange"),
			Direction:        direction,
			PaymentMethod:    offerString(o, "payment_method"),
			PriceDiffPercent: priceDiffPtr,
			FirstSeen:        parseDBTime(offerString(o, "first_seen")),
			LastSeen:         parseDBTime(offerString(o, "last_seen")),
			IsLive:           offerBool(o, "is_live"),
		})
	}

	writeJSON(w, pastorders.BuildGeneralStats(generalOffers, time.Now(), hours, excludedPaymentMethods))
}

type pastOfferAnalysis struct {
	isPremium          bool
	btcSize            float64
	refPrice           float64
	estimatedProfitBTC float64
}

func addPastOfferCostFields(o map[string]any) pastOfferAnalysis {
	dexExchange := offerString(o, "exchange")
	direction := offerString(o, "direction")
	price := offerFloat(o, "price")
	refPrice := offerFloat(o, "ref_price")
	priceDiff := computeDirectionalPremiumPct(direction, price, refPrice)
	if refPrice > 0 {
		o["price_diff_percent"] = priceDiff
	}

	var btcMaxPtr, btcMinPtr *float64
	if v := offerFloat(o, "btc_max"); v > 0 {
		btcMaxPtr = &v
	}
	if v := offerFloat(o, "btc_min"); v > 0 {
		btcMinPtr = &v
	}

	btcSize := selectBTCTradeSize(btcMaxPtr, btcMinPtr)
	tradeCostPct, netPremium, bd := computeNetPremiumFields(priceDiff, btcSize, dexExchange)

	o["trade_cost_percent"] = tradeCostPct
	o["net_premium_percent"] = netPremium
	o["cost_breakdown"] = bd

	return pastOfferAnalysis{
		isPremium:          priceDiff > 0,
		btcSize:            btcSize,
		refPrice:           refPrice,
		estimatedProfitBTC: bd.EstimatedProfitBTC,
	}
}

// writeLifecycleEntries persists a computed snapshot of each live offer's
// metrics into order_lifecycle, and updates best_route_cex / best_route_method
// on the offers table when the optimizer found a valid route.
func writeLifecycleEntries(offers []liveOutOffer) {
	if len(offers) == 0 || db == nil {
		return
	}
	tx, err := db.Begin()
	if err != nil {
		fmt.Printf("[Lifecycle] begin tx error: %v\n", err)
		return
	}
	insStmt, err := tx.Prepare(`
		INSERT INTO order_lifecycle
			(offer_db_id, price, ref_price, premium_pct,
			 trade_cost_pct, trade_cost_btc, net_premium_pct, net_premium_btc, btc_amount)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		tx.Rollback()
		fmt.Printf("[Lifecycle] prepare insert error: %v\n", err)
		return
	}
	defer insStmt.Close()

	updStmt, err := tx.Prepare(`
		UPDATE offers SET best_route_cex = ?, best_route_method = ? WHERE id = ?
	`)
	if err != nil {
		tx.Rollback()
		fmt.Printf("[Lifecycle] prepare update error: %v\n", err)
		return
	}
	defer updStmt.Close()

	for _, o := range offers {
		if o.RefPrice <= 0 {
			continue
		}
		bd := o.CostBreakdown
		_, _ = insStmt.Exec(
			o.ID,
			round4(o.Price),
			round4(o.RefPrice),
			round4(o.PriceDiffPct),
			round4(bd.TotalCostPct),
			round8(bd.TotalCostBTC),
			round4(o.NetPremiumPct),
			round8(bd.EstimatedProfitBTC),
			round8(bd.BTCAmount),
		)
		if bd.RouteCEX != "" {
			_, _ = updStmt.Exec(bd.RouteCEX, bd.RouteMethod, o.ID)
		}
	}

	if err := tx.Commit(); err != nil {
		fmt.Printf("[Lifecycle] commit error: %v\n", err)
	}
}

// handleInternalLiveOffers receives the live offer list from the snapshot tool,
// updates the hub, and persists a lifecycle snapshot to the DB.
func handleInternalLiveOffers(w http.ResponseWriter, r *http.Request) {
	var offers []LiveOffer
	if err := json.NewDecoder(r.Body).Decode(&offers); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	hub.setOffers(offers)
	price := getCexPrice(defaultCEX)
	outOffers := hub.computeOutOffers(price, defaultCEX)
	go writeLifecycleEntries(outOffers)
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
	cex := queryCex(r)

	var candles []map[string]any
	switch cex {
	case "binance":
		candles = fetchBinanceOHLC(hours)
	case "bitstamp":
		candles = fetchBitstampOHLC(hours)
	case "coinbase":
		candles = fetchCoinbaseOHLC(hours)
	default:
		candles = fetchKrakenOHLC(hours)
	}

	rows, err := db.Query(`
		SELECT price, ref_price, payment_method, exchange, direction, first_seen
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
		var price, refPrice float64
		var paymentMethod, exchange, direction, firstSeen string
		if err := rows.Scan(&price, &refPrice, &paymentMethod, &exchange, &direction, &firstSeen); err != nil {
			writeError(w, err)
			return
		}
		premium := computeDirectionalPremiumPct(direction, price, refPrice)
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

func handleMmControllerTransactions(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/transactions")
}

func handleMmControllerTransactionByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if strings.TrimSpace(id) == "" {
		http.Error(w, "missing transaction id", http.StatusBadRequest)
		return
	}
	forwardMMControllerJSON(w, r, "/api/transactions/"+url.PathEscape(id))
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

func fetchBinanceOHLC(hours int) []map[string]any {
	// Binance interval must match snapshotIntervalMin; round to nearest supported value.
	interval := "15m"
	switch snapshotIntervalMin {
	case 1:
		interval = "1m"
	case 3:
		interval = "3m"
	case 5:
		interval = "5m"
	case 30:
		interval = "30m"
	case 60:
		interval = "1h"
	}
	startMs := (time.Now().UTC().Unix() - int64(hours*3600)) * 1000
	apiURL := fmt.Sprintf("https://api.binance.com/api/v3/klines?symbol=BTCEUR&interval=%s&limit=1000&startTime=%d", interval, startMs)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(apiURL)
	if err != nil {
		fmt.Printf("[OHLC] Binance error: %v\n", err)
		return nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}
	// Each entry: [open_time_ms, "open", "high", "low", "close", ...]
	var raw [][]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		fmt.Printf("[OHLC] Binance parse error: %v\n", err)
		return nil
	}

	candles := make([]map[string]any, 0, len(raw))
	for _, c := range raw {
		if len(c) < 5 {
			continue
		}
		var tsMs int64
		json.Unmarshal(c[0], &tsMs)
		var open, high, low, cls string
		json.Unmarshal(c[1], &open)
		json.Unmarshal(c[2], &high)
		json.Unmarshal(c[3], &low)
		json.Unmarshal(c[4], &cls)
		candles = append(candles, map[string]any{
			"time":  time.UnixMilli(tsMs).UTC().Format("2006-01-02T15:04:05"),
			"open":  parseFloat(open),
			"high":  parseFloat(high),
			"low":   parseFloat(low),
			"close": parseFloat(cls),
		})
	}
	return candles
}

func fetchBitstampOHLC(hours int) []map[string]any {
	step := snapshotIntervalMin * 60 // seconds
	start := time.Now().UTC().Unix() - int64(hours*3600)
	apiURL := fmt.Sprintf("https://www.bitstamp.net/api/v2/ohlc/btceur/?step=%d&limit=1000&start=%d", step, start)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(apiURL)
	if err != nil {
		fmt.Printf("[OHLC] Bitstamp error: %v\n", err)
		return nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}
	var result struct {
		Data struct {
			OHLC []struct {
				Timestamp string `json:"timestamp"`
				Open      string `json:"open"`
				High      string `json:"high"`
				Low       string `json:"low"`
				Close     string `json:"close"`
			} `json:"ohlc"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		fmt.Printf("[OHLC] Bitstamp parse error: %v\n", err)
		return nil
	}

	candles := make([]map[string]any, 0, len(result.Data.OHLC))
	for _, c := range result.Data.OHLC {
		ts, _ := strconv.ParseInt(c.Timestamp, 10, 64)
		candles = append(candles, map[string]any{
			"time":  time.Unix(ts, 0).UTC().Format("2006-01-02T15:04:05"),
			"open":  parseFloat(c.Open),
			"high":  parseFloat(c.High),
			"low":   parseFloat(c.Low),
			"close": parseFloat(c.Close),
		})
	}
	return candles
}

func fetchCoinbaseOHLC(hours int) []map[string]any {
	// Coinbase granularity in seconds; max 300 candles per request.
	gran := snapshotIntervalMin * 60
	end := time.Now().UTC()
	start := end.Add(-time.Duration(hours) * time.Hour)
	apiURL := fmt.Sprintf(
		"https://api.exchange.coinbase.com/products/BTC-EUR/candles?granularity=%d&start=%s&end=%s",
		gran,
		url.QueryEscape(start.Format(time.RFC3339)),
		url.QueryEscape(end.Format(time.RFC3339)),
	)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(apiURL)
	if err != nil {
		fmt.Printf("[OHLC] Coinbase error: %v\n", err)
		return nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}
	// Each entry: [time, low, high, open, close, volume]  (newest first)
	var raw [][]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		fmt.Printf("[OHLC] Coinbase parse error: %v\n", err)
		return nil
	}

	candles := make([]map[string]any, 0, len(raw))
	for i := len(raw) - 1; i >= 0; i-- { // reverse to chronological order
		c := raw[i]
		if len(c) < 5 {
			continue
		}
		var ts int64
		json.Unmarshal(c[0], &ts)
		var low, high, open, cls float64
		json.Unmarshal(c[1], &low)
		json.Unmarshal(c[2], &high)
		json.Unmarshal(c[3], &open)
		json.Unmarshal(c[4], &cls)
		candles = append(candles, map[string]any{
			"time":  time.Unix(ts, 0).UTC().Format("2006-01-02T15:04:05"),
			"open":  open,
			"high":  high,
			"low":   low,
			"close": cls,
		})
	}
	return candles
}

// --- Helpers ---

func parseDBTime(s string) time.Time {
	for _, layout := range []string{"2006-01-02T15:04:05Z", "2006-01-02T15:04:05", "2006-01-02 15:04:05"} {
		if t, err := time.ParseInLocation(layout, s, time.UTC); err == nil {
			return t.UTC()
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

// queryCex reads the ?cex= query param and validates it against supportedCEXes.
// Falls back to defaultCEX if missing or unrecognised.
func queryCex(r *http.Request) string {
	cex := r.URL.Query().Get("cex")
	if tradeCostEstimators[cex] != nil {
		return cex
	}
	return defaultCEX
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

func queryExcludedPaymentMethods(r *http.Request) []string {
	values := append([]string{}, r.URL.Query()["exclude_payment_methods"]...)
	values = append(values, r.URL.Query()["exclude_payment_method"]...)

	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, raw := range values {
		for _, part := range strings.Split(raw, ",") {
			method := strings.TrimSpace(part)
			if method == "" {
				continue
			}
			if _, ok := seen[method]; ok {
				continue
			}
			seen[method] = struct{}{}
			result = append(result, method)
		}
	}
	return result
}

func isPaymentMethodExcluded(method string, excluded []string) bool {
	for _, blocked := range excluded {
		if method == blocked {
			return true
		}
	}
	return false
}

func offerString(o map[string]any, key string) string {
	switch v := o[key].(type) {
	case string:
		return v
	case []byte:
		return string(v)
	case time.Time:
		return v.UTC().Format("2006-01-02 15:04:05")
	default:
		return ""
	}
}

func offerFloat(o map[string]any, key string) float64 {
	switch v := o[key].(type) {
	case float64:
		return v
	case int64:
		return float64(v)
	case int:
		return float64(v)
	case []byte:
		f, _ := strconv.ParseFloat(string(v), 64)
		return f
	case string:
		f, _ := strconv.ParseFloat(v, 64)
		return f
	default:
		return 0
	}
}

func offerBool(o map[string]any, key string) bool {
	switch v := o[key].(type) {
	case bool:
		return v
	case int64:
		return v != 0
	case int:
		return v != 0
	case []byte:
		return string(v) == "1" || strings.EqualFold(string(v), "true")
	case string:
		return v == "1" || strings.EqualFold(v, "true")
	default:
		return false
	}
}

func forwardMMControllerJSON(w http.ResponseWriter, r *http.Request, path string) {
	baseURL, err := url.Parse(mmControllerAPIURL)
	if err != nil {
		http.Error(w, "mm controller api url is invalid", http.StatusInternalServerError)
		return
	}

	targetURL, err := baseURL.Parse(path)
	if err != nil {
		http.Error(w, "failed to build mm controller request", http.StatusInternalServerError)
		return
	}
	targetURL.RawQuery = r.URL.RawQuery

	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, targetURL.String(), nil)
	if err != nil {
		http.Error(w, "failed to create mm controller request", http.StatusInternalServerError)
		return
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, fmt.Sprintf("mm controller request failed: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	if _, err := io.Copy(w, resp.Body); err != nil {
		fmt.Printf("[MMControllerProxy] copy error: %v\n", err)
	}
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
