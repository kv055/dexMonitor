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
	"sort"
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
	mux.HandleFunc("GET /api/past_profitable_orders", handlePastProfitableOrders)
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
	mux.HandleFunc("GET /api/trading/accounts", handleTradingAccounts)
	mux.HandleFunc("POST /api/trading/accounts", handleTradingAccounts)
	mux.HandleFunc("PUT /api/trading/accounts/{id}", handleTradingAccountByID)
	mux.HandleFunc("DELETE /api/trading/accounts/{id}", handleTradingAccountByID)
	mux.HandleFunc("POST /api/trading/accounts/{id}/totp_secrets", handleTradingAccountTOTPSecrets)
	mux.HandleFunc("POST /api/trading/accounts/{id}/passkey_credentials", handleTradingAccountPasskeys)
	mux.HandleFunc("POST /api/trading/accounts/{id}/seeds", handleTradingAccountSeeds)
	mux.HandleFunc("POST /api/trading/accounts/{id}/api_keys", handleTradingAccountAPIKeys)
	mux.HandleFunc("PUT /api/trading/totp_secrets/{id}", handleTradingTOTPSecretByID)
	mux.HandleFunc("DELETE /api/trading/totp_secrets/{id}", handleTradingTOTPSecretByID)
	mux.HandleFunc("PUT /api/trading/passkey_credentials/{id}", handleTradingPasskeyByID)
	mux.HandleFunc("DELETE /api/trading/passkey_credentials/{id}", handleTradingPasskeyByID)
	mux.HandleFunc("PUT /api/trading/seeds/{id}", handleTradingSeedByID)
	mux.HandleFunc("DELETE /api/trading/seeds/{id}", handleTradingSeedByID)
	mux.HandleFunc("PUT /api/trading/api_keys/{id}", handleTradingAPIKeyByID)
	mux.HandleFunc("DELETE /api/trading/api_keys/{id}", handleTradingAPIKeyByID)
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
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
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
	maxFiatLimitEUR := queryMaxFiatLimitEUR(r)

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

	filteredOffers := make([]map[string]any, 0, len(offers))
	ids := make([]int64, 0, len(offers))
	for _, o := range offers {
		if isPaymentMethodExcluded(offerString(o, "payment_method"), excludedPaymentMethods) {
			continue
		}
		filteredOffers = append(filteredOffers, o)
		ids = append(ids, int64(offerFloat(o, "id")))
	}

	lifecycleAgg := fetchPastOfferLifecycleAggregates(ids)
	result := make([]pastOfferAPI, 0, len(filteredOffers))
	for _, o := range filteredOffers {
		id := int64(offerFloat(o, "id"))
		result = append(result, buildPastOfferAPI(o, lifecycleAgg[id], requiredConfirmations, excludedCEXes, feeTier, maxFiatLimitEUR))
	}

	writeJSON(w, result)
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

func fetchPastOfferLifecycleAggregates(ids []int64) map[int64]pastLifecycleAggregate {
	result := make(map[int64]pastLifecycleAggregate, len(ids))
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
		`SELECT offer_db_id, price, ref_price, premium_pct, trade_cost_pct, trade_cost_btc,
		        network_fee_btc, net_premium_pct, net_premium_btc, btc_amount
		   FROM order_lifecycle
		  WHERE offer_db_id IN (%s)
		  ORDER BY offer_db_id, snapshot_time`,
		strings.Join(placeholders, ","),
	)), args...)
	if err != nil {
		return result
	}
	defer rows.Close()

	type accum struct {
		count             int
		sumPrice          float64
		sumRefPrice       float64
		sumPremium        float64
		sumTradeCostPct   float64
		countTradeCost    int
		sumTradeCostBTC   float64
		countTradeCostBTC int
		sumNetPct         float64
		countNetPct       int
		sumProfitBTC      float64
		countProfitBTC    int
		sumProfitFiat     float64
		countProfitFiat   int
		sumBTCAmount      float64
		countBTCAmount    int
		sumNetworkPct     float64
		countNetworkPct   int
		samples           []pastLifecycleSample
	}

	accs := make(map[int64]*accum, len(ids))
	for rows.Next() {
		var offerID int64
		var price, refPrice, premiumPct float64
		var tradeCostPct, tradeCostBTC, networkFeeBTC, netPremiumPct, netPremiumBTC, btcAmount sql.NullFloat64
		if err := rows.Scan(&offerID, &price, &refPrice, &premiumPct, &tradeCostPct, &tradeCostBTC, &networkFeeBTC, &netPremiumPct, &netPremiumBTC, &btcAmount); err != nil {
			continue
		}
		ac := accs[offerID]
		if ac == nil {
			ac = &accum{}
			accs[offerID] = ac
		}
		ac.count++
		ac.sumPrice += price
		ac.sumRefPrice += refPrice
		ac.sumPremium += premiumPct
		ac.samples = append(ac.samples, pastLifecycleSample{RefPrice: refPrice, PremiumPct: premiumPct})
		if tradeCostPct.Valid {
			ac.sumTradeCostPct += tradeCostPct.Float64
			ac.countTradeCost++
		}
		if tradeCostBTC.Valid {
			ac.sumTradeCostBTC += tradeCostBTC.Float64
			ac.countTradeCostBTC++
		}
		if netPremiumPct.Valid {
			ac.sumNetPct += netPremiumPct.Float64
			ac.countNetPct++
		}
		if netPremiumBTC.Valid {
			ac.sumProfitBTC += netPremiumBTC.Float64
			ac.countProfitBTC++
			ac.sumProfitFiat += netPremiumBTC.Float64 * refPrice
			ac.countProfitFiat++
		}
		if btcAmount.Valid {
			ac.sumBTCAmount += btcAmount.Float64
			ac.countBTCAmount++
			if networkFeeBTC.Valid && btcAmount.Float64 > 0 {
				ac.sumNetworkPct += (networkFeeBTC.Float64 / btcAmount.Float64) * 100
				ac.countNetworkPct++
			}
		}
	}

	for id, ac := range accs {
		agg := pastLifecycleAggregate{}
		if ac.count > 0 {
			agg.Count = ac.count
			agg.AvgOfferPrice = round4(ac.sumPrice / float64(ac.count))
			agg.AvgRefPrice = round4(ac.sumRefPrice / float64(ac.count))
			agg.AvgPremiumPercent = round4(ac.sumPremium / float64(ac.count))
		}
		if ac.countTradeCost > 0 {
			agg.AvgTradeCostPct = round4(ac.sumTradeCostPct / float64(ac.countTradeCost))
		}
		if ac.countTradeCostBTC > 0 {
			agg.AvgTradeCostBTC = round8(ac.sumTradeCostBTC / float64(ac.countTradeCostBTC))
		}
		if ac.countNetPct > 0 {
			agg.AvgNetPercent = round4(ac.sumNetPct / float64(ac.countNetPct))
		}
		if ac.countProfitBTC > 0 {
			agg.AvgProfitBTC = round8(ac.sumProfitBTC / float64(ac.countProfitBTC))
		}
		if ac.countProfitFiat > 0 {
			agg.AvgProfitFiat = round4(ac.sumProfitFiat / float64(ac.countProfitFiat))
		}
		if ac.countBTCAmount > 0 {
			agg.AvgBTCAmount = round8(ac.sumBTCAmount / float64(ac.countBTCAmount))
		}
		if ac.countNetworkPct > 0 {
			agg.AvgNetworkPct = round4(ac.sumNetworkPct / float64(ac.countNetworkPct))
		}
		agg.Samples = ac.samples
		result[id] = agg
	}
	return result
}

func handlePastOrderStats(w http.ResponseWriter, r *http.Request) {
	excludedPaymentMethods := queryExcludedPaymentMethods(r)
	excludedCEXes := queryExcludedCEXes(r)
	requiredConfirmations := queryConfirmations(r)
	feeTier := r.URL.Query().Get("fee_tier")
	maxFiatLimitEUR := queryMaxFiatLimitEUR(r)
	premiumMode := queryTakerOpportunityMode(r)
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

	profitableOrders := make([]pastorders.PremiumOrder, 0, len(offers))
	for _, o := range offers {
		analysis := addPastOfferCostFieldsFull(o, requiredConfirmations, excludedCEXes, feeTier, maxFiatLimitEUR)
		if !analysis.profitableInMode(premiumMode) {
			continue
		}
		btcAmount, netProfitBTC := analysis.valuesForMode(premiumMode)
		profitableOrders = append(profitableOrders, pastorders.PremiumOrder{
			PaymentMethod:       offerString(o, "payment_method"),
			LastSeen:            parseDBTime(offerString(o, "last_seen")),
			BTCAmount:           btcAmount,
			NetProfitBTC:        netProfitBTC,
			NetProfitFiat:       netProfitBTC * analysis.refPrice,
			BTCAmountCapped:     analysis.btcSizeCapped,
			NetProfitBTCCapped:  analysis.estimatedProfitBTCCapped,
			NetProfitFiatCapped: analysis.estimatedProfitBTCCapped * analysis.refPrice,
			HasCap:              premiumMode == takerOpportunityModeNetCapped && analysis.hasCap,
		})
	}

	writeJSON(w, pastorders.BuildStats(profitableOrders, time.Now(), fiatCurrency, excludedPaymentMethods))
}

