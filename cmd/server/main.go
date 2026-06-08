package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"commons/logging"
	"commons/metrics"
	"commons/prices"
	"commons/tracing"
	"commons/tradecost"
	"dexmonitor/internal/lifecycle"
	"dexmonitor/internal/mmproxy"
	"dexmonitor/internal/ohlc"
	"dexmonitor/internal/pastorders"
	"dexmonitor/internal/paymentmethods"
	"dexmonitor/internal/snapshotlog"
	"dexmonitor/internal/tradingaccounts"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// serviceName is the OpenTelemetry/logging identity for this binary.
const serviceName = "dexmonitor"

var (
	databaseURL         string
	snapshotIntervalMin int
	frontendDir         string
	mmControllerAPIURL  string
	unifiedAPIURL       string
	db                  *sql.DB
	pmService           *paymentmethods.Service
	priceManager        *prices.Manager
	lifecycleRepo       lifecycle.Repository
	ohlcService         *ohlc.Service
	snapshotLogRepo     snapshotlog.Repository
	mmProxy             *mmproxy.Proxy
	tradingAccountRepo  tradingaccounts.Repository
)

var (
	cexPricesMu sync.RWMutex
	cexPrices   = map[string]float64{}
)

var (
	snapshotPriceCacheMu  sync.Mutex
	snapshotPriceCacheVal float64
	snapshotPriceCacheAt  time.Time
)

const snapshotPriceCacheTTL = 30 * time.Second

// dashboardCacheTTL deduplicates parallel general_stats and lifecycle aggregate loads.
const dashboardCacheTTL = 30 * time.Second

const defaultCEX = "kraken"

var generalStatsCache struct {
	sync.Mutex
	entries map[string]generalStatsCacheEntry
}

type generalStatsCacheEntry struct {
	ctx    generalStatsContext
	expiry time.Time
}

var lifecycleAggCache struct {
	sync.Mutex
	key    string
	result map[int64]pastLifecycleAggregate
	expiry time.Time
}

// supportedCEXes lists all exchanges available for selection in the UI.
var supportedCEXes = tradecost.SupportedCEXes()

var tradeCostEstimators map[string]*tradecost.TradeCostEstimator
var tradeRouteOptimizer *tradecost.TradeRouteOptimizer

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
	var p float64
	if priceManager != nil {
		p = priceManager.Get(cex)
	} else {
		cexPricesMu.RLock()
		p = cexPrices[cex]
		cexPricesMu.RUnlock()
	}
	if p > 0 {
		return p
	}
	// Live feed (WS) hasn't produced a price yet — fall back to the most recent
	// BTC price the snapshot tool stored. This keeps lifecycle writes working
	// even if the dexMonitor server can't reach the CEX WS endpoint at all
	// (firewall, TLS, DNS, etc. on the VPS).
	return latestSnapshotPrice()
}

// latestSnapshotPrice returns the most recent btc_price from the snapshots
// table, cached briefly so that frequent lookups don't hammer the DB.
// Returns 0 if no snapshot has been written yet or the DB query fails.
func latestSnapshotPrice() float64 {
	snapshotPriceCacheMu.Lock()
	defer snapshotPriceCacheMu.Unlock()
	if time.Since(snapshotPriceCacheAt) < snapshotPriceCacheTTL {
		return snapshotPriceCacheVal
	}
	snapshotPriceCacheAt = time.Now()
	if db == nil {
		snapshotPriceCacheVal = 0
		return 0
	}
	var price float64
	err := db.QueryRow(`SELECT btc_price FROM snapshots ORDER BY timestamp DESC LIMIT 1`).Scan(&price)
	if err != nil {
		if err != sql.ErrNoRows {
			fmt.Printf("[priceFallback] snapshots query error: %v\n", err)
		}
		snapshotPriceCacheVal = 0
		return 0
	}
	snapshotPriceCacheVal = price
	return price
}

func setCexPrice(cex string, p float64) {
	if priceManager != nil {
		priceManager.Set(cex, p)
		return
	}
	cexPricesMu.Lock()
	cexPrices[cex] = p
	cexPricesMu.Unlock()
	hub.broadcastForCex(cex)
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
	unifiedAPIURL = os.Getenv("UNIFIED_API_URL")
	if unifiedAPIURL == "" {
		unifiedAPIURL = "http://localhost:5010"
	}
}

