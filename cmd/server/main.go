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
	"dexmonitor/internal/paymentmethods"

	gorillaws "github.com/gorilla/websocket"
	_ "github.com/jackc/pgx/v5/stdlib"
)

var (
	databaseURL         string
	snapshotIntervalMin int
	frontendDir         string
	mmControllerAPIURL  string
	db                  *sql.DB
	pmService           *paymentmethods.Service
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
	const maxAttempts = 10
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		if !coreTablesReady() {
			fmt.Printf("[Hub] core tables not ready yet (attempt %d/%d)\n", attempt, maxAttempts)
			time.Sleep(3 * time.Second)
			continue
		}

		rows, err := db.Query(`
			SELECT id, exchange, direction, price, btc_min, btc_max,
			       fiat_min, fiat_max, payment_method, offer_id, first_seen, last_seen, price_type
			FROM offers WHERE is_live = TRUE
		`)
		if err != nil {
			fmt.Printf("[Hub] seed error (attempt %d/%d): %v\n", attempt, maxAttempts, err)
			time.Sleep(3 * time.Second)
			continue
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
		ids := make([]int64, len(offers))
		for i, o := range offers {
			ids[i] = o.ID
		}
		hub.setLifecycle(fetchOfferLifecycle(ids))
		hub.setOffers(offers)
		fmt.Printf("[Hub] seeded %d live offers from DB\n", len(offers))
		return
	}
	fmt.Printf("[Hub] giving up seeding after %d attempts\n", maxAttempts)
}