type pastProfitableOrderSummary struct {
	NetProfitBTC  float64  `json:"net_profit_btc"`
	NetProfitFiat float64  `json:"net_profit_fiat"`
	TradeSizeBTC  float64  `json:"trade_size_btc"`
	TradeSizeFiat float64  `json:"trade_size_fiat"`
	NetPercent    float64  `json:"net_percent"`
	CapFiat       *float64 `json:"cap_fiat,omitempty"`
}

type pastProfitableOrderAPI struct {
	ID            int64                      `json:"id"`
	Exchange      string                     `json:"exchange"`
	OfferID       *string                    `json:"offer_id"`
	PaymentMethod *string                    `json:"payment_method"`
	Direction     string                     `json:"direction"`
	Status        pastOfferStatus            `json:"status"`
	Pricing       pastOfferPricing           `json:"pricing"`
	Summary       pastProfitableOrderSummary `json:"summary"`
	Analysis      pastOfferAnalysisAPI       `json:"analysis"`
	Offer         map[string]any             `json:"offer"`
}

func handlePastProfitableOrders(w http.ResponseWriter, r *http.Request) {
	excludedPaymentMethods := queryExcludedPaymentMethods(r)
	requiredConfirmations := queryConfirmations(r)
	excludedCEXes := queryExcludedCEXes(r)
	feeTier := queryFeeTier(r)
	maxFiatLimitEUR := queryMaxFiatLimitEUR(r)
	premiumMode := queryTakerOpportunityMode(r)

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

	filteredOffers := make([]map[string]any, 0, len(offers))
	ids := make([]int64, 0, len(offers))
	for _, o := range offers {
		if isPaymentMethodExcluded(offerString(o, "payment_method"), excludedPaymentMethods) {
			continue
		}
		filteredOffers = append(filteredOffers, o)
		ids = append(ids, int64(offerFloat(o, "id")))
	}

	lifecycleAgg := fetchPastOfferLifecycleAggregates(ids)
	result := make([]pastProfitableOrderAPI, 0, len(filteredOffers))
	for _, o := range filteredOffers {
		analysis := addPastOfferCostFieldsFull(o, requiredConfirmations, excludedCEXes, feeTier, maxFiatLimitEUR)
		if !analysis.profitableInMode(premiumMode) {
			continue
		}
		id := int64(offerFloat(o, "id"))
		result = append(result, buildPastProfitableOrderAPI(o, lifecycleAgg[id], requiredConfirmations, excludedCEXes, feeTier, maxFiatLimitEUR, premiumMode))
	}

	writeJSON(w, result)
}

func handleGeneralStats(w http.ResponseWriter, r *http.Request) {
	hours := queryInt(r, "hours", 24)
	historyHours := hours
	if historyHours < 168 {
		historyHours = 168
	}
	cutoff := time.Now().Add(-time.Duration(historyHours) * time.Hour)
	excludedPaymentMethods := queryExcludedPaymentMethods(r)
	sub := liveSubscription{
		cex:                   queryCex(r),
		requiredConfirmations: queryConfirmations(r),
		excludedCEXes:         strings.Join(queryExcludedCEXes(r), ","),
		feeTier:               queryFeeTier(r),
		coupledHedge:          queryCoupledHedge(r),
		maxFiatLimitEUR:       queryMaxFiatLimitEUR(r),
	}

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
	closedOfferIDs := make([]int64, 0, len(offers))
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
		if !offerBool(o, "is_live") {
			closedOfferIDs = append(closedOfferIDs, int64(offerFloat(o, "id")))
		}
	}

	lifecycleAgg := fetchPastOfferLifecycleAggregates(closedOfferIDs)
	stats := pastorders.BuildGeneralStats(generalOffers, time.Now(), hours, excludedPaymentMethods)
	stats.OpenPremiums = buildOpenPremiumStats(sub, excludedPaymentMethods)
	stats.PastPremiums = buildPastPremiumStats(offers, lifecycleAgg, time.Now(), excludedPaymentMethods, queryMaxFiatLimitEUR(r), queryConfirmations(r), queryExcludedCEXes(r), queryFeeTier(r))
	stats.PremiumLifetimes = buildPremiumLifetimeStats(offers, lifecycleAgg, time.Now(), excludedPaymentMethods, queryMaxFiatLimitEUR(r), queryConfirmations(r), queryExcludedCEXes(r), queryFeeTier(r))
	stats.AvgOfferLifetimeMs = stats.PremiumLifetimes.Raw.AvgOfferLifetimeMs
	stats.AvgOfferLifetimeMsByExchange = stats.PremiumLifetimes.Raw.AvgOfferLifetimeMsByExchange
	writeJSON(w, stats)
}

func buildOpenPremiumStats(sub liveSubscription, excludedPaymentMethods []string) pastorders.OpenPremiumStats {
	price := getCexPrice(sub.cex)
	offers := hub.computeOutOffers(price, sub)
	excluded := make(map[string]struct{}, len(excludedPaymentMethods))
	for _, method := range excludedPaymentMethods {
		excluded[method] = struct{}{}
	}

	type acc struct {
		sumAsk float64
		cntAsk int
		sumBid float64
		cntBid int
	}
	rawAcc := acc{}
	netFullAcc := acc{}
	netCappedAcc := acc{}

	addPositive := func(a *acc, direction string, value float64) {
		if value <= 0 {
			return
		}
		if direction == "sell" {
			a.sumAsk += value
			a.cntAsk++
			return
		}
		if direction == "buy" {
			a.sumBid += value
			a.cntBid++
		}
	}

	for _, offer := range offers {
		if offer.PaymentMethod != nil {
			if _, skip := excluded[*offer.PaymentMethod]; skip {
				continue
			}
		}
		addPositive(&rawAcc, offer.Direction, offer.PriceDiffPct)
		addPositive(&netFullAcc, offer.Direction, offer.NetPremiumPct)
		capped := offer.NetPremiumPct
		if offer.NetPremiumPctCapped != nil {
			capped = *offer.NetPremiumPctCapped
		}
		addPositive(&netCappedAcc, offer.Direction, capped)
	}

	toMode := func(a acc) pastorders.OpenPremiumModeStats {
		var askPtr *float64
		var bidPtr *float64
		if a.cntAsk > 0 {
			v := round4(a.sumAsk / float64(a.cntAsk))
			askPtr = &v
		}
		if a.cntBid > 0 {
			v := round4(a.sumBid / float64(a.cntBid))
			bidPtr = &v
		}
		return pastorders.OpenPremiumModeStats{
			AvgAskPremiumPct: askPtr,
			AvgBidPremiumPct: bidPtr,
		}
	}

	return pastorders.OpenPremiumStats{
		Raw:       toMode(rawAcc),
		NetFull:   toMode(netFullAcc),
		NetCapped: toMode(netCappedAcc),
	}
}