func main() {
	logging.Init(serviceName)
	tpShutdown, terr := tracing.Init(context.Background(), serviceName)
	if terr != nil {
		slog.Warn("tracing init failed; continuing without traces", "err", terr)
	}
	defer func() { _ = tpShutdown(context.Background()) }()

	var err error
	db, err = sql.Open("pgx", databaseURL)
	if err != nil {
		slog.Error("failed to open database", "err", err)
		os.Exit(1)
	}
	defer db.Close()

	// Dashboard load fans out 15+ parallel handlers; 4 connections caused long
	// queueing and proxy 502s under burst (unified-api uses 12).
	db.SetMaxOpenConns(12)
	db.SetMaxIdleConns(4)
	lifecycleRepo = lifecycle.NewRepository(db)
	ohlcService = ohlc.NewService()
	snapshotLogRepo = snapshotlog.NewRepository(db)
	mmProxy = mmproxy.New(mmControllerAPIURL)
	tradingAccountRepo = tradingaccounts.NewRepository(db)

	tradeCostEstimators = make(map[string]*tradecost.TradeCostEstimator, len(supportedCEXes))
	for _, c := range supportedCEXes {
		tradeCostEstimators[c] = tradecost.NewTradeCostEstimator(c)
		slog.Info("trade-cost estimator initialized",
			"cex", c,
			"taker_fallback_pct", tradecost.TakerFeeFallback(c)*100,
			"onchain_withdrawal_fallback_btc", tradecost.WithdrawalFallback(c, tradecost.MethodOnchain))
	}
	tradeRouteOptimizer = tradecost.NewOptimizer(supportedCEXes, tradeCostEstimators)

	// Start WebSocket price feeds for all supported CEX exchanges
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	priceManager = prices.NewManager(supportedCEXes)
	priceManager.SetUpdateCallback(func(cex string) {
		hub.broadcastForCex(cex)
	})

	// Metrics registry — created before the feeds start so price-feed health is
	// reported from the first connection.
	metricsReg := metrics.NewServiceRegistry("dexmonitor")
	priceManager.SetMetrics(prices.NewMetrics(metricsReg.Registry))

	priceManager.Start(ctx)

	// Visibility aid: 30s after startup, log live feed prices so an operator can
	// immediately tell whether the WS feeds connected. The fallback to the
	// snapshots table keeps the system working without this, but a silent feed
	// outage is exactly what masked the empty-lifecycle bug before.
	go func() {
		select {
		case <-time.After(30 * time.Second):
		case <-ctx.Done():
			return
		}
		parts := make([]string, 0, len(supportedCEXes))
		var defaultMissing bool
		for _, c := range supportedCEXes {
			p := priceManager.Get(c)
			parts = append(parts, fmt.Sprintf("%s=%.2f", c, p))
			if c == defaultCEX && p <= 0 {
				defaultMissing = true
			}
		}
		slog.InfoContext(ctx, "price feeds post-start prices", "prices", strings.Join(parts, " "))
		if defaultMissing {
			slog.WarnContext(ctx, "default price feed has no price after 30s — lifecycle writes will fall back to snapshots table", "cex", defaultCEX)
		}
	}()

	// Payment method grouping service — loads once at startup, refreshes every hour.
	if svc, err := paymentmethods.NewService(db); err != nil {
		slog.Warn("paymentmethods init warning", "err", err)
	} else {
		pmService = svc
		go pmService.RefreshLoop(ctx, time.Hour)
	}

	mux := http.NewServeMux()

	// API
	mux.HandleFunc("GET /api/past_offers", handlePastOffers)
	mux.HandleFunc("GET /api/past_offers/{id}/lifecycle", handlePastOfferLifecycle)
	mux.HandleFunc("GET /api/past_order_stats", handlePastOrderStats)
	mux.HandleFunc("GET /api/past_profitable_orders", handlePastProfitableOrders)
	mux.HandleFunc("GET /api/general_stats/overview", handleGeneralStatsOverview)
	mux.HandleFunc("GET /api/general_stats/open_premiums", handleGeneralStatsOpenPremiums)
	mux.HandleFunc("GET /api/general_stats/past_premiums", handleGeneralStatsPastPremiums)
	mux.HandleFunc("GET /api/general_stats/lifetimes", handleGeneralStatsLifetimes)
	mux.HandleFunc("GET /api/general_stats/payment_methods", handleGeneralStatsPaymentMethods)
	mux.HandleFunc("POST /api/dashboard/analytics", handleDashboardAnalytics)
	mux.HandleFunc("GET /api/live_offers", handleLiveOffersREST)
	mux.HandleFunc("GET /ws/live_offers", handleLiveOffersWS)
	mux.HandleFunc("GET /api/stats", handleStats)
	mux.HandleFunc("GET /api/ohlc", handleOHLC)
	mux.HandleFunc("GET /api/snapshot-log", handleSnapshotLog)
	mux.HandleFunc("GET /api/snapshot-log/{id}", handleSnapshotLogDetail)
	mux.HandleFunc("GET /api/payment_method_groups", handlePaymentMethodGroups)
	mux.HandleFunc("GET /api/trade_cost_config", handleTradeCostConfig)
	mux.HandleFunc("GET /api/mm-controller/transactions", handleMmControllerTransactions)
	mux.HandleFunc("GET /api/mm-controller/transactions/{id}", handleMmControllerTransactionByID)
	mux.HandleFunc("GET /api/trading/accounts", handleTradingAccounts)
	mux.HandleFunc("POST /api/trading/accounts", handleTradingAccounts)
	mux.HandleFunc("PUT /api/trading/accounts/{id}", handleTradingAccountByID)
	mux.HandleFunc("DELETE /api/trading/accounts/{id}", handleTradingAccountByID)
	mux.HandleFunc("POST /api/trading/accounts/{id}/health_check", handleTradingAccountHealthCheck)
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

	mux.Handle("GET /metrics", metricsReg.Handler())

	// Static frontend: full Vite dist tree (assets/, brand/, favicon.svg, …).
	// Registered after API routes; literal patterns beat the {path...} wildcard.
	mux.HandleFunc("GET /{$}", serveFrontend)
	mux.HandleFunc("GET /{path...}", serveDistStatic)

	// tracing.WrapHandler outermost starts the server span and continues inbound
	// trace context; RouteNamer innermost names the span by matched route.
	handler := tracing.WrapHandler(
		corsMiddleware(metricsReg.Middleware(tracing.RouteNamer(mux))),
		serviceName,
	)

	srv := &http.Server{Addr: ":5000", Handler: handler}
	go func() {
		slog.Info("starting orderbook API server", "addr", ":5000")
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "err", err)
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	slog.Info("shutting down")
	shutdownCtx, cancelShutdown := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelShutdown()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		slog.Error("graceful shutdown failed", "err", err)
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
	http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
}

func serveDistStatic(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(r.URL.Path, "/")
	if rel == "" || strings.Contains(rel, "..") {
		http.NotFound(w, r)
		return
	}
	full := filepath.Join(frontendDir, filepath.FromSlash(rel))
	if relPath, err := filepath.Rel(frontendDir, full); err != nil || strings.HasPrefix(relPath, "..") {
		http.NotFound(w, r)
		return
	}
	fi, err := os.Stat(full)
	if err != nil || fi.IsDir() {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, full)
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

	if queryBool(r, "compact") {
		result := make([]pastOfferCompactAPI, 0, len(filteredOffers))
		for _, o := range filteredOffers {
			result = append(result, buildPastOfferCompactAPI(o))
		}
		writeJSON(w, result)
		return
	}

	lifecycleAgg := fetchPastOfferLifecycleAggregates(ids)
	enrichLifecycleSamplesForCapped(lifecycleAgg, filteredOffers, maxFiatLimitEUR)
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
	if lifecycleRepo.DB != db && db != nil {
		lifecycleRepo = lifecycle.NewRepository(db)
	}
	points, err := lifecycleRepo.LoadByOfferIDs(context.Background(), ids)
	if err != nil {
		return result
	}
	for id, pts := range points {
		for _, pt := range pts {
			result[id] = append(result[id], LifecyclePoint{
				Time:          pt.Time,
				Price:         pt.Price,
				NetPremiumPct: pt.NetPremiumPct,
			})
		}
	}
	return result
}

func copyLifecycleAgg(src map[int64]pastLifecycleAggregate) map[int64]pastLifecycleAggregate {
	dst := make(map[int64]pastLifecycleAggregate, len(src))
	for id, agg := range src {
		dst[id] = agg
	}
	return dst
}