func coreTablesReady() bool {
	var count int
	if err := db.QueryRow(`
		SELECT COUNT(*) FROM information_schema.tables
		WHERE table_schema = 'public' AND table_name IN ('offers', 'snapshot_log')
	`).Scan(&count); err != nil {
		return false
	}
	return count == 2
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
	databaseURL = os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		databaseURL = "postgres://postgres:postgres@localhost:5432/dexarb?sslmode=disable"
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
	db, err = sql.Open("pgx", databaseURL)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open database: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()

	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(2)

	tradeCostEstimators = make(map[string]*TradeCostEstimator, len(supportedCEXes))
	for _, c := range supportedCEXes {
		tradeCostEstimators[c] = NewTradeCostEstimator(c)
		fmt.Printf("[TradeCost] initialized %s (taker fallback %.2f%%, onchain withdrawal fallback %.8f BTC)\n",
			c, takerFeeFallbacks[c]*100, withdrawalFallbacks[c][MethodOnchain])
	}
	tradeRouteOptimizer = NewTradeRouteOptimizer(tradeCostEstimators)

	// Seed hub from DB in the background — computing trade costs makes outbound
	// HTTP requests (mempool.space, exchange APIs) that must not block startup.
	go seedHubFromDB()

	// Start WebSocket price feeds for all supported CEX exchanges
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for _, c := range supportedCEXes {
		go runCexPriceFeed(ctx, c)
	}

	// Payment method grouping service — loads once at startup, refreshes every hour.
	if svc, err := paymentmethods.NewService(db); err != nil {
		fmt.Fprintf(os.Stderr, "paymentmethods init warning: %v\n", err)
	} else {
		pmService = svc
		go pmService.RefreshLoop(ctx, time.Hour)
	}

	mux := http.NewServeMux()

	// Static frontend
	mux.HandleFunc("GET /", serveFrontend)
	mux.Handle("GET /assets/", http.StripPrefix("/assets/", http.FileServer(http.Dir(filepath.Join(frontendDir, "assets")))))

	// API
	mux.HandleFunc("GET /api/past_offers", handlePastOffers)
	mux.HandleFunc("GET /api/past_offers/{id}/lifecycle", handlePastOfferLifecycle)
	mux.HandleFunc("GET /api/past_order_stats", handlePastOrderStats)
	mux.HandleFunc("GET /api/general_stats", handleGeneralStats)
	mux.HandleFunc("GET /api/live_offers", handleLiveOffersREST)
	mux.HandleFunc("GET /ws/live_offers", handleLiveOffersWS)
	mux.HandleFunc("GET /api/stats", handleStats)
	mux.HandleFunc("GET /api/ohlc", handleOHLC)
	mux.HandleFunc("GET /api/snapshot-log", handleSnapshotLog)
	mux.HandleFunc("GET /api/payment_method_groups", handlePaymentMethodGroups)
	mux.HandleFunc("GET /api/trade_cost_config", handleTradeCostConfig)
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
	cutoff := time.Now().Add(-time.Duration(hours) * time.Hour)

	rows, err := db.Query(
		rebind("SELECT * FROM offers WHERE last_seen >= ? ORDER BY last_seen DESC LIMIT ?"),
		cutoff, limit,
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
func handleLiveOffersREST(w http.ResponseWriter, r *http.Request) {
	sub := liveSubscription{
		cex:                   queryCex(r),
		requiredConfirmations: queryConfirmations(r),
		excludedCEXes:         strings.Join(queryExcludedCEXes(r), ","),
		feeTier:               queryFeeTier(r),
		coupledHedge:          queryCoupledHedge(r),
		maxFiatLimitEUR:       queryMaxFiatLimitEUR(r),
	}
	payload := hub.computePayload(getCexPrice(sub.cex), sub)
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
	cutoff := time.Now().Add(-time.Duration(hours) * time.Hour)
	excludedPaymentMethods := queryExcludedPaymentMethods(r)
	requiredConfirmations := queryConfirmations(r)
	excludedCEXes := queryExcludedCEXes(r)
	feeTier := queryFeeTier(r)

	rows, err := db.Query(
		rebind("SELECT * FROM offers WHERE is_live = FALSE AND last_seen >= ? ORDER BY last_seen DESC LIMIT ?"),
		cutoff, limit,
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
		addPastOfferCostFieldsFull(o, requiredConfirmations, excludedCEXes, feeTier, 0)
		filtered = append(filtered, o)
	}

	writeJSON(w, filtered)
}

func handlePastOfferLifecycle(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil || id <= 0 {
		http.Error(w, "invalid offer id", http.StatusBadRequest)
		return
	}

	lifecycle := fetchOfferLifecycle([]int64{id})
	points := lifecycle[id]
	if points == nil {
		points = []LifecyclePoint{}
	}
	writeJSON(w, points)
}

// fetchOfferLifecycle returns lifecycle (snapshot_time, price) points grouped by offer_db_id.
func fetchOfferLifecycle(ids []int64) map[int64][]LifecyclePoint {
	result := make(map[int64][]LifecyclePoint, len(ids))
	if len(ids) == 0 {
		return result
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	rows, err := db.Query(rebind(fmt.Sprintf(
		`SELECT offer_db_id, snapshot_time, price, net_premium_pct FROM order_lifecycle WHERE offer_db_id IN (%s) ORDER BY offer_db_id, snapshot_time`,
		strings.Join(placeholders, ","),
	)), args...)
	if err != nil {
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var offerID int64
		var snapTime time.Time
		var price float64
		var netPremiumPct sql.NullFloat64
		if err := rows.Scan(&offerID, &snapTime, &price, &netPremiumPct); err != nil {
			continue
		}
		pt := LifecyclePoint{Time: snapTime.UTC().Format("2006-01-02T15:04:05Z"), Price: price}
		if netPremiumPct.Valid {
			pt.NetPremiumPct = &netPremiumPct.Float64
		}
		result[offerID] = append(result[offerID], pt)
	}
	return result
}

func handlePastOrderStats(w http.ResponseWriter, r *http.Request) {
	excludedPaymentMethods := queryExcludedPaymentMethods(r)
	excludedCEXes := queryExcludedCEXes(r)
	requiredConfirmations := queryConfirmations(r)
	feeTier := r.URL.Query().Get("fee_tier")
	maxFiatLimitEUR := queryMaxFiatLimitEUR(r)
	fiatCurrency := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("fiat")))
	if fiatCurrency == "" {
		fiatCurrency = "EUR"
	}

	rows, err := db.Query(
		rebind("SELECT * FROM offers WHERE is_live = FALSE AND last_seen >= ? ORDER BY last_seen DESC"),
		time.Now().Add(-168*time.Hour),
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
		analysis := addPastOfferCostFieldsFull(o, requiredConfirmations, excludedCEXes, feeTier, maxFiatLimitEUR)
		if !analysis.isPremium {
			continue
		}
		premiumOrders = append(premiumOrders, pastorders.PremiumOrder{
			PaymentMethod:       offerString(o, "payment_method"),
			LastSeen:            parseDBTime(offerString(o, "last_seen")),
			BTCAmount:           analysis.btcSize,
			NetProfitBTC:        analysis.estimatedProfitBTC,
			NetProfitFiat:       analysis.estimatedProfitBTC * analysis.refPrice,
			BTCAmountCapped:     analysis.btcSizeCapped,
			NetProfitBTCCapped:  analysis.estimatedProfitBTCCapped,
			NetProfitFiatCapped: analysis.estimatedProfitBTCCapped * analysis.refPrice,
			HasCap:              analysis.hasCap,
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
	cutoff := time.Now().Add(-time.Duration(historyHours) * time.Hour)
	excludedPaymentMethods := queryExcludedPaymentMethods(r)

	rows, err := db.Query(
		rebind("SELECT * FROM offers WHERE last_seen >= ? ORDER BY last_seen DESC"),
		cutoff,
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
		refPrice := offerRefPrice(o)
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
	// optional capped results (set when maxFiatLimitEUR > 0 and btcSize exceeds cap)
	btcSizeCapped            float64
	estimatedProfitBTCCapped float64
	hasCap                   bool
}

func addPastOfferCostFields(o map[string]any, requiredConfirmations int) pastOfferAnalysis {
	return addPastOfferCostFieldsFull(o, requiredConfirmations, nil, "", 0)
}

func addPastOfferCostFieldsFull(o map[string]any, requiredConfirmations int, excludedCEXes []string, feeTier string, maxFiatLimitEUR float64) pastOfferAnalysis {
	dexExchange := offerString(o, "exchange")
	direction := offerString(o, "direction")
	price := offerFloat(o, "price")
	refPrice := offerRefPrice(o)
	priceDiff := computeDirectionalPremiumPct(direction, price, refPrice)
	if refPrice > 0 {
		o["ref_price"] = refPrice
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
	tradeCostPct, netPremium, bd := computeNetPremiumFieldsFull(priceDiff, btcSize, refPrice, dexExchange, direction, requiredConfirmations, excludedCEXes, feeTier, true)

	o["trade_cost_percent"] = tradeCostPct
	o["net_premium_percent"] = netPremium
	o["cost_breakdown"] = bd

	var btcSizeCapped float64
	var estimatedProfitBTCCapped float64
	hasCap := false
	if maxFiatLimitEUR > 0 && refPrice > 0 {
		btcCap := maxFiatLimitEUR / refPrice
		if btcSize > btcCap {
			_, _, bdCapped := computeNetPremiumFieldsFull(priceDiff, btcCap, refPrice, dexExchange, direction, requiredConfirmations, excludedCEXes, feeTier, true)
			btcSizeCapped = btcCap
			estimatedProfitBTCCapped = bdCapped.EstimatedProfitBTC
			hasCap = true
		}
	}

	return pastOfferAnalysis{
		isPremium:                priceDiff > 0,
		btcSize:                  btcSize,
		refPrice:                 refPrice,
		estimatedProfitBTC:       bd.EstimatedProfitBTC,
		btcSizeCapped:            btcSizeCapped,
		estimatedProfitBTCCapped: estimatedProfitBTCCapped,
		hasCap:                   hasCap,
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
	insStmt, err := tx.Prepare(rebind(`
		INSERT INTO order_lifecycle
			(offer_db_id, price, ref_price, premium_pct,
			 trade_cost_pct, trade_cost_btc, cex_taker_fee_btc, cex_withdraw_fee_btc, network_fee_btc, dex_fee_btc,
			 net_premium_pct, net_premium_btc, btc_amount)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`))
	if err != nil {
		tx.Rollback()
		fmt.Printf("[Lifecycle] prepare insert error: %v\n", err)
		return
	}
	defer insStmt.Close()

	updStmt, err := tx.Prepare(rebind(`
		UPDATE offers SET
			best_route_cex = ?,
			best_route_method = ?,
			hedge_open_fee_btc = ?,
			hedge_close_fee_btc = ?,
			hedge_funding_fee_btc = ?,
			hedge_fee_sum_btc = ?,
			hedge_venue = ?,
			hedge_instrument = ?,
			hedge_transfer_minutes = ?
		WHERE id = ?
	`))
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
		var cexWithdrawFee any
		if bd.TradeDirection != "ask" {
			cexWithdrawFee = round8(bd.WithdrawalFeeBTC)
		}
		_, _ = insStmt.Exec(
			o.ID,
			round4(o.Price),
			round4(o.RefPrice),
			round4(o.PriceDiffPct),
			round4(bd.TotalCostPct),
			round8(bd.TotalCostBTC),
			round8(bd.CexTakerFeeBTC),
			cexWithdrawFee,
			round8(bd.NetworkFeeBTC),
			round8(bd.DexFeeBTC),
			round4(o.NetPremiumPct),
			round8(bd.EstimatedProfitBTC),
			round8(bd.BTCAmount),
		)
		if bd.RouteCEX != "" {
			_, _ = updStmt.Exec(
				bd.RouteCEX,
				bd.RouteMethod,
				round8(bd.Hedge.OpenFeeBTC),
				round8(bd.Hedge.CloseFeeBTC),
				round8(bd.Hedge.FundingFeeBTC),
				round8(bd.Hedge.FeeSumBTC),
				nullIfEmpty(bd.Hedge.Venue),
				nullIfEmpty(bd.Hedge.Instrument),
				nullIfZeroInt(bd.Hedge.TransferMinutes),
				o.ID,
			)
		}
	}

	if err := tx.Commit(); err != nil {
		fmt.Printf("[Lifecycle] commit error: %v\n", err)
	}
}

func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func nullIfZeroInt(v int) any {
	if v == 0 {
		return nil
	}
	return v
}

// handleInternalLiveOffers receives the live offer list from the snapshot tool,
// updates the hub, and persists a lifecycle snapshot to the DB.
func handleInternalLiveOffers(w http.ResponseWriter, r *http.Request) {
	var offers []LiveOffer
	if err := json.NewDecoder(r.Body).Decode(&offers); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	// Fetch lifecycle from previous snapshot cycles and cache before broadcasting.
	ids := make([]int64, len(offers))
	for i, o := range offers {
		ids[i] = o.ID
	}
	hub.setLifecycle(fetchOfferLifecycle(ids))
	hub.setOffers(offers)
	price := getCexPrice(defaultCEX)
	outOffers := hub.computeOutOffers(price, liveSubscription{cex: defaultCEX})
	go writeLifecycleEntries(outOffers)
	fmt.Printf("[LiveHub] updated with %d live offers from snapshot\n", len(offers))
	w.WriteHeader(http.StatusNoContent)
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	hours := queryInt(r, "hours", 24)
	cutoff := time.Now().Add(-time.Duration(hours) * time.Hour)

	priceRows, err := db.Query(rebind(`
		SELECT exchange, COUNT(*) as snapshot_count,
		       MIN(btc_price) as min_price, MAX(btc_price) as max_price, AVG(btc_price) as avg_price
		FROM snapshots
		WHERE timestamp >= ?
		GROUP BY exchange
	`), cutoff)
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

	countRows, err := db.Query(rebind(`
		SELECT exchange, COUNT(*) as offer_count
		FROM offers
		WHERE last_seen >= ?
		GROUP BY exchange
	`), cutoff)
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

	rows, err := db.Query(
		rebind("SELECT * FROM offers WHERE last_seen >= ?"),
		time.Now().Add(-time.Duration(hours)*time.Hour),
	)
	if err != nil {
		writeError(w, err)
		return
	}
	defer rows.Close()

	offerRows, err := scanOffers(rows)
	if err != nil {
		writeError(w, err)
		return
	}

	offers := make([]map[string]any, 0, len(offerRows))
	for _, row := range offerRows {
		price := offerFloat(row, "price")
		refPrice := offerRefPrice(row)
		direction := offerString(row, "direction")
		if refPrice <= 0 {
			continue
		}
		if direction == "sell" && price > refPrice {
			continue
		}
		if direction == "buy" && price < refPrice {
			continue
		}
		premium := computeDirectionalPremiumPct(direction, price, refPrice)
		offers = append(offers, map[string]any{
			"time":           offerString(row, "first_seen"),
			"price":          price,
			"premium":        premium,
			"exchange":       offerString(row, "exchange"),
			"direction":      direction,
			"payment_method": offerString(row, "payment_method"),
		})
	}

	writeJSON(w, map[string]any{
		"candles":      candles,
		"offers":       offers,
		"interval_min": snapshotIntervalMin,
	})
}

func handlePaymentMethodGroups(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if pmService == nil {
		json.NewEncoder(w).Encode(map[string]any{"groups": []any{}})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"groups": pmService.GetGroups()})
}

func handleTradeCostConfig(w http.ResponseWriter, r *http.Request) {
	type cexInfo struct {
		Name         string   `json:"name"`
		Methods      []string `json:"methods"`
		HasLightning bool     `json:"has_lightning"`
	}
	cexes := make([]cexInfo, 0, len(supportedCEXes))
	for _, name := range supportedCEXes {
		profile := cexProfileFor(name)
		methods := make([]string, 0, len(profile.Methods))
		hasLN := false
		for _, m := range profile.Methods {
			methods = append(methods, string(m))
			if m == MethodLightning {
				hasLN = true
			}
		}
		cexes = append(cexes, cexInfo{Name: name, Methods: methods, HasLightning: hasLN})
	}

	tiers := []map[string]string{
		{"value": "", "label": "Auto (congestion-based)"},
		{"value": "economic", "label": "Economic (cheapest, ~1h)"},
		{"value": "standard", "label": "Standard (balanced, ~30min)"},
		{"value": "fast", "label": "Fast (priority, ~10min)"},
		{"value": "express", "label": "Express (next block, ~2min)"},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"cexes":     cexes,
		"fee_tiers": tiers,
	})
}

func handleSnapshotLog(w http.ResponseWriter, r *http.Request) {
	limit := queryInt(r, "limit", 50)

	rows, err := db.Query(
		rebind("SELECT id, timestamp, exchanges, offers_count FROM snapshot_log ORDER BY timestamp DESC LIMIT ?"),
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
		var ts time.Time
		var exchangesJSON []byte
		if err := rows.Scan(&id, &ts, &exchangesJSON, &offersCount); err != nil {
			writeError(w, err)
			return
		}
		exchanges := map[string]any{}
		json.Unmarshal(exchangesJSON, &exchanges)
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
	if !coreTablesReady() {
		w.WriteHeader(http.StatusServiceUnavailable)
		writeJSON(w, map[string]string{
			"status":    "starting",
			"timestamp": time.Now().UTC().Format("2006-01-02T15:04:05"),
		})
		return
	}

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

// rebind converts SQLite-style ? placeholders to PostgreSQL $1, $2, ... style.
func rebind(query string) string {
	var out strings.Builder
	n := 1
	inQuote := false
	for i := 0; i < len(query); i++ {
		ch := query[i]
		if ch == '\'' {
			out.WriteByte(ch)
			if i+1 < len(query) && query[i+1] == '\'' {
				out.WriteByte(query[i+1])
				i++
				continue
			}
			inQuote = !inQuote
			continue
		}
		if ch == '?' && !inQuote {
			fmt.Fprintf(&out, "$%d", n)
			n++
			continue
		}
		out.WriteByte(ch)
	}
	return out.String()
}

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

func offerRefPrice(o map[string]any) float64 {
	if v := offerFloat(o, "ref_price"); v > 0 {
		return v
	}
	return offerFloat(o, "avg_ref_price")
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

func queryConfirmations(r *http.Request) int {
	v := queryInt(r, "confirmations", 0)
	if v <= 0 {
		return 0
	}
	if v > 6 {
		return 6
	}
	return v
}

// validFeeTiers lists the fee tiers the user can lock in via settings.
var validFeeTiers = map[string]bool{
	"economic": true,
	"standard": true,
	"fast":     true,
	"express":  true,
}

// queryFeeTier reads the ?fee_tier= query param. Returns "" (auto) for missing/unknown values.
func queryFeeTier(r *http.Request) string {
	tier := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("fee_tier")))
	if validFeeTiers[tier] {
		return tier
	}
	return ""
}

// queryExcludedCEXes reads the ?exclude_cexes= query param (comma-separated).
func queryExcludedCEXes(r *http.Request) []string {
	values := append([]string{}, r.URL.Query()["exclude_cexes"]...)
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, raw := range values {
		for _, part := range strings.Split(raw, ",") {
			cex := strings.TrimSpace(strings.ToLower(part))
			if cex == "" {
				continue
			}
			if _, ok := seen[cex]; ok {
				continue
			}
			seen[cex] = struct{}{}
			result = append(result, cex)
		}
	}
	return result
}

// queryCoupledHedge reads the ?coupled_hedge= query param. Default is true.
func queryCoupledHedge(r *http.Request) bool {
	v := r.URL.Query().Get("coupled_hedge")
	return v != "false" && v != "0"
}

// queryMaxFiatLimitEUR reads the ?max_fiat_limit= query param (EUR amount, positive float).
// Returns 0 when absent, zero, or invalid.
func queryMaxFiatLimitEUR(r *http.Request) float64 {
	v := r.URL.Query().Get("max_fiat_limit")
	if v == "" {
		return 0
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil || f <= 0 {
		return 0
	}
	return f
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