func buildPastPremiumStats(offers []map[string]any, lifecycleAgg map[int64]pastLifecycleAggregate, now time.Time, excludedPaymentMethods []string, maxFiatLimitEUR float64, requiredConfirmations int, excludedCEXes []string, feeTier string) []pastorders.PastPremiumTimeframeStats {
	excluded := make(map[string]struct{}, len(excludedPaymentMethods))
	for _, method := range excludedPaymentMethods {
		excluded[method] = struct{}{}
	}

	buildNamed := func(sumByExchange map[string]float64, countByExchange map[string]int) []pastorders.NamedPremium {
		out := make([]pastorders.NamedPremium, 0, len(countByExchange))
		for exchange, count := range countByExchange {
			if count <= 0 {
				continue
			}
			avg := round4(sumByExchange[exchange] / float64(count))
			out = append(out, pastorders.NamedPremium{Name: exchange, AvgPremiumPct: avg})
		}
		sort.Slice(out, func(i, j int) bool {
			return out[i].Name < out[j].Name
		})
		return out
	}

	positiveOrZero := func(v float64) (float64, bool) {
		if v > 0 {
			return v, true
		}
		return 0, false
	}

	stats := make([]pastorders.PastPremiumTimeframeStats, 0, len(pastorders.PastPremiumTimeframes))
	for _, tf := range pastorders.PastPremiumTimeframes {
		cutoff := now.Add(-time.Duration(tf.Hours) * time.Hour)
		rawSum := map[string]float64{}
		rawCount := map[string]int{}
		netSum := map[string]float64{}
		netCount := map[string]int{}
		cappedSum := map[string]float64{}
		cappedCount := map[string]int{}

		for _, offer := range offers {
			if offerBool(offer, "is_live") {
				continue
			}
			exchange := offerString(offer, "exchange")
			if exchange == "" {
				continue
			}
			if isPaymentMethodExcluded(offerString(offer, "payment_method"), excludedPaymentMethods) {
				continue
			}
			lastSeen := parseDBTime(offerString(offer, "last_seen"))
			if lastSeen.IsZero() || lastSeen.Before(cutoff) {
				continue
			}

			id := int64(offerFloat(offer, "id"))
			agg := lifecycleAgg[id]
			direction := offerString(offer, "direction")

			rawPremium := agg.AvgPremiumPercent
			if rawPremium == 0 {
				rawPremium = round4(offerFloat(offer, "avg_premium_pct"))
			}
			if raw, ok := positiveOrZero(rawPremium); ok {
				rawSum[exchange] += raw
				rawCount[exchange]++
			}

			netPremium := agg.AvgNetPercent
			if netPremium == 0 {
				netPremium = round4(offerFloat(offer, "avg_net_premium_pct"))
			}
			if net, ok := positiveOrZero(netPremium); ok {
				netSum[exchange] += net
				netCount[exchange]++
			}

			cappedPremium := netPremium
			if maxFiatLimitEUR > 0 {
				avgRefPrice := agg.AvgRefPrice
				if avgRefPrice <= 0 {
					avgRefPrice = offerRefPrice(offer)
				}
				fullTradeSizeBTC := selectBTCTradeSize(offerFloatPtr(offer, "btc_max"), offerFloatPtr(offer, "btc_min"))
				if avgRefPrice > 0 && fullTradeSizeBTC > 0 {
					btcCap := maxFiatLimitEUR / avgRefPrice
					if btcCap > 0 && fullTradeSizeBTC > btcCap {
						_, cappedNet, _, _, _, _ := recomputeCappedLifecycleAverages(agg.Samples, maxFiatLimitEUR, exchange, direction, requiredConfirmations, excludedCEXes, feeTier)
						cappedPremium = cappedNet
					}
				}
			}
			if capped, ok := positiveOrZero(cappedPremium); ok {
				cappedSum[exchange] += capped
				cappedCount[exchange]++
			}
		}

		raw := buildNamed(rawSum, rawCount)
		stats = append(stats, pastorders.PastPremiumTimeframeStats{
			Timeframe:            tf.Label,
			Hours:                tf.Hours,
			AvgPremiumByExchange: raw,
			Modes: pastorders.PastPremiumModes{
				Raw:       raw,
				NetFull:   buildNamed(netSum, netCount),
				NetCapped: buildNamed(cappedSum, cappedCount),
			},
		})
	}
	return stats
}

func buildPremiumLifetimeStats(offers []map[string]any, lifecycleAgg map[int64]pastLifecycleAggregate, now time.Time, excludedPaymentMethods []string, maxFiatLimitEUR float64, requiredConfirmations int, excludedCEXes []string, feeTier string) pastorders.PremiumLifetimeModes {
	excluded := make(map[string]struct{}, len(excludedPaymentMethods))
	for _, method := range excludedPaymentMethods {
		excluded[method] = struct{}{}
	}

	type acc struct {
		sum           time.Duration
		count         int
		sumByExchange map[string]time.Duration
		cntByExchange map[string]int
	}

	makeAcc := func() acc {
		return acc{
			sumByExchange: map[string]time.Duration{},
			cntByExchange: map[string]int{},
		}
	}
	rawAcc := makeAcc()
	netAcc := makeAcc()
	cappedAcc := makeAcc()

	add := func(a *acc, exchange string, lifetime time.Duration) {
		if lifetime <= 0 {
			return
		}
		a.sum += lifetime
		a.count++
		if strings.TrimSpace(exchange) != "" {
			a.sumByExchange[exchange] += lifetime
			a.cntByExchange[exchange]++
		}
	}

	for _, offer := range offers {
		if offerBool(offer, "is_live") {
			continue
		}
		if isPaymentMethodExcluded(offerString(offer, "payment_method"), excludedPaymentMethods) {
			continue
		}
		firstSeen := parseDBTime(offerString(offer, "first_seen"))
		lastSeen := parseDBTime(offerString(offer, "last_seen"))
		if firstSeen.IsZero() || lastSeen.IsZero() || lastSeen.Before(firstSeen) {
			continue
		}
		lifetime := lastSeen.Sub(firstSeen)
		exchange := offerString(offer, "exchange")
		id := int64(offerFloat(offer, "id"))
		agg := lifecycleAgg[id]

		rawPremium := agg.AvgPremiumPercent
		if rawPremium == 0 {
			rawPremium = round4(offerFloat(offer, "avg_premium_pct"))
		}
		if rawPremium > 0 {
			add(&rawAcc, exchange, lifetime)
		}

		netPremium := agg.AvgNetPercent
		if netPremium == 0 {
			netPremium = round4(offerFloat(offer, "avg_net_premium_pct"))
		}
		if netPremium > 0 {
			add(&netAcc, exchange, lifetime)
		}

		cappedPremium := netPremium
		if maxFiatLimitEUR > 0 {
			avgRefPrice := agg.AvgRefPrice
			if avgRefPrice <= 0 {
				avgRefPrice = offerRefPrice(offer)
			}
			fullTradeSizeBTC := selectBTCTradeSize(offerFloatPtr(offer, "btc_max"), offerFloatPtr(offer, "btc_min"))
			if avgRefPrice > 0 && fullTradeSizeBTC > 0 {
				btcCap := maxFiatLimitEUR / avgRefPrice
				if btcCap > 0 && fullTradeSizeBTC > btcCap {
					_, cappedNet, _, _, _, _ := recomputeCappedLifecycleAverages(agg.Samples, maxFiatLimitEUR, exchange, offerString(offer, "direction"), requiredConfirmations, excludedCEXes, feeTier)
					cappedPremium = cappedNet
				}
			}
		}
		if cappedPremium > 0 {
			add(&cappedAcc, exchange, lifetime)
		}
	}

	toStats := func(a acc) pastorders.PremiumLifetimeStats {
		var avgPtr *int64
		if a.count > 0 {
			v := int64(a.sum / time.Duration(a.count) / time.Millisecond)
			avgPtr = &v
		}
		byExchange := make([]pastorders.NamedDuration, 0, len(a.cntByExchange))
		for exchange, count := range a.cntByExchange {
			if count <= 0 {
				continue
			}
			ms := int64(a.sumByExchange[exchange] / time.Duration(count) / time.Millisecond)
			byExchange = append(byExchange, pastorders.NamedDuration{Name: exchange, Ms: ms})
		}
		sort.Slice(byExchange, func(i, j int) bool {
			return byExchange[i].Name < byExchange[j].Name
		})
		return pastorders.PremiumLifetimeStats{
			AvgOfferLifetimeMs:           avgPtr,
			AvgOfferLifetimeMsByExchange: byExchange,
		}
	}

	return pastorders.PremiumLifetimeModes{
		Raw:       toStats(rawAcc),
		NetFull:   toStats(netAcc),
		NetCapped: toStats(cappedAcc),
	}
}

type pastOfferAnalysis struct {
	hasPositiveRawSpread bool
	btcSize              float64
	refPrice             float64
	estimatedProfitBTC   float64
	// optional capped results (set when maxFiatLimitEUR > 0 and btcSize exceeds cap)
	btcSizeCapped            float64
	estimatedProfitBTCCapped float64
	hasCap                   bool
}

type takerOpportunityMode string

const (
	takerOpportunityModeNetFull   takerOpportunityMode = "net_full"
	takerOpportunityModeNetCapped takerOpportunityMode = "net_capped"
)

func (a pastOfferAnalysis) valuesForMode(mode takerOpportunityMode) (float64, float64) {
	if mode == takerOpportunityModeNetCapped && a.hasCap {
		return a.btcSizeCapped, a.estimatedProfitBTCCapped
	}
	return a.btcSize, a.estimatedProfitBTC
}

func (a pastOfferAnalysis) profitableInMode(mode takerOpportunityMode) bool {
	_, profit := a.valuesForMode(mode)
	return profit > 0
}

type pastOfferDuration struct {
	Hours   int    `json:"hours"`
	Minutes int    `json:"minutes"`
	Display string `json:"display"`
}

type pastOfferStatus struct {
	IsLive    bool              `json:"is_live"`
	FirstSeen string            `json:"first_seen"`
	LastSeen  string            `json:"last_seen"`
	Duration  pastOfferDuration `json:"duration"`
}

type pastOfferPricing struct {
	PriceType         string  `json:"price_type"`
	FiatCurrency      string  `json:"fiat_currency"`
	AvgOfferPrice     float64 `json:"avg_offer_price"`
	AvgRefPrice       float64 `json:"avg_ref_price"`
	AvgPremiumPercent float64 `json:"avg_premium_percent"`
}

type pastOfferVolumeLimits struct {
	BTCMin  *float64 `json:"btc_min"`
	BTCMax  *float64 `json:"btc_max"`
	FiatMin *int64   `json:"fiat_min"`
	FiatMax *int64   `json:"fiat_max"`
}