func lifecycleAggCacheKey(ids []int64) string {
	if len(ids) == 0 {
		return ""
	}
	sorted := append([]int64(nil), ids...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	return fmt.Sprintf("%d:%d:%d", len(sorted), sorted[0], sorted[len(sorted)-1])
}

func fetchPastOfferLifecycleAggregates(ids []int64) map[int64]pastLifecycleAggregate {
	result := make(map[int64]pastLifecycleAggregate, len(ids))
	if len(ids) == 0 {
		return result
	}
	key := lifecycleAggCacheKey(ids)
	now := time.Now()
	lifecycleAggCache.Lock()
	if lifecycleAggCache.result != nil && lifecycleAggCache.key == key && now.Before(lifecycleAggCache.expiry) {
		cached := lifecycleAggCache.result
		lifecycleAggCache.Unlock()
		return copyLifecycleAgg(cached)
	}
	lifecycleAggCache.Unlock()

	if lifecycleRepo.DB != db && db != nil {
		lifecycleRepo = lifecycle.NewRepository(db)
	}
	aggregates, err := lifecycleRepo.LoadPastAggregates(context.Background(), ids)
	if err != nil {
		return result
	}
	for id, agg := range aggregates {
		result[id] = pastLifecycleAggregate(agg)
	}

	lifecycleAggCache.Lock()
	lifecycleAggCache.key = key
	lifecycleAggCache.result = copyLifecycleAgg(result)
	lifecycleAggCache.expiry = now.Add(dashboardCacheTTL)
	lifecycleAggCache.Unlock()
	return copyLifecycleAgg(result)
}

func enrichLifecycleSamplesForCapped(agg map[int64]pastLifecycleAggregate, offers []map[string]any, maxFiatLimitEUR float64) {
	if maxFiatLimitEUR <= 0 || len(offers) == 0 {
		return
	}
	needIDs := make([]int64, 0)
	seen := make(map[int64]struct{})
	for _, o := range offers {
		if offerBool(o, "is_live") {
			continue
		}
		avgRefPrice := offerRefPrice(o)
		fullTradeSizeBTC := selectBTCTradeSize(offerFloatPtr(o, "btc_max"), offerFloatPtr(o, "btc_min"))
		if avgRefPrice <= 0 || fullTradeSizeBTC <= 0 {
			continue
		}
		btcCap := maxFiatLimitEUR / avgRefPrice
		if btcCap <= 0 || fullTradeSizeBTC <= btcCap {
			continue
		}
		id := int64(offerFloat(o, "id"))
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		needIDs = append(needIDs, id)
	}
	if len(needIDs) == 0 {
		return
	}
	if lifecycleRepo.DB != db && db != nil {
		lifecycleRepo = lifecycle.NewRepository(db)
	}
	samples, err := lifecycleRepo.LoadPastSamples(context.Background(), needIDs)
	if err != nil {
		return
	}
	for id, s := range samples {
		a := agg[id]
		a.Samples = s
		agg[id] = a
	}
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
	enrichLifecycleSamplesForCapped(lifecycleAgg, filteredOffers, maxFiatLimitEUR)
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

type generalStatsContext struct {
	hours                  int
	excludedPaymentMethods []string
	sub                    liveSubscription
	offers                 []map[string]any
	generalOffers          []pastorders.Offer
	closedOfferIDs         []int64
	now                    time.Time
}

func generalStatsCacheKey(r *http.Request) string {
	parts := []string{
		strconv.Itoa(queryInt(r, "hours", 24)),
		queryCex(r),
		strings.Join(queryExcludedPaymentMethods(r), ","),
		strings.Join(queryExcludedCEXes(r), ","),
		queryFeeTier(r),
		strconv.FormatBool(queryCoupledHedge(r)),
		strconv.FormatFloat(queryMaxFiatLimitEUR(r), 'f', -1, 64),
		strconv.Itoa(queryConfirmations(r)),
	}
	return strings.Join(parts, "|")
}

func loadGeneralStatsContext(r *http.Request) (generalStatsContext, error) {
	key := generalStatsCacheKey(r)
	now := time.Now()
	generalStatsCache.Lock()
	if entry, ok := generalStatsCache.entries[key]; ok && now.Before(entry.expiry) {
		ctx := entry.ctx
		generalStatsCache.Unlock()
		return ctx, nil
	}
	generalStatsCache.Unlock()

	ctx, err := loadGeneralStatsContextUncached(r)
	if err != nil {
		return generalStatsContext{}, err
	}

	generalStatsCache.Lock()
	if generalStatsCache.entries == nil {
		generalStatsCache.entries = make(map[string]generalStatsCacheEntry)
	}
	generalStatsCache.entries[key] = generalStatsCacheEntry{ctx: ctx, expiry: now.Add(dashboardCacheTTL)}
	generalStatsCache.Unlock()
	return ctx, nil
}

func loadGeneralStatsContextUncached(r *http.Request) (generalStatsContext, error) {
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
		return generalStatsContext{}, err
	}
	defer rows.Close()

	offers, err := scanOffers(rows)
	if err != nil {
		return generalStatsContext{}, err
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

	return generalStatsContext{
		hours:                  hours,
		excludedPaymentMethods: excludedPaymentMethods,
		sub:                    sub,
		offers:                 offers,
		generalOffers:          generalOffers,
		closedOfferIDs:         closedOfferIDs,
		now:                    time.Now(),
	}, nil
}

func (ctx generalStatsContext) overview() pastorders.GeneralStatsOverview {
	return pastorders.BuildGeneralStatsOverview(ctx.generalOffers, ctx.now, ctx.hours, ctx.excludedPaymentMethods)
}

func (ctx generalStatsContext) premiumSummary() pastorders.GeneralStatsPremiumSummary {
	return pastorders.BuildGeneralStatsPremiumSummary(ctx.generalOffers, ctx.now, ctx.hours, ctx.excludedPaymentMethods)
}

func (ctx generalStatsContext) openPremiums() pastorders.OpenPremiumStats {
	return buildOpenPremiumStats(ctx.sub, ctx.excludedPaymentMethods)
}

func (ctx generalStatsContext) pastPremiums(r *http.Request, lifecycleAgg map[int64]pastLifecycleAggregate) []pastorders.PastPremiumTimeframeStats {
	return buildPastPremiumStats(ctx.offers, lifecycleAgg, ctx.now, ctx.excludedPaymentMethods, queryMaxFiatLimitEUR(r), queryConfirmations(r), queryExcludedCEXes(r), queryFeeTier(r))
}

func (ctx generalStatsContext) premiumLifetimes(r *http.Request, lifecycleAgg map[int64]pastLifecycleAggregate) pastorders.PremiumLifetimeModes {
	return buildPremiumLifetimeStats(ctx.offers, lifecycleAgg, ctx.now, ctx.excludedPaymentMethods, queryMaxFiatLimitEUR(r), queryConfirmations(r), queryExcludedCEXes(r), queryFeeTier(r))
}

func handleGeneralStatsOverview(w http.ResponseWriter, r *http.Request) {
	ctx, err := loadGeneralStatsContext(r)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, ctx.overview())
}

func handleGeneralStatsOpenPremiums(w http.ResponseWriter, r *http.Request) {
	ctx, err := loadGeneralStatsContext(r)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, ctx.openPremiums())
}