type pastOfferBTCNetworkFee struct {
	BTC                     float64              `json:"btc"`
	Method                  string               `json:"method"`
	Tier                    string               `json:"tier"`
	Confidence              float64              `json:"confidence"`
	NumTxs                  int                  `json:"num_txs"`
	RequiredConfirmations   int                  `json:"required_confirmations"`
	EstimatedArrivalMinutes int                  `json:"estimated_arrival_minutes"`
	Detail                  *BTCNetworkFeeDetail `json:"detail"`
}

type pastOfferRoute struct {
	CEX        string `json:"cex"`
	Settlement string `json:"settlement"`
}

type pastOfferPremium struct {
	AvgTradeCostPercent float64 `json:"avg_trade_cost_percent"`
	AvgNetPercent       float64 `json:"avg_net_percent"`
}

type pastOfferProfit struct {
	AvgBTC  float64 `json:"avg_btc"`
	AvgFiat float64 `json:"avg_fiat"`
}

type pastOfferCostValue struct {
	Pct    float64 `json:"pct,omitempty"`
	BTC    float64 `json:"btc,omitempty"`
	AvgPct float64 `json:"avg_pct,omitempty"`
	AvgBTC float64 `json:"avg_btc,omitempty"`
}

type pastOfferHedgeCosts struct {
	OpenFeePct      float64              `json:"open_fee_pct"`
	OpenFeeBTC      float64              `json:"open_fee_btc"`
	CloseFeePct     float64              `json:"close_fee_pct"`
	CloseFeeBTC     float64              `json:"close_fee_btc"`
	FundingFeePct   float64              `json:"funding_fee_pct"`
	FundingFeeBTC   float64              `json:"funding_fee_btc"`
	FeeSumPct       float64              `json:"fee_sum_pct"`
	FeeSumBTC       float64              `json:"fee_sum_btc"`
	Venue           string               `json:"venue"`
	Instrument      string               `json:"instrument"`
	TransferMinutes int                  `json:"transfer_minutes"`
	Position        *HedgePositionDetail `json:"position,omitempty"`
}

type pastOfferScenarioCosts struct {
	CexTaker   pastOfferCostValue  `json:"cex_taker"`
	Withdrawal pastOfferCostValue  `json:"withdrawal"`
	DexFee     pastOfferCostValue  `json:"dex_fee"`
	Network    pastOfferCostValue  `json:"network"`
	Hedge      pastOfferHedgeCosts `json:"hedge"`
	Total      pastOfferCostValue  `json:"total"`
}

type pastOfferScenario struct {
	CapFiat       *float64               `json:"cap_fiat,omitempty"`
	TradeSizeBTC  float64                `json:"trade_size_btc"`
	TradeSizeFiat float64                `json:"trade_size_fiat"`
	Route         pastOfferRoute         `json:"route"`
	Premium       pastOfferPremium       `json:"premium"`
	Profit        pastOfferProfit        `json:"profit"`
	Costs         pastOfferScenarioCosts `json:"costs"`
}

type pastOfferAnalysisAPI struct {
	FullVolume   pastOfferScenario  `json:"full_volume"`
	CappedVolume *pastOfferScenario `json:"capped_volume,omitempty"`
}

type pastOfferAPI struct {
	ID            int64                  `json:"id"`
	Exchange      string                 `json:"exchange"`
	OfferID       *string                `json:"offer_id"`
	PaymentMethod *string                `json:"payment_method"`
	Direction     string                 `json:"direction"`
	Status        pastOfferStatus        `json:"status"`
	Pricing       pastOfferPricing       `json:"pricing"`
	VolumeLimits  pastOfferVolumeLimits  `json:"volume_limits"`
	BTCNetworkFee pastOfferBTCNetworkFee `json:"btc_network_fee"`
	Analysis      pastOfferAnalysisAPI   `json:"analysis"`
}

type pastLifecycleSample struct {
	RefPrice   float64
	PremiumPct float64
}

type pastLifecycleAggregate struct {
	Count             int
	AvgOfferPrice     float64
	AvgRefPrice       float64
	AvgPremiumPercent float64
	AvgTradeCostPct   float64
	AvgTradeCostBTC   float64
	AvgNetPercent     float64
	AvgProfitBTC      float64
	AvgProfitFiat     float64
	AvgBTCAmount      float64
	AvgNetworkPct     float64
	Samples           []pastLifecycleSample
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
		hasPositiveRawSpread:     priceDiff > 0,
		btcSize:                  btcSize,
		refPrice:                 refPrice,
		estimatedProfitBTC:       bd.EstimatedProfitBTC,
		btcSizeCapped:            btcSizeCapped,
		estimatedProfitBTCCapped: estimatedProfitBTCCapped,
		hasCap:                   hasCap,
	}
}

func buildPastOfferAPI(o map[string]any, agg pastLifecycleAggregate, requiredConfirmations int, excludedCEXes []string, feeTier string, maxFiatLimitEUR float64) pastOfferAPI {
	id := int64(offerFloat(o, "id"))
	firstSeen := offerString(o, "first_seen")
	lastSeen := offerString(o, "last_seen")
	firstTime := parseDBTime(firstSeen)
	lastTime := parseDBTime(lastSeen)
	duration := buildPastOfferDuration(firstTime, lastTime)

	avgOfferPrice := agg.AvgOfferPrice
	if avgOfferPrice <= 0 {
		avgOfferPrice = round4(offerFloat(o, "price"))
	}
	avgRefPrice := agg.AvgRefPrice
	if avgRefPrice <= 0 {
		avgRefPrice = round4(offerRefPrice(o))
	}
	avgPremiumPercent := agg.AvgPremiumPercent
	if avgPremiumPercent == 0 {
		avgPremiumPercent = round4(offerFloat(o, "avg_premium_pct"))
	}
	avgTradeCostPct := agg.AvgTradeCostPct
	if avgTradeCostPct == 0 {
		avgTradeCostPct = round4(offerFloat(o, "avg_trade_cost_pct"))
	}
	avgTradeCostBTC := agg.AvgTradeCostBTC
	if avgTradeCostBTC == 0 {
		avgTradeCostBTC = round8(offerFloat(o, "avg_trade_cost_btc"))
	}
	avgNetPercent := agg.AvgNetPercent
	if avgNetPercent == 0 {
		avgNetPercent = round4(offerFloat(o, "avg_net_premium_pct"))
	}
	avgProfitBTC := agg.AvgProfitBTC
	if avgProfitBTC == 0 {
		avgProfitBTC = round8(offerFloat(o, "avg_estimated_profit_btc"))
	}
	avgProfitFiat := agg.AvgProfitFiat
	if avgProfitFiat == 0 {
		avgProfitFiat = round4(offerFloat(o, "avg_estimated_profit_fiat"))
	}
	avgNetworkPct := agg.AvgNetworkPct
	avgBTCAmount := agg.AvgBTCAmount
	if avgBTCAmount == 0 {
		avgBTCAmount = round8(offerFloat(o, "avg_btc_amount"))
	}

	var btcMinPtr, btcMaxPtr *float64
	if v := offerFloat(o, "btc_min"); v > 0 {
		btcMinPtr = &v
	}
	if v := offerFloat(o, "btc_max"); v > 0 {
		btcMaxPtr = &v
	}
	fullTradeSizeBTC := selectBTCTradeSize(btcMaxPtr, btcMinPtr)
	if btcMaxPtr != nil && *btcMaxPtr > 0 {
		fullTradeSizeBTC = *btcMaxPtr
	}
	fullRep := computeRepresentativePastBreakdown(fullTradeSizeBTC, avgRefPrice, offerString(o, "exchange"), offerString(o, "direction"), requiredConfirmations, excludedCEXes, feeTier)
	fullTradeSizeFiat := round4(fullTradeSizeBTC * avgRefPrice)

	fullScenario := pastOfferScenario{
		TradeSizeBTC:  round8(fullTradeSizeBTC),
		TradeSizeFiat: fullTradeSizeFiat,
		Route: pastOfferRoute{
			CEX:        nonEmptyOr(fullRep.RouteCEX, offerString(o, "best_route_cex")),
			Settlement: nonEmptyOr(fullRep.RouteMethod, offerString(o, "best_route_method")),
		},
		Premium: pastOfferPremium{
			AvgTradeCostPercent: avgTradeCostPct,
			AvgNetPercent:       avgNetPercent,
		},
		Profit: pastOfferProfit{
			AvgBTC:  avgProfitBTC,
			AvgFiat: avgProfitFiat,
		},
		Costs: buildPastScenarioCosts(fullRep, avgNetworkPct, avgTradeCostPct, avgTradeCostBTC),
	}

	var cappedScenario *pastOfferScenario
	if maxFiatLimitEUR > 0 && avgRefPrice > 0 {
		cappedTradeSizeBTC := round8(maxFiatLimitEUR / avgRefPrice)
		if cappedTradeSizeBTC > 0 && fullTradeSizeBTC > cappedTradeSizeBTC {
			cappedRep := computeRepresentativePastBreakdown(cappedTradeSizeBTC, avgRefPrice, offerString(o, "exchange"), offerString(o, "direction"), requiredConfirmations, excludedCEXes, feeTier)
			cappedAvgTradeCostPct, cappedAvgNetPct, cappedAvgProfitBTC, cappedAvgProfitFiat, cappedAvgTradeCostBTC, cappedAvgNetworkPct :=
				recomputeCappedLifecycleAverages(agg.Samples, maxFiatLimitEUR, offerString(o, "exchange"), offerString(o, "direction"), requiredConfirmations, excludedCEXes, feeTier)
			if cappedAvgProfitBTC == 0 && cappedRep.RouteCEX != "" {
				cappedAvgTradeCostPct = round4(cappedRep.TotalCostPct)
				cappedAvgNetPct = round4(cappedRep.EstimatedProfitPct)
				cappedAvgProfitBTC = round8(cappedRep.EstimatedProfitBTC)
				cappedAvgProfitFiat = round4(cappedRep.EstimatedProfitBTC * avgRefPrice)
				cappedAvgTradeCostBTC = round8(cappedRep.TotalCostBTC)
				cappedAvgNetworkPct = round4(cappedRep.NetworkFeePct)
			}
			capFiat := round4(maxFiatLimitEUR)
			cappedScenario = &pastOfferScenario{
				CapFiat:       &capFiat,
				TradeSizeBTC:  cappedTradeSizeBTC,
				TradeSizeFiat: round4(cappedTradeSizeBTC * avgRefPrice),
				Route: pastOfferRoute{
					CEX:        nonEmptyOr(cappedRep.RouteCEX, offerString(o, "best_route_cex")),
					Settlement: nonEmptyOr(cappedRep.RouteMethod, offerString(o, "best_route_method")),
				},
				Premium: pastOfferPremium{
					AvgTradeCostPercent: cappedAvgTradeCostPct,
					AvgNetPercent:       cappedAvgNetPct,
				},
				Profit: pastOfferProfit{
					AvgBTC:  cappedAvgProfitBTC,
					AvgFiat: cappedAvgProfitFiat,
				},
				Costs: buildPastScenarioCosts(cappedRep, cappedAvgNetworkPct, cappedAvgTradeCostPct, cappedAvgTradeCostBTC),
			}
		}
	}

	return pastOfferAPI{
		ID:            id,
		Exchange:      offerString(o, "exchange"),
		OfferID:       offerStringPtr(o, "offer_id"),
		PaymentMethod: offerStringPtr(o, "payment_method"),
		Direction:     offerString(o, "direction"),
		Status: pastOfferStatus{
			IsLive:    false,
			FirstSeen: firstSeen,
			LastSeen:  lastSeen,
			Duration:  duration,
		},
		Pricing: pastOfferPricing{
			PriceType:         normalizePastPriceType(offerString(o, "price_type")),
			FiatCurrency:      "EUR",
			AvgOfferPrice:     avgOfferPrice,
			AvgRefPrice:       avgRefPrice,
			AvgPremiumPercent: avgPremiumPercent,
		},
		VolumeLimits: pastOfferVolumeLimits{
			BTCMin:  btcMinPtr,
			BTCMax:  btcMaxPtr,
			FiatMin: offerInt64Ptr(o, "fiat_min"),
			FiatMax: offerInt64Ptr(o, "fiat_max"),
		},
		BTCNetworkFee: buildPastBTCNetworkFee(fullRep, requiredConfirmations),
		Analysis: pastOfferAnalysisAPI{
			FullVolume:   fullScenario,
			CappedVolume: cappedScenario,
		},
	}
}

func buildPastProfitableOrderAPI(o map[string]any, agg pastLifecycleAggregate, requiredConfirmations int, excludedCEXes []string, feeTier string, maxFiatLimitEUR float64, mode takerOpportunityMode) pastProfitableOrderAPI {
	pastOffer := buildPastOfferAPI(o, agg, requiredConfirmations, excludedCEXes, feeTier, maxFiatLimitEUR)
	recomputed := addPastOfferCostFieldsFull(o, requiredConfirmations, excludedCEXes, feeTier, maxFiatLimitEUR)
	tradeSizeBTC, netProfitBTC := recomputed.valuesForMode(mode)
	summary := pastProfitableOrderSummary{
		NetProfitBTC:  round8(netProfitBTC),
		NetProfitFiat: round4(netProfitBTC * recomputed.refPrice),
		TradeSizeBTC:  round8(tradeSizeBTC),
		TradeSizeFiat: round4(tradeSizeBTC * recomputed.refPrice),
		NetPercent:    pastOffer.Analysis.FullVolume.Premium.AvgNetPercent,
	}
	if mode == takerOpportunityModeNetCapped && pastOffer.Analysis.CappedVolume != nil {
		summary.NetPercent = pastOffer.Analysis.CappedVolume.Premium.AvgNetPercent
	}
	if pastOffer.Analysis.CappedVolume != nil {
		summary.CapFiat = pastOffer.Analysis.CappedVolume.CapFiat
	}

	return pastProfitableOrderAPI{
		ID:            pastOffer.ID,
		Exchange:      pastOffer.Exchange,
		OfferID:       pastOffer.OfferID,
		PaymentMethod: pastOffer.PaymentMethod,
		Direction:     pastOffer.Direction,
		Status:        pastOffer.Status,
		Pricing:       pastOffer.Pricing,
		Summary:       summary,
		Analysis:      pastOffer.Analysis,
		Offer:         buildOfferTablePayload(o),
	}
}

func buildPastOfferDuration(firstSeen, lastSeen time.Time) pastOfferDuration {
	if firstSeen.IsZero() || lastSeen.IsZero() || lastSeen.Before(firstSeen) {
		return pastOfferDuration{Display: "0h 0m"}
	}
	totalMinutes := int(lastSeen.Sub(firstSeen).Minutes())
	hours := totalMinutes / 60
	minutes := totalMinutes % 60
	return pastOfferDuration{
		Hours:   hours,
		Minutes: minutes,
		Display: fmt.Sprintf("%dh %dm", hours, minutes),
	}
}

func normalizePastPriceType(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "fixed":
		return "fixed"
	case "floating":
		return "floating"
	default:
		return "unknown"
	}
}

func computeRepresentativePastBreakdown(btcSize, refPrice float64, dexExchange, direction string, requiredConfirmations int, excludedCEXes []string, feeTier string) CostBreakdown {
	if tradeRouteOptimizer == nil || btcSize <= 0 || refPrice <= 0 {
		return CostBreakdown{}
	}
	requiredConfirmations = resolveRequiredConfirmations(direction, requiredConfirmations)
	return tradeRouteOptimizer.BestBreakdownFull(btcSize, refPrice, dexExchange, direction, requiredConfirmations, excludedCEXes, feeTier, true)
}

func recomputeCappedLifecycleAverages(samples []pastLifecycleSample, maxFiatLimitEUR float64, dexExchange, direction string, requiredConfirmations int, excludedCEXes []string, feeTier string) (float64, float64, float64, float64, float64, float64) {
	if len(samples) == 0 || maxFiatLimitEUR <= 0 {
		return 0, 0, 0, 0, 0, 0
	}
	var count int
	var sumTradeCostPct, sumNetPct, sumProfitBTC, sumProfitFiat, sumTradeCostBTC, sumNetworkPct float64
	for _, sample := range samples {
		if sample.RefPrice <= 0 {
			continue
		}
		btcCap := maxFiatLimitEUR / sample.RefPrice
		if btcCap <= 0 {
			continue
		}
		tradeCostPct, netPct, bd := computeNetPremiumFieldsFull(sample.PremiumPct, btcCap, sample.RefPrice, dexExchange, direction, requiredConfirmations, excludedCEXes, feeTier, true)
		if bd.RouteCEX == "" {
			continue
		}
		count++
		sumTradeCostPct += tradeCostPct
		sumNetPct += netPct
		sumProfitBTC += bd.EstimatedProfitBTC
		sumProfitFiat += bd.EstimatedProfitBTC * sample.RefPrice
		sumTradeCostBTC += bd.TotalCostBTC
		sumNetworkPct += bd.NetworkFeePct
	}
	if count == 0 {
		return 0, 0, 0, 0, 0, 0
	}
	return round4(sumTradeCostPct / float64(count)),
		round4(sumNetPct / float64(count)),
		round8(sumProfitBTC / float64(count)),
		round4(sumProfitFiat / float64(count)),
		round8(sumTradeCostBTC / float64(count)),
		round4(sumNetworkPct / float64(count))
}