func handleGeneralStatsPastPremiums(w http.ResponseWriter, r *http.Request) {
	ctx, err := loadGeneralStatsContext(r)
	if err != nil {
		writeError(w, err)
		return
	}
	lifecycleAgg := fetchPastOfferLifecycleAggregates(ctx.closedOfferIDs)
	maxFiat := queryMaxFiatLimitEUR(r)
	enrichLifecycleSamplesForCapped(lifecycleAgg, ctx.offers, maxFiat)
	writeJSON(w, ctx.pastPremiums(r, lifecycleAgg))
}

func handleGeneralStatsLifetimes(w http.ResponseWriter, r *http.Request) {
	ctx, err := loadGeneralStatsContext(r)
	if err != nil {
		writeError(w, err)
		return
	}
	lifecycleAgg := fetchPastOfferLifecycleAggregates(ctx.closedOfferIDs)
	maxFiat := queryMaxFiatLimitEUR(r)
	enrichLifecycleSamplesForCapped(lifecycleAgg, ctx.offers, maxFiat)
	writeJSON(w, ctx.premiumLifetimes(r, lifecycleAgg))
}

func handleGeneralStatsPaymentMethods(w http.ResponseWriter, r *http.Request) {
	ctx, err := loadGeneralStatsContext(r)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, ctx.overview().PaymentMethodCounts)
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
			v := tradecost.Round4(a.sumAsk / float64(a.cntAsk))
			askPtr = &v
		}
		if a.cntBid > 0 {
			v := tradecost.Round4(a.sumBid / float64(a.cntBid))
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
			avg := tradecost.Round4(sumByExchange[exchange] / float64(count))
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

			rawPremium := agg.AvgPremiumPercent
			if rawPremium == 0 {
				rawPremium = tradecost.Round4(offerFloat(offer, "avg_premium_pct"))
			}
			if raw, ok := positiveOrZero(rawPremium); ok {
				rawSum[exchange] += raw
				rawCount[exchange]++
			}

			netPremium := agg.AvgNetPercent
			if netPremium == 0 {
				netPremium = tradecost.Round4(offerFloat(offer, "avg_net_premium_pct"))
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
						_, cappedNet, _, _, _, _ := recomputeCappedLifecycleAverages(offer, agg.Samples, fullTradeSizeBTC, maxFiatLimitEUR)
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
			rawPremium = tradecost.Round4(offerFloat(offer, "avg_premium_pct"))
		}
		if rawPremium > 0 {
			add(&rawAcc, exchange, lifetime)
		}

		netPremium := agg.AvgNetPercent
		if netPremium == 0 {
			netPremium = tradecost.Round4(offerFloat(offer, "avg_net_premium_pct"))
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
					_, cappedNet, _, _, _, _ := recomputeCappedLifecycleAverages(offer, agg.Samples, fullTradeSizeBTC, maxFiatLimitEUR)
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
	BTC                     float64                        `json:"btc"`
	Method                  string                         `json:"method"`
	Tier                    string                         `json:"tier"`
	Confidence              float64                        `json:"confidence"`
	NumTxs                  int                            `json:"num_txs"`
	RequiredConfirmations   int                            `json:"required_confirmations"`
	EstimatedArrivalMinutes int                            `json:"estimated_arrival_minutes"`
	Detail                  *tradecost.BTCNetworkFeeDetail `json:"detail"`
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
	OpenFeePct      float64                        `json:"open_fee_pct"`
	OpenFeeBTC      float64                        `json:"open_fee_btc"`
	CloseFeePct     float64                        `json:"close_fee_pct"`
	CloseFeeBTC     float64                        `json:"close_fee_btc"`
	FundingFeePct   float64                        `json:"funding_fee_pct"`
	FundingFeeBTC   float64                        `json:"funding_fee_btc"`
	FeeSumPct       float64                        `json:"fee_sum_pct"`
	FeeSumBTC       float64                        `json:"fee_sum_btc"`
	Side            string                         `json:"side"`
	Venue           string                         `json:"venue"`
	Instrument      string                         `json:"instrument"`
	TransferMinutes int                            `json:"transfer_minutes"`
	Position        *tradecost.HedgePositionDetail `json:"position,omitempty"`
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
	CostPolicy    string                 `json:"cost_policy,omitempty"`
	Assumptions   []string               `json:"assumptions,omitempty"`
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

type pastOfferCompactAPI struct {
	ID            int64                 `json:"id"`
	Exchange      string                `json:"exchange"`
	OfferID       *string               `json:"offer_id"`
	PaymentMethod *string               `json:"payment_method"`
	Direction     string                `json:"direction"`
	Status        pastOfferStatus       `json:"status"`
	Pricing       pastOfferPricing      `json:"pricing"`
	VolumeLimits  pastOfferVolumeLimits `json:"volume_limits"`
}

type pastLifecycleSample = lifecycle.PastSample
type pastLifecycleAggregate = lifecycle.PastAggregate

func addPastOfferCostFields(o map[string]any, requiredConfirmations int) pastOfferAnalysis {
	return addPastOfferCostFieldsFull(o, requiredConfirmations, nil, "", 0)
}

func addPastOfferCostFieldsFull(o map[string]any, requiredConfirmations int, excludedCEXes []string, feeTier string, maxFiatLimitEUR float64) pastOfferAnalysis {
	price := offerFloat(o, "price")
	refPrice := offerRefPrice(o)
	if refPrice <= 0 {
		refPrice = price
	}
	direction := offerString(o, "direction")
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
	storedTradeCostPct := nonZeroFloat(offerFloat(o, "avg_trade_cost_pct"), offerFloat(o, "trade_cost_pct"))
	storedTradeCostBTC := nonZeroFloat(offerFloat(o, "avg_trade_cost_btc"), offerFloat(o, "trade_cost_btc"))
	netPremium := nonZeroFloat(offerFloat(o, "avg_net_premium_pct"), priceDiff-storedTradeCostPct)
	estimatedProfitBTC := nonZeroFloat(offerFloat(o, "avg_estimated_profit_btc"), btcSize*(netPremium/100))

	o["trade_cost_percent"] = storedTradeCostPct
	o["net_premium_percent"] = netPremium
	o["cost_breakdown"] = buildStoredPastBreakdown(o, btcSize, refPrice, storedTradeCostPct, storedTradeCostBTC, netPremium, estimatedProfitBTC)

	var btcSizeCapped float64
	var estimatedProfitBTCCapped float64
	hasCap := false
	if maxFiatLimitEUR > 0 && refPrice > 0 {
		btcCap := maxFiatLimitEUR / refPrice
		if btcSize > btcCap {
			bdCapped := buildCappedPastBreakdown(o, btcSize, btcCap, refPrice, priceDiff)
			btcSizeCapped = btcCap
			estimatedProfitBTCCapped = bdCapped.EstimatedProfitBTC
			hasCap = true
		}
	}

	return pastOfferAnalysis{
		hasPositiveRawSpread:     priceDiff > 0,
		btcSize:                  btcSize,
		refPrice:                 refPrice,
		estimatedProfitBTC:       estimatedProfitBTC,
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
		avgOfferPrice = tradecost.Round4(offerFloat(o, "price"))
	}
	avgRefPrice := agg.AvgRefPrice
	if avgRefPrice <= 0 {
		avgRefPrice = tradecost.Round4(offerRefPrice(o))
	}
	avgPremiumPercent := agg.AvgPremiumPercent
	if avgPremiumPercent == 0 {
		avgPremiumPercent = tradecost.Round4(offerFloat(o, "avg_premium_pct"))
	}
	avgTradeCostPct := agg.AvgTradeCostPct
	if avgTradeCostPct == 0 {
		avgTradeCostPct = tradecost.Round4(offerFloat(o, "avg_trade_cost_pct"))
	}
	avgTradeCostBTC := agg.AvgTradeCostBTC
	if avgTradeCostBTC == 0 {
		avgTradeCostBTC = tradecost.Round8(offerFloat(o, "avg_trade_cost_btc"))
	}
	avgNetPercent := agg.AvgNetPercent
	if avgNetPercent == 0 {
		avgNetPercent = tradecost.Round4(offerFloat(o, "avg_net_premium_pct"))
	}
	avgProfitBTC := agg.AvgProfitBTC
	if avgProfitBTC == 0 {
		avgProfitBTC = tradecost.Round8(offerFloat(o, "avg_estimated_profit_btc"))
	}
	avgProfitFiat := agg.AvgProfitFiat
	if avgProfitFiat == 0 {
		avgProfitFiat = tradecost.Round4(offerFloat(o, "avg_estimated_profit_fiat"))
	}
	avgNetworkPct := agg.AvgNetworkPct
	avgBTCAmount := agg.AvgBTCAmount
	if avgBTCAmount == 0 {
		avgBTCAmount = tradecost.Round8(offerFloat(o, "avg_btc_amount"))
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
	fullRep := buildStoredPastBreakdown(o, fullTradeSizeBTC, avgRefPrice, avgTradeCostPct, avgTradeCostBTC, avgNetPercent, avgProfitBTC)
	if avgNetworkPct == 0 {
		avgNetworkPct = tradecost.Round4(fullRep.NetworkFeePct)
	}
	fullTradeSizeFiat := tradecost.Round4(fullTradeSizeBTC * avgRefPrice)

	fullScenario := pastOfferScenario{
		CostPolicy:    "historical_persisted",
		TradeSizeBTC:  tradecost.Round8(fullTradeSizeBTC),
		TradeSizeFiat: fullTradeSizeFiat,
		Route: pastOfferRoute{
			CEX:        offerString(o, "best_route_cex"),
			Settlement: offerString(o, "best_route_method"),
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
		cappedTradeSizeBTC := tradecost.Round8(maxFiatLimitEUR / avgRefPrice)
		if cappedTradeSizeBTC > 0 && fullTradeSizeBTC > cappedTradeSizeBTC {
			cappedRep := buildCappedPastBreakdown(o, fullTradeSizeBTC, cappedTradeSizeBTC, avgRefPrice, avgPremiumPercent)
			cappedAvgTradeCostPct, cappedAvgNetPct, cappedAvgProfitBTC, cappedAvgProfitFiat, cappedAvgTradeCostBTC, cappedAvgNetworkPct :=
				recomputeCappedLifecycleAverages(o, agg.Samples, fullTradeSizeBTC, maxFiatLimitEUR)
			if cappedAvgProfitBTC == 0 {
				cappedAvgTradeCostPct = tradecost.Round4(cappedRep.TotalCostPct)
				cappedAvgNetPct = tradecost.Round4(cappedRep.EstimatedProfitPct)
				cappedAvgProfitBTC = tradecost.Round8(cappedRep.EstimatedProfitBTC)
				cappedAvgProfitFiat = tradecost.Round4(cappedRep.EstimatedProfitBTC * avgRefPrice)
				cappedAvgTradeCostBTC = tradecost.Round8(cappedRep.TotalCostBTC)
				cappedAvgNetworkPct = tradecost.Round4(cappedRep.NetworkFeePct)
			}
			capFiat := tradecost.Round4(maxFiatLimitEUR)
			cappedScenario = &pastOfferScenario{
				CapFiat:       &capFiat,
				CostPolicy:    "historical_route_fixed_transfer_recomputed_size_proportional",
				Assumptions:   []string{"historical route", "fixed historical transfer/network assumptions", "recalculated hedge and proportional trading fees for capped BTC size"},
				TradeSizeBTC:  cappedTradeSizeBTC,
				TradeSizeFiat: tradecost.Round4(cappedTradeSizeBTC * avgRefPrice),
				Route: pastOfferRoute{
					CEX:        offerString(o, "best_route_cex"),
					Settlement: offerString(o, "best_route_method"),
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

func buildPastOfferCompactAPI(o map[string]any) pastOfferCompactAPI {
	firstSeen := offerString(o, "first_seen")
	lastSeen := offerString(o, "last_seen")
	firstTime := parseDBTime(firstSeen)
	lastTime := parseDBTime(lastSeen)

	var btcMinPtr, btcMaxPtr *float64
	if v := offerFloat(o, "btc_min"); v > 0 {
		btcMinPtr = &v
	}
	if v := offerFloat(o, "btc_max"); v > 0 {
		btcMaxPtr = &v
	}

	return pastOfferCompactAPI{
		ID:            int64(offerFloat(o, "id")),
		Exchange:      offerString(o, "exchange"),
		OfferID:       offerStringPtr(o, "offer_id"),
		PaymentMethod: offerStringPtr(o, "payment_method"),
		Direction:     offerString(o, "direction"),
		Status: pastOfferStatus{
			IsLive:    false,
			FirstSeen: firstSeen,
			LastSeen:  lastSeen,
			Duration:  buildPastOfferDuration(firstTime, lastTime),
		},
		Pricing: pastOfferPricing{
			PriceType:         normalizePastPriceType(offerString(o, "price_type")),
			FiatCurrency:      "EUR",
			AvgOfferPrice:     tradecost.Round4(offerFloat(o, "price")),
			AvgRefPrice:       tradecost.Round4(offerRefPrice(o)),
			AvgPremiumPercent: tradecost.Round4(nonZeroFloat(offerFloat(o, "avg_premium_pct"), offerFloat(o, "price_diff_percent"))),
		},
		VolumeLimits: pastOfferVolumeLimits{
			BTCMin:  btcMinPtr,
			BTCMax:  btcMaxPtr,
			FiatMin: offerInt64Ptr(o, "fiat_min"),
			FiatMax: offerInt64Ptr(o, "fiat_max"),
		},
	}
}

func buildPastProfitableOrderAPI(o map[string]any, agg pastLifecycleAggregate, requiredConfirmations int, excludedCEXes []string, feeTier string, maxFiatLimitEUR float64, mode takerOpportunityMode) pastProfitableOrderAPI {
	pastOffer := buildPastOfferAPI(o, agg, requiredConfirmations, excludedCEXes, feeTier, maxFiatLimitEUR)
	recomputed := addPastOfferCostFieldsFull(o, requiredConfirmations, excludedCEXes, feeTier, maxFiatLimitEUR)
	tradeSizeBTC, netProfitBTC := recomputed.valuesForMode(mode)
	summary := pastProfitableOrderSummary{
		NetProfitBTC:  tradecost.Round8(netProfitBTC),
		NetProfitFiat: tradecost.Round4(netProfitBTC * recomputed.refPrice),
		TradeSizeBTC:  tradecost.Round8(tradeSizeBTC),
		TradeSizeFiat: tradecost.Round4(tradeSizeBTC * recomputed.refPrice),
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

func hedgeSideForOfferDirection(direction string) string {
	if direction == "sell" {
		return "long"
	}
	return "short"
}

func buildStoredPastBreakdown(o map[string]any, btcSize, refPrice, tradeCostPct, tradeCostBTC, netPremiumPct, profitBTC float64) tradecost.CostBreakdown {
	if btcSize <= 0 {
		return tradecost.CostBreakdown{}
	}
	direction := offerString(o, "direction")
	isAsk := direction == "sell"
	pct := func(btc float64) float64 {
		if btcSize <= 0 || btc == 0 {
			return 0
		}
		return tradecost.Round4(btc / btcSize * 100)
	}
	withdrawalBTC := offerFloat(o, "cex_withdraw_fee_btc")
	if isAsk {
		withdrawalBTC = 0
	}
	hedge := tradecost.HedgeBreakdown{}
	hedge = tradecost.HedgeBreakdown{
		OpenFeeBTC:      tradecost.Round8(offerFloat(o, "hedge_open_fee_btc")),
		CloseFeeBTC:     tradecost.Round8(offerFloat(o, "hedge_close_fee_btc")),
		FundingFeeBTC:   tradecost.Round8(offerFloat(o, "hedge_funding_fee_btc")),
		FeeSumBTC:       tradecost.Round8(offerFloat(o, "hedge_fee_sum_btc")),
		Side:            hedgeSideForOfferDirection(direction),
		Venue:           offerString(o, "hedge_venue"),
		Instrument:      offerString(o, "hedge_instrument"),
		TransferMinutes: int(offerFloat(o, "hedge_transfer_minutes")),
	}
	if hedge.FeeSumBTC == 0 {
		hedge.FeeSumBTC = tradecost.Round8(hedge.OpenFeeBTC + hedge.CloseFeeBTC + hedge.FundingFeeBTC)
	}
	hedge.OpenFeePct = pct(hedge.OpenFeeBTC)
	hedge.CloseFeePct = pct(hedge.CloseFeeBTC)
	hedge.FundingFeePct = pct(hedge.FundingFeeBTC)
	hedge.FeeSumPct = pct(hedge.FeeSumBTC)
	if tradeCostBTC == 0 {
		tradeCostBTC = offerFloat(o, "trade_cost_btc")
	}
	if tradeCostBTC == 0 {
		tradeCostBTC = tradecost.Round8(btcSize * tradeCostPct / 100)
	}
	if profitBTC == 0 {
		profitBTC = tradecost.Round8(btcSize * netPremiumPct / 100)
	}
	tradeDir := "bid"
	numNetworkTxs := 2
	if isAsk {
		tradeDir = "ask"
		numNetworkTxs = 1
	}
	return tradecost.CostBreakdown{
		BTCAmount:          tradecost.Round8(btcSize),
		RouteCEX:           offerString(o, "best_route_cex"),
		RouteDEX:           offerString(o, "exchange"),
		RouteMethod:        offerString(o, "best_route_method"),
		TradeDirection:     tradeDir,
		NumNetworkTxs:      numNetworkTxs,
		EstimatedProfitPct: tradecost.Round4(netPremiumPct),
		EstimatedProfitBTC: tradecost.Round8(profitBTC),
		CexTakerFeeBTC:     tradecost.Round8(offerFloat(o, "cex_taker_fee_btc")),
		CexTakerFeePct:     pct(offerFloat(o, "cex_taker_fee_btc")),
		WithdrawalFeeBTC:   tradecost.Round8(withdrawalBTC),
		WithdrawalFeePct:   pct(withdrawalBTC),
		NetworkFeeBTC:      tradecost.Round8(offerFloat(o, "network_fee_btc")),
		NetworkFeePct:      pct(offerFloat(o, "network_fee_btc")),
		NetworkFeeMethod:   offerString(o, "best_route_method"),
		Hedge:              hedge,
		DexFeeBTC:          tradecost.Round8(offerFloat(o, "dex_fee_btc")),
		DexFeePct:          pct(offerFloat(o, "dex_fee_btc")),
		TotalCostPct:       tradecost.Round4(tradeCostPct),
		TotalCostBTC:       tradecost.Round8(tradeCostBTC),
	}
}

func buildCappedPastBreakdown(o map[string]any, fullBTCSize, cappedBTCSize, refPrice, premiumPct float64) tradecost.CostBreakdown {
	if cappedBTCSize <= 0 {
		return tradecost.CostBreakdown{}
	}
	direction := offerString(o, "direction")
	isAsk := direction == "sell"
	routeCEX := offerString(o, "best_route_cex")
	dexExchange := offerString(o, "exchange")
	pct := func(btc float64) float64 {
		if cappedBTCSize <= 0 || btc == 0 {
			return 0
		}
		return tradecost.Round4(btc / cappedBTCSize * 100)
	}
	scaleStored := func(key string) float64 {
		if fullBTCSize <= 0 {
			return 0
		}
		return cappedBTCSize * (offerFloat(o, key) / fullBTCSize)
	}

	takerBTC := scaleStored("cex_taker_fee_btc")
	dexFeeBTC := scaleStored("dex_fee_btc")
	hedge := tradecost.HedgeBreakdown{}
	if est := tradeCostEstimators[routeCEX]; est != nil {
		takerBTC = est.TakerFeeBTC(cappedBTCSize)
		dexFeeBTC = est.DexFeeBTC(cappedBTCSize, dexExchange)
		hedge = est.EstimateHedgeBreakdownForDirection(cappedBTCSize, refPrice, offerFloat(o, "hedge_transfer_minutes"), true, direction)
	}
	if hedge.FeeSumBTC == 0 {
		hedge = tradecost.HedgeBreakdown{
			OpenFeeBTC:      tradecost.Round8(scaleStored("hedge_open_fee_btc")),
			CloseFeeBTC:     tradecost.Round8(scaleStored("hedge_close_fee_btc")),
			FundingFeeBTC:   tradecost.Round8(scaleStored("hedge_funding_fee_btc")),
			FeeSumBTC:       tradecost.Round8(scaleStored("hedge_fee_sum_btc")),
			Side:            hedgeSideForOfferDirection(direction),
			Venue:           offerString(o, "hedge_venue"),
			Instrument:      offerString(o, "hedge_instrument"),
			TransferMinutes: int(math.Round(offerFloat(o, "hedge_transfer_minutes"))),
		}
		if hedge.FeeSumBTC == 0 {
			hedge.FeeSumBTC = tradecost.Round8(hedge.OpenFeeBTC + hedge.CloseFeeBTC + hedge.FundingFeeBTC)
		}
		hedge.OpenFeePct = pct(hedge.OpenFeeBTC)
		hedge.CloseFeePct = pct(hedge.CloseFeeBTC)
		hedge.FundingFeePct = pct(hedge.FundingFeeBTC)
		hedge.FeeSumPct = pct(hedge.FeeSumBTC)
	}

	withdrawalBTC := 0.0
	networkBTC := offerFloat(o, "network_fee_btc")
	tradeDir := "ask"
	numNetworkTxs := 1
	if !isAsk {
		withdrawalBTC = offerFloat(o, "cex_withdraw_fee_btc")
		tradeDir = "bid"
		numNetworkTxs = 2
	}
	totalBTC := takerBTC + withdrawalBTC + networkBTC + dexFeeBTC + hedge.FeeSumBTC
	totalPct := pct(totalBTC)
	netPct := tradecost.Round4(premiumPct - totalPct)
	profitBTC := tradecost.Round8(cappedBTCSize * netPct / 100)
	return tradecost.CostBreakdown{
		BTCAmount:          tradecost.Round8(cappedBTCSize),
		RouteCEX:           routeCEX,
		RouteDEX:           dexExchange,
		RouteMethod:        offerString(o, "best_route_method"),
		TradeDirection:     tradeDir,
		NumNetworkTxs:      numNetworkTxs,
		EstimatedProfitPct: netPct,
		EstimatedProfitBTC: profitBTC,
		CexTakerFeePct:     pct(takerBTC),
		CexTakerFeeBTC:     tradecost.Round8(takerBTC),
		WithdrawalFeePct:   pct(withdrawalBTC),
		WithdrawalFeeBTC:   tradecost.Round8(withdrawalBTC),
		NetworkFeePct:      pct(networkBTC),
		NetworkFeeBTC:      tradecost.Round8(networkBTC),
		NetworkFeeMethod:   offerString(o, "best_route_method"),
		Hedge:              hedge,
		DexFeePct:          pct(dexFeeBTC),
		DexFeeBTC:          tradecost.Round8(dexFeeBTC),
		TotalCostPct:       totalPct,
		TotalCostBTC:       tradecost.Round8(totalBTC),
	}
}

func recomputeCappedLifecycleAverages(o map[string]any, samples []pastLifecycleSample, fullBTCSize, maxFiatLimitEUR float64) (float64, float64, float64, float64, float64, float64) {
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
		bd := buildCappedPastBreakdown(o, fullBTCSize, btcCap, sample.RefPrice, sample.PremiumPct)
		count++
		sumTradeCostPct += bd.TotalCostPct
		sumNetPct += bd.EstimatedProfitPct
		sumProfitBTC += bd.EstimatedProfitBTC
		sumProfitFiat += bd.EstimatedProfitBTC * sample.RefPrice
		sumTradeCostBTC += bd.TotalCostBTC
		sumNetworkPct += bd.NetworkFeePct
	}
	if count == 0 {
		return 0, 0, 0, 0, 0, 0
	}
	return tradecost.Round4(sumTradeCostPct / float64(count)),
		tradecost.Round4(sumNetPct / float64(count)),
		tradecost.Round8(sumProfitBTC / float64(count)),
		tradecost.Round4(sumProfitFiat / float64(count)),
		tradecost.Round8(sumTradeCostBTC / float64(count)),
		tradecost.Round4(sumNetworkPct / float64(count))
}

func buildPastScenarioCosts(rep tradecost.CostBreakdown, avgNetworkPct, avgTradeCostPct, avgTradeCostBTC float64) pastOfferScenarioCosts {
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
			Side:            rep.Hedge.Side,
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

func buildPastBTCNetworkFee(rep tradecost.CostBreakdown, requiredConfirmations int) pastOfferBTCNetworkFee {
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
	if lifecycleRepo.DB != db {
		lifecycleRepo = lifecycle.NewRepository(db)
	}
	records := make([]lifecycle.Record, 0, len(offers))
	for _, o := range offers {
		records = append(records, lifecycle.Record{
			ID:            o.ID,
			Price:         o.Price,
			RefPrice:      o.RefPrice,
			PriceDiffPct:  o.PriceDiffPct,
			NetPremiumPct: o.NetPremiumPct,
			CostBreakdown: o.CostBreakdown,
		})
	}
	if err := lifecycleRepo.PersistSnapshot(context.Background(), records); err != nil {
		fmt.Printf("[Lifecycle] persist error: %v\n", err)
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
	// Fetch lifecycle from previous snapshot cycles and cache before broadcasting.
	ids := make([]int64, len(offers))
	for i, o := range offers {
		ids[i] = o.ID
	}
	hub.setLifecycle(fetchOfferLifecycle(ids))
	hub.setOffers(offers)
	price := getCexPrice(defaultCEX)
	outOffers := hub.computeOutOffers(price, liveSubscription{cex: defaultCEX})
	writeLifecycleEntries(outOffers)
	fmt.Printf("[LiveHub] updated with %d live offers from snapshot (ref_price=%.2f)\n", len(offers), price)
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
	intervalMin := queryOHLCInterval(r)

	if ohlcService == nil {
		ohlcService = ohlc.NewService()
	}
	candles := ohlcService.Candles(r.Context(), cex, hours, intervalMin)

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
		"interval_min": intervalMin,
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
		profile := tradecost.ProfileFor(name)
		methods := make([]string, 0, len(profile.Methods))
		hasLN := false
		for _, m := range profile.Methods {
			methods = append(methods, string(m))
			if m == tradecost.MethodLightning {
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
	if snapshotLogRepo.DB != db {
		snapshotLogRepo = snapshotlog.NewRepository(db)
	}
	result, err := snapshotLogRepo.List(r.Context(), limit, queryBool(r, "compact"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, result)
}

func handleSnapshotLogDetail(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if snapshotLogRepo.DB != db {
		snapshotLogRepo = snapshotlog.NewRepository(db)
	}
	entry, err := snapshotLogRepo.Detail(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, entry)
}

func compactSnapshotExchanges(exchanges map[string]any) map[string]any {
	return snapshotlog.CompactExchanges(exchanges)
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

type tradingAccount = tradingaccounts.Account
type tradingTOTPSecret = tradingaccounts.TOTPSecret
type tradingPasskey = tradingaccounts.Passkey
type tradingSeed = tradingaccounts.Seed
type tradingAPIKey = tradingaccounts.APIKey
type tradingAccountPayload = tradingaccounts.AccountPayload
type tradingTOTPSecretPayload = tradingaccounts.TOTPSecretPayload
type tradingPasskeyPayload = tradingaccounts.PasskeyPayload
type tradingSeedPayload = tradingaccounts.SeedPayload
type tradingAPIKeyPayload = tradingaccounts.APIKeyPayload

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
		if err := tradingAccounts().Delete(r.Context(), id); err != nil {
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
	id, err := tradingAccounts().CreateTOTPSecret(r.Context(), accountID, payload)
	if err != nil {
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
		if err := tradingAccounts().UpdateTOTPSecret(r.Context(), id, payload); err != nil {
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
		if err := tradingAccounts().DeleteTOTPSecret(r.Context(), id); err != nil {
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
	id, err := tradingAccounts().CreatePasskey(r.Context(), accountID, payload)
	if err != nil {
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
		if err := tradingAccounts().UpdatePasskey(r.Context(), id, payload); err != nil {
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
		if err := tradingAccounts().DeletePasskey(r.Context(), id); err != nil {
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
	id, err := tradingAccounts().CreateSeed(r.Context(), accountID, payload)
	if err != nil {
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
		if err := tradingAccounts().UpdateSeed(r.Context(), id, payload); err != nil {
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
		if err := tradingAccounts().DeleteSeed(r.Context(), id); err != nil {
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
	id, err := tradingAccounts().CreateAPIKey(r.Context(), accountID, payload)
	if err != nil {
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
		if err := tradingAccounts().UpdateAPIKey(r.Context(), id, payload); err != nil {
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
		if err := tradingAccounts().DeleteAPIKey(r.Context(), id); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func tradingAccounts() tradingaccounts.Repository {
	if tradingAccountRepo.DB != db {
		tradingAccountRepo = tradingaccounts.NewRepository(db)
	}
	return tradingAccountRepo
}

func loadTradingAccounts(ctx context.Context) ([]tradingAccount, error) {
	return tradingAccounts().List(ctx)
}

func loadTradingAccountByID(ctx context.Context, id int64) (*tradingAccount, error) {
	return tradingAccounts().Get(ctx, id)
}

func createTradingAccount(ctx context.Context, payload tradingAccountPayload) (int64, error) {
	return tradingAccounts().Create(ctx, payload)
}

func updateTradingAccount(ctx context.Context, id int64, payload tradingAccountPayload) error {
	return tradingAccounts().Update(ctx, id, payload)
}

func loadTradingTOTPSecretByID(ctx context.Context, id int64) (*tradingTOTPSecret, error) {
	return tradingAccounts().GetTOTPSecret(ctx, id)
}

func loadTradingPasskeyByID(ctx context.Context, id int64) (*tradingPasskey, error) {
	return tradingAccounts().GetPasskey(ctx, id)
}

func loadTradingSeedByID(ctx context.Context, id int64) (*tradingSeed, error) {
	return tradingAccounts().GetSeed(ctx, id)
}

func loadTradingAPIKeyByID(ctx context.Context, id int64) (*tradingAPIKey, error) {
	return tradingAccounts().GetAPIKey(ctx, id)
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

func nonZeroFloat(value, fallback float64) float64 {
	if value != 0 {
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

func queryOHLCInterval(r *http.Request) int {
	interval := queryInt(r, "interval_min", snapshotIntervalMin)
	switch interval {
	case 1, 5, 15, 30, 60, 240, 1440:
		return interval
	default:
		return snapshotIntervalMin
	}
}

func queryBool(r *http.Request, key string) bool {
	switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get(key))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
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
	if mmProxy == nil {
		mmProxy = mmproxy.New(mmControllerAPIURL)
	}
	mmProxy.ForwardJSON(w, r, path)
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