func buildPastScenarioCosts(rep CostBreakdown, avgNetworkPct, avgTradeCostPct, avgTradeCostBTC float64) pastOfferScenarioCosts {
	return pastOfferScenarioCosts{
		CexTaker: pastOfferCostValue{
			Pct: rep.CexTakerFeePct,
			BTC: rep.CexTakerFeeBTC,
		},
		Withdrawal: pastOfferCostValue{
			Pct: rep.WithdrawalFeePct,
			BTC: rep.WithdrawalFeeBTC,
		},
		DexFee: pastOfferCostValue{
			Pct: rep.DexFeePct,
			BTC: rep.DexFeeBTC,
		},
		Network: pastOfferCostValue{
			Pct:    rep.NetworkFeePct,
			BTC:    rep.NetworkFeeBTC,
			AvgPct: avgNetworkPct,
		},
		Hedge: pastOfferHedgeCosts{
			OpenFeePct:      rep.Hedge.OpenFeePct,
			OpenFeeBTC:      rep.Hedge.OpenFeeBTC,
			CloseFeePct:     rep.Hedge.CloseFeePct,
			CloseFeeBTC:     rep.Hedge.CloseFeeBTC,
			FundingFeePct:   rep.Hedge.FundingFeePct,
			FundingFeeBTC:   rep.Hedge.FundingFeeBTC,
			FeeSumPct:       rep.Hedge.FeeSumPct,
			FeeSumBTC:       rep.Hedge.FeeSumBTC,
			Venue:           rep.Hedge.Venue,
			Instrument:      rep.Hedge.Instrument,
			TransferMinutes: rep.Hedge.TransferMinutes,
			Position:        rep.Hedge.Position,
		},
		Total: pastOfferCostValue{
			Pct:    rep.TotalCostPct,
			BTC:    rep.TotalCostBTC,
			AvgPct: avgTradeCostPct,
			AvgBTC: avgTradeCostBTC,
		},
	}
}

func buildPastBTCNetworkFee(rep CostBreakdown, requiredConfirmations int) pastOfferBTCNetworkFee {
	arrival := 0
	numTxs := rep.NumNetworkTxs
	if rep.NetworkFeeDetail != nil {
		arrival = rep.NetworkFeeDetail.SelectedFullConfirmationMinutes
		if numTxs <= 0 {
			numTxs = rep.NetworkFeeDetail.NumTxs
		}
		if requiredConfirmations <= 0 {
			requiredConfirmations = rep.NetworkFeeDetail.RequiredConfirmations
		}
	}
	return pastOfferBTCNetworkFee{
		BTC:                     rep.NetworkFeeBTC,
		Method:                  rep.NetworkFeeMethod,
		Tier:                    rep.NetworkFeeTier,
		Confidence:              rep.NetworkFeeConfidence,
		NumTxs:                  numTxs,
		RequiredConfirmations:   requiredConfirmations,
		EstimatedArrivalMinutes: arrival,
		Detail:                  rep.NetworkFeeDetail,
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

type tradingAccount struct {
	ID                 int64               `json:"id"`
	Provider           string              `json:"provider"`
	Email              *string             `json:"email"`
	Password           *string             `json:"password"`
	Phone              *string             `json:"phone"`
	CreatedAt          string              `json:"created_at"`
	UpdatedAt          string              `json:"updated_at"`
	TOTPSecrets        []tradingTOTPSecret `json:"totp_secrets"`
	PasskeyCredentials []tradingPasskey    `json:"passkey_credentials"`
	Seeds              []tradingSeed       `json:"seeds"`
	APIKeys            []tradingAPIKey     `json:"api_keys"`
}

type tradingTOTPSecret struct {
	ID        int64   `json:"id"`
	AccountID int64   `json:"account_id"`
	Secret    string  `json:"secret"`
	IsActive  bool    `json:"is_active"`
	CreatedAt string  `json:"created_at"`
	RotatedAt *string `json:"rotated_at"`
}

type tradingPasskey struct {
	ID              int64   `json:"id"`
	AccountID       int64   `json:"account_id"`
	CredentialID    string  `json:"credential_id"`
	RPID            string  `json:"rp_id"`
	PrivateKeyPKCS8 string  `json:"private_key_pkcs8"`
	UserHandle      string  `json:"user_handle"`
	SignCount       int64   `json:"sign_count"`
	IsActive        bool    `json:"is_active"`
	CreatedAt       string  `json:"created_at"`
	LastUsedAt      *string `json:"last_used_at"`
}

type tradingSeed struct {
	ID              int64   `json:"id"`
	AccountID       int64   `json:"account_id"`
	SeedPhrase      string  `json:"seed_phrase"`
	WalletCreatedAt *string `json:"wallet_created_at"`
	CreatedAt       string  `json:"created_at"`
}

type tradingAPIKey struct {
	ID         int64   `json:"id"`
	AccountID  int64   `json:"account_id"`
	Name       string  `json:"name"`
	APIKey     string  `json:"api_key"`
	APISecret  *string `json:"api_secret"`
	Passphrase *string `json:"passphrase"`
	IsActive   bool    `json:"is_active"`
	CreatedAt  string  `json:"created_at"`
	UpdatedAt  string  `json:"updated_at"`
}

type tradingAccountPayload struct {
	Provider string `json:"provider"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Phone    string `json:"phone"`
}

type tradingTOTPSecretPayload struct {
	Secret   string `json:"secret"`
	IsActive bool   `json:"is_active"`
}

type tradingPasskeyPayload struct {
	CredentialID    string  `json:"credential_id"`
	RPID            string  `json:"rp_id"`
	PrivateKeyPKCS8 string  `json:"private_key_pkcs8"`
	UserHandle      string  `json:"user_handle"`
	SignCount       int64   `json:"sign_count"`
	IsActive        bool    `json:"is_active"`
	LastUsedAt      *string `json:"last_used_at"`
}

type tradingSeedPayload struct {
	SeedPhrase      string  `json:"seed_phrase"`
	WalletCreatedAt *string `json:"wallet_created_at"`
}

type tradingAPIKeyPayload struct {
	Name       string  `json:"name"`
	APIKey     string  `json:"api_key"`
	APISecret  *string `json:"api_secret"`
	Passphrase *string `json:"passphrase"`
	IsActive   bool    `json:"is_active"`
}

func handleTradingAccounts(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		accounts, err := loadTradingAccounts(r.Context())
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, accounts)
	case http.MethodPost:
		var payload tradingAccountPayload
		if err := decodeJSON(r, &payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		id, err := createTradingAccount(r.Context(), payload)
		if err != nil {
			writeError(w, err)
			return
		}
		account, err := loadTradingAccountByID(r.Context(), id)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, account)
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleTradingAccountByID(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodPut:
		var payload tradingAccountPayload
		if err := decodeJSON(r, &payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := updateTradingAccount(r.Context(), id, payload); err != nil {
			writeError(w, err)
			return
		}
		account, err := loadTradingAccountByID(r.Context(), id)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, account)
	case http.MethodDelete:
		if _, err := db.ExecContext(r.Context(), `DELETE FROM accounts WHERE id = $1`, id); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleTradingAccountTOTPSecrets(w http.ResponseWriter, r *http.Request) {
	accountID, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var payload tradingTOTPSecretPayload
	if err := decodeJSON(r, &payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var id int64
	if err := db.QueryRowContext(r.Context(), `
		INSERT INTO totp_secrets (account_id, secret, is_active)
		VALUES ($1, $2, $3)
		RETURNING id
	`, accountID, strings.TrimSpace(payload.Secret), payload.IsActive).Scan(&id); err != nil {
		writeError(w, err)
		return
	}
	row, err := loadTradingTOTPSecretByID(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, row)
}

func handleTradingTOTPSecretByID(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodPut:
		var payload tradingTOTPSecretPayload
		if err := decodeJSON(r, &payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if _, err := db.ExecContext(r.Context(), `
			UPDATE totp_secrets
			SET secret = $2, is_active = $3
			WHERE id = $1
		`, id, strings.TrimSpace(payload.Secret), payload.IsActive); err != nil {
			writeError(w, err)
			return
		}
		row, err := loadTradingTOTPSecretByID(r.Context(), id)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, row)
	case http.MethodDelete:
		if _, err := db.ExecContext(r.Context(), `DELETE FROM totp_secrets WHERE id = $1`, id); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleTradingAccountPasskeys(w http.ResponseWriter, r *http.Request) {
	accountID, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var payload tradingPasskeyPayload
	if err := decodeJSON(r, &payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var id int64
	if err := db.QueryRowContext(r.Context(), `
		INSERT INTO passkey_credentials (
			account_id, credential_id, rp_id, private_key_pkcs8, user_handle, sign_count, is_active, last_used_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, '')::timestamptz)
		RETURNING id
	`, accountID, payload.CredentialID, payload.RPID, payload.PrivateKeyPKCS8, payload.UserHandle, payload.SignCount, payload.IsActive, stringOrEmpty(payload.LastUsedAt)).Scan(&id); err != nil {
		writeError(w, err)
		return
	}
	row, err := loadTradingPasskeyByID(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, row)
}

func handleTradingPasskeyByID(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodPut:
		var payload tradingPasskeyPayload
		if err := decodeJSON(r, &payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if _, err := db.ExecContext(r.Context(), `
			UPDATE passkey_credentials
			SET credential_id = $2,
			    rp_id = $3,
			    private_key_pkcs8 = $4,
			    user_handle = $5,
			    sign_count = $6,
			    is_active = $7,
			    last_used_at = NULLIF($8, '')::timestamptz
			WHERE id = $1
		`, id, payload.CredentialID, payload.RPID, payload.PrivateKeyPKCS8, payload.UserHandle, payload.SignCount, payload.IsActive, stringOrEmpty(payload.LastUsedAt)); err != nil {
			writeError(w, err)
			return
		}
		row, err := loadTradingPasskeyByID(r.Context(), id)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, row)
	case http.MethodDelete:
		if _, err := db.ExecContext(r.Context(), `DELETE FROM passkey_credentials WHERE id = $1`, id); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleTradingAccountSeeds(w http.ResponseWriter, r *http.Request) {
	accountID, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var payload tradingSeedPayload
	if err := decodeJSON(r, &payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var id int64
	if err := db.QueryRowContext(r.Context(), `
		INSERT INTO seeds (account_id, seed_phrase, wallet_created_at)
		VALUES ($1, $2, NULLIF($3, '')::timestamptz)
		RETURNING id
	`, accountID, payload.SeedPhrase, stringOrEmpty(payload.WalletCreatedAt)).Scan(&id); err != nil {
		writeError(w, err)
		return
	}
	row, err := loadTradingSeedByID(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, row)
}

func handleTradingSeedByID(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodPut:
		var payload tradingSeedPayload
		if err := decodeJSON(r, &payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if _, err := db.ExecContext(r.Context(), `
			UPDATE seeds
			SET seed_phrase = $2,
			    wallet_created_at = NULLIF($3, '')::timestamptz
			WHERE id = $1
		`, id, payload.SeedPhrase, stringOrEmpty(payload.WalletCreatedAt)); err != nil {
			writeError(w, err)
			return
		}
		row, err := loadTradingSeedByID(r.Context(), id)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, row)
	case http.MethodDelete:
		if _, err := db.ExecContext(r.Context(), `DELETE FROM seeds WHERE id = $1`, id); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleTradingAccountAPIKeys(w http.ResponseWriter, r *http.Request) {
	accountID, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var payload tradingAPIKeyPayload
	if err := decodeJSON(r, &payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var id int64
	if err := db.QueryRowContext(r.Context(), `
		INSERT INTO api_keys (account_id, name, api_key, api_secret, passphrase, is_active)
		VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6)
		RETURNING id
	`, accountID, payload.Name, payload.APIKey, stringOrEmpty(payload.APISecret), stringOrEmpty(payload.Passphrase), payload.IsActive).Scan(&id); err != nil {
		writeError(w, err)
		return
	}
	row, err := loadTradingAPIKeyByID(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, row)
}

func handleTradingAPIKeyByID(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodPut:
		var payload tradingAPIKeyPayload
		if err := decodeJSON(r, &payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if _, err := db.ExecContext(r.Context(), `
			UPDATE api_keys
			SET name = $2,
			    api_key = $3,
			    api_secret = NULLIF($4, ''),
			    passphrase = NULLIF($5, ''),
			    is_active = $6,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = $1
		`, id, payload.Name, payload.APIKey, stringOrEmpty(payload.APISecret), stringOrEmpty(payload.Passphrase), payload.IsActive); err != nil {
			writeError(w, err)
			return
		}
		row, err := loadTradingAPIKeyByID(r.Context(), id)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, row)
	case http.MethodDelete:
		if _, err := db.ExecContext(r.Context(), `DELETE FROM api_keys WHERE id = $1`, id); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func loadTradingAccounts(ctx context.Context) ([]tradingAccount, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT id, provider, email, password, phone, created_at, updated_at
		FROM accounts
		ORDER BY provider, id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	accounts := make([]tradingAccount, 0)
	accountIDs := make([]int64, 0)
	accountMap := make(map[int64]*tradingAccount)
	for rows.Next() {
		var account tradingAccount
		var email, password, phone sql.NullString
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&account.ID, &account.Provider, &email, &password, &phone, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		account.Email = nullStringPtr(email)
		account.Password = nullStringPtr(password)
		account.Phone = nullStringPtr(phone)
		account.CreatedAt = formatTime(createdAt)
		account.UpdatedAt = formatTime(updatedAt)
		account.TOTPSecrets = []tradingTOTPSecret{}
		account.PasskeyCredentials = []tradingPasskey{}
		account.Seeds = []tradingSeed{}
		account.APIKeys = []tradingAPIKey{}
		accounts = append(accounts, account)
		accountIDs = append(accountIDs, account.ID)
		accountMap[account.ID] = &accounts[len(accounts)-1]
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(accountIDs) == 0 {
		return accounts, nil
	}

	if err := appendTradingTOTPSecrets(ctx, accountMap, accountIDs); err != nil {
		return nil, err
	}
	if err := appendTradingPasskeys(ctx, accountMap, accountIDs); err != nil {
		return nil, err
	}
	if err := appendTradingSeeds(ctx, accountMap, accountIDs); err != nil {
		return nil, err
	}
	if err := appendTradingAPIKeys(ctx, accountMap, accountIDs); err != nil {
		return nil, err
	}

	return accounts, nil
}

func loadTradingAccountByID(ctx context.Context, id int64) (*tradingAccount, error) {
	accounts, err := loadTradingAccounts(ctx)
	if err != nil {
		return nil, err
	}
	for i := range accounts {
		if accounts[i].ID == id {
			return &accounts[i], nil
		}
	}
	return nil, sql.ErrNoRows
}

func appendTradingTOTPSecrets(ctx context.Context, accountMap map[int64]*tradingAccount, accountIDs []int64) error {
	rows, err := db.QueryContext(ctx, `
		SELECT id, account_id, secret, is_active, created_at, rotated_at
		FROM totp_secrets
		WHERE account_id = ANY($1)
		ORDER BY created_at DESC, id DESC
	`, accountIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item tradingTOTPSecret
		var createdAt time.Time
		var rotatedAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.AccountID, &item.Secret, &item.IsActive, &createdAt, &rotatedAt); err != nil {
			return err
		}
		item.CreatedAt = formatTime(createdAt)
		item.RotatedAt = nullTimePtr(rotatedAt)
		if account := accountMap[item.AccountID]; account != nil {
			account.TOTPSecrets = append(account.TOTPSecrets, item)
		}
	}
	return rows.Err()
}

func appendTradingPasskeys(ctx context.Context, accountMap map[int64]*tradingAccount, accountIDs []int64) error {
	rows, err := db.QueryContext(ctx, `
		SELECT id, account_id, credential_id, rp_id, private_key_pkcs8, user_handle, sign_count, is_active, created_at, last_used_at
		FROM passkey_credentials
		WHERE account_id = ANY($1)
		ORDER BY created_at DESC, id DESC
	`, accountIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item tradingPasskey
		var createdAt time.Time
		var lastUsedAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.AccountID, &item.CredentialID, &item.RPID, &item.PrivateKeyPKCS8, &item.UserHandle, &item.SignCount, &item.IsActive, &createdAt, &lastUsedAt); err != nil {
			return err
		}
		item.CreatedAt = formatTime(createdAt)
		item.LastUsedAt = nullTimePtr(lastUsedAt)
		if account := accountMap[item.AccountID]; account != nil {
			account.PasskeyCredentials = append(account.PasskeyCredentials, item)
		}
	}
	return rows.Err()
}

func appendTradingSeeds(ctx context.Context, accountMap map[int64]*tradingAccount, accountIDs []int64) error {
	rows, err := db.QueryContext(ctx, `
		SELECT id, account_id, seed_phrase, wallet_created_at, created_at
		FROM seeds
		WHERE account_id = ANY($1)
		ORDER BY created_at DESC, id DESC
	`, accountIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item tradingSeed
		var walletCreatedAt sql.NullTime
		var createdAt time.Time
		if err := rows.Scan(&item.ID, &item.AccountID, &item.SeedPhrase, &walletCreatedAt, &createdAt); err != nil {
			return err
		}
		item.WalletCreatedAt = nullTimePtr(walletCreatedAt)
		item.CreatedAt = formatTime(createdAt)
		if account := accountMap[item.AccountID]; account != nil {
			account.Seeds = append(account.Seeds, item)
		}
	}
	return rows.Err()
}

func appendTradingAPIKeys(ctx context.Context, accountMap map[int64]*tradingAccount, accountIDs []int64) error {
	rows, err := db.QueryContext(ctx, `
		SELECT id, account_id, name, api_key, api_secret, passphrase, is_active, created_at, updated_at
		FROM api_keys
		WHERE account_id = ANY($1)
		ORDER BY updated_at DESC, id DESC
	`, accountIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item tradingAPIKey
		var apiSecret, passphrase sql.NullString
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&item.ID, &item.AccountID, &item.Name, &item.APIKey, &apiSecret, &passphrase, &item.IsActive, &createdAt, &updatedAt); err != nil {
			return err
		}
		item.APISecret = nullStringPtr(apiSecret)
		item.Passphrase = nullStringPtr(passphrase)
		item.CreatedAt = formatTime(createdAt)
		item.UpdatedAt = formatTime(updatedAt)
		if account := accountMap[item.AccountID]; account != nil {
			account.APIKeys = append(account.APIKeys, item)
		}
	}
	return rows.Err()
}

func createTradingAccount(ctx context.Context, payload tradingAccountPayload) (int64, error) {
	provider := normalizeProvider(payload.Provider)
	var id int64
	err := db.QueryRowContext(ctx, `
		INSERT INTO accounts (provider, email, password, phone)
		VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''))
		RETURNING id
	`, provider, strings.TrimSpace(payload.Email), strings.TrimSpace(payload.Password), strings.TrimSpace(payload.Phone)).Scan(&id)
	return id, err
}

func updateTradingAccount(ctx context.Context, id int64, payload tradingAccountPayload) error {
	_, err := db.ExecContext(ctx, `
		UPDATE accounts
		SET provider = $2,
		    email = NULLIF($3, ''),
		    password = NULLIF($4, ''),
		    phone = NULLIF($5, ''),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, normalizeProvider(payload.Provider), strings.TrimSpace(payload.Email), strings.TrimSpace(payload.Password), strings.TrimSpace(payload.Phone))
	return err
}

func loadTradingTOTPSecretByID(ctx context.Context, id int64) (*tradingTOTPSecret, error) {
	var item tradingTOTPSecret
	var createdAt time.Time
	var rotatedAt sql.NullTime
	err := db.QueryRowContext(ctx, `
		SELECT id, account_id, secret, is_active, created_at, rotated_at
		FROM totp_secrets
		WHERE id = $1
	`, id).Scan(&item.ID, &item.AccountID, &item.Secret, &item.IsActive, &createdAt, &rotatedAt)
	if err != nil {
		return nil, err
	}
	item.CreatedAt = formatTime(createdAt)
	item.RotatedAt = nullTimePtr(rotatedAt)
	return &item, nil
}

func loadTradingPasskeyByID(ctx context.Context, id int64) (*tradingPasskey, error) {
	var item tradingPasskey
	var createdAt time.Time
	var lastUsedAt sql.NullTime
	err := db.QueryRowContext(ctx, `
		SELECT id, account_id, credential_id, rp_id, private_key_pkcs8, user_handle, sign_count, is_active, created_at, last_used_at
		FROM passkey_credentials
		WHERE id = $1
	`, id).Scan(&item.ID, &item.AccountID, &item.CredentialID, &item.RPID, &item.PrivateKeyPKCS8, &item.UserHandle, &item.SignCount, &item.IsActive, &createdAt, &lastUsedAt)
	if err != nil {
		return nil, err
	}
	item.CreatedAt = formatTime(createdAt)
	item.LastUsedAt = nullTimePtr(lastUsedAt)
	return &item, nil
}

func loadTradingSeedByID(ctx context.Context, id int64) (*tradingSeed, error) {
	var item tradingSeed
	var walletCreatedAt sql.NullTime
	var createdAt time.Time
	err := db.QueryRowContext(ctx, `
		SELECT id, account_id, seed_phrase, wallet_created_at, created_at
		FROM seeds
		WHERE id = $1
	`, id).Scan(&item.ID, &item.AccountID, &item.SeedPhrase, &walletCreatedAt, &createdAt)
	if err != nil {
		return nil, err
	}
	item.WalletCreatedAt = nullTimePtr(walletCreatedAt)
	item.CreatedAt = formatTime(createdAt)
	return &item, nil
}

func loadTradingAPIKeyByID(ctx context.Context, id int64) (*tradingAPIKey, error) {
	var item tradingAPIKey
	var apiSecret, passphrase sql.NullString
	var createdAt, updatedAt time.Time
	err := db.QueryRowContext(ctx, `
		SELECT id, account_id, name, api_key, api_secret, passphrase, is_active, created_at, updated_at
		FROM api_keys
		WHERE id = $1
	`, id).Scan(&item.ID, &item.AccountID, &item.Name, &item.APIKey, &apiSecret, &passphrase, &item.IsActive, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	item.APISecret = nullStringPtr(apiSecret)
	item.Passphrase = nullStringPtr(passphrase)
	item.CreatedAt = formatTime(createdAt)
	item.UpdatedAt = formatTime(updatedAt)
	return &item, nil
}

func decodeJSON(r *http.Request, dest any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(dest)
}

func pathID(r *http.Request, name string) (int64, error) {
	id, err := strconv.ParseInt(strings.TrimSpace(r.PathValue(name)), 10, 64)
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("invalid id")
	}
	return id, nil
}

func normalizeProvider(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	v := value.String
	return &v
}

func nullTimePtr(value sql.NullTime) *string {
	if !value.Valid {
		return nil
	}
	v := formatTime(value.Time)
	return &v
}

func formatTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339)
}

func stringOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
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

func offerStringPtr(o map[string]any, key string) *string {
	if v := offerString(o, key); v != "" {
		return &v
	}
	return nil
}

func offerInt64Ptr(o map[string]any, key string) *int64 {
	if v := offerFloat(o, key); v != 0 {
		out := int64(v)
		return &out
	}
	return nil
}

func buildOfferTablePayload(o map[string]any) map[string]any {
	return map[string]any{
		"id":                         int64(offerFloat(o, "id")),
		"exchange":                   offerString(o, "exchange"),
		"direction":                  offerString(o, "direction"),
		"price":                      offerFloatPtr(o, "price"),
		"price_diff_percent":         offerFloatPtr(o, "price_diff_percent"),
		"btc_min":                    offerFloatPtr(o, "btc_min"),
		"btc_max":                    offerFloatPtr(o, "btc_max"),
		"fiat_min":                   offerInt64Ptr(o, "fiat_min"),
		"fiat_max":                   offerInt64Ptr(o, "fiat_max"),
		"payment_method":             offerStringPtr(o, "payment_method"),
		"offer_id":                   offerStringPtr(o, "offer_id"),
		"first_seen":                 nilIfEmpty(offerString(o, "first_seen")),
		"last_seen":                  nilIfEmpty(offerString(o, "last_seen")),
		"is_live":                    offerBool(o, "is_live"),
		"duration":                   offerInt64Ptr(o, "duration"),
		"historical_analysis_status": nilIfEmpty(offerString(o, "historical_analysis_status")),
		"avg_ref_price":              offerFloatPtr(o, "avg_ref_price"),
		"avg_premium_pct":            offerFloatPtr(o, "avg_premium_pct"),
		"avg_trade_cost_pct":         offerFloatPtr(o, "avg_trade_cost_pct"),
		"avg_trade_cost_btc":         offerFloatPtr(o, "avg_trade_cost_btc"),
		"avg_hedge_fee_sum_btc":      offerFloatPtr(o, "avg_hedge_fee_sum_btc"),
		"cex_taker_fee_btc":          offerFloatPtr(o, "cex_taker_fee_btc"),
		"cex_withdraw_fee_btc":       offerFloatPtr(o, "cex_withdraw_fee_btc"),
		"network_fee_btc":            offerFloatPtr(o, "network_fee_btc"),
		"hedge_open_fee_btc":         offerFloatPtr(o, "hedge_open_fee_btc"),
		"hedge_close_fee_btc":        offerFloatPtr(o, "hedge_close_fee_btc"),
		"hedge_funding_fee_btc":      offerFloatPtr(o, "hedge_funding_fee_btc"),
		"hedge_fee_sum_btc":          offerFloatPtr(o, "hedge_fee_sum_btc"),
		"hedge_venue":                offerStringPtr(o, "hedge_venue"),
		"hedge_instrument":           offerStringPtr(o, "hedge_instrument"),
		"hedge_transfer_minutes":     offerInt64Ptr(o, "hedge_transfer_minutes"),
		"dex_fee_btc":                offerFloatPtr(o, "dex_fee_btc"),
		"avg_net_premium_pct":        offerFloatPtr(o, "avg_net_premium_pct"),
		"avg_estimated_profit_btc":   offerFloatPtr(o, "avg_estimated_profit_btc"),
		"avg_estimated_profit_fiat":  offerFloatPtr(o, "avg_estimated_profit_fiat"),
		"avg_btc_amount":             offerFloatPtr(o, "avg_btc_amount"),
		"price_type":                 nilIfEmpty(offerString(o, "price_type")),
		"best_route_cex":             nilIfEmpty(offerString(o, "best_route_cex")),
		"best_route_method":          nilIfEmpty(offerString(o, "best_route_method")),
	}
}

func nilIfEmpty(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func offerFloatPtr(o map[string]any, key string) *float64 {
	if v := offerFloat(o, key); v != 0 {
		out := v
		return &out
	}
	return nil
}

func nonEmptyOr(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
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

func queryTakerOpportunityMode(r *http.Request) takerOpportunityMode {
	switch strings.TrimSpace(r.URL.Query().Get("premium_mode")) {
	case string(takerOpportunityModeNetCapped):
		return takerOpportunityModeNetCapped
	default:
		return takerOpportunityModeNetFull
	}
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
