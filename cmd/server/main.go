package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
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

	"commons/fiat"
	"commons/logging"
	"commons/metrics"
	"commons/mmcapabilities"
	"commons/tracing"
	"commons/tradecost"
	"dexmonitor/internal/auth"
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
	databaseURL             string
	snapshotIntervalMin     int
	frontendDir             string
	mmControllerAPIURL      string
	mmInternalSecret        string
	unifiedAPIURL           string
	fiatControllerURL       string
	pushpushNotifySecret    string
	pushpushHeartbeatMaxAge time.Duration
	capabilityMaxAge        time.Duration
	sessionCookieSecure     bool
	db                      *sql.DB
	pmService               *paymentmethods.Service
	pmRepo                  *paymentmethods.Repo
	lifecycleRepo           lifecycle.Repository
	ohlcService             *ohlc.Service
	snapshotLogRepo         snapshotlog.Repository
	mmProxy                 *mmproxy.Proxy
	tradingAccountRepo      tradingaccounts.Repository
)

// dashboardCacheTTL deduplicates parallel general_stats and lifecycle aggregate loads.
const dashboardCacheTTL = 30 * time.Second

const defaultCEX = "kraken"

const closedAnalyzedOffersQuery = "SELECT * FROM offers WHERE is_live = FALSE AND last_seen >= ? AND historical_analysis_status = 'analyzed' ORDER BY last_seen DESC"
const analyticsOffersQuery = `
SELECT
	id, exchange, direction, price,
	btc_min, btc_max, fiat_min, fiat_max,
	payment_methods, offer_id,
	first_seen, last_seen, is_live, duration, historical_analysis_status,
	avg_ref_price, avg_premium_pct, avg_trade_cost_pct, avg_trade_cost_btc,
	avg_hedge_fee_sum_btc, cex_taker_fee_btc, cex_withdraw_fee_btc, routing_fee_sum,
	hedge_open_fee_btc, hedge_close_fee_btc, hedge_funding_fee_btc, hedge_fee_sum_btc,
	hedge_venue, hedge_instrument, hedge_transfer_minutes, dex_fee_btc,
	avg_net_premium_pct, avg_estimated_profit_btc, avg_estimated_profit_fiat, avg_btc_amount,
	avg_min_trade_cost_pct, avg_min_trade_cost_btc, avg_min_net_premium_pct,
	avg_min_estimated_profit_btc, avg_min_estimated_profit_fiat, avg_min_btc_amount, min_volume_analyzed,
	price_type, best_route_cex, routing_profile, routing_fee_detail, security_deposit_pct
FROM offers
WHERE last_seen >= ?
ORDER BY last_seen DESC
`

var generalStatsCache struct {
	sync.Mutex
	entries  map[string]generalStatsCacheEntry
	inFlight map[string]*generalStatsInFlightEntry
}

type generalStatsCacheEntry struct {
	ctx    generalStatsContext
	expiry time.Time
}

type generalStatsInFlightEntry struct {
	done chan struct{}
	ctx  generalStatsContext
	err  error
}

// sweepGeneralStatsCache drops expired entries. Caller must hold the lock. These
// caches are keyed by filter-parameter combinations, so without eviction the map
// grows unbounded as users try different filters; logical expiry alone never
// reclaims the memory.
func sweepGeneralStatsCache(now time.Time) {
	for k, entry := range generalStatsCache.entries {
		if !now.Before(entry.expiry) {
			delete(generalStatsCache.entries, k)
		}
	}
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
	// Shared secret required by mm-controller on every proxied API/WS call.
	// Must match INTERNAL_API_SECRET on the mm-controller service.
	mmInternalSecret = strings.TrimSpace(os.Getenv("INTERNAL_API_SECRET"))
	unifiedAPIURL = os.Getenv("UNIFIED_API_URL")
	if unifiedAPIURL == "" {
		unifiedAPIURL = "http://localhost:5010"
	}
	fiatControllerURL = strings.TrimRight(strings.TrimSpace(os.Getenv("FIAT_CONTROLLER_URL")), "/")
	if fiatControllerURL == "" {
		fiatControllerURL = "http://localhost:8080"
	}
	pushpushNotifySecret = strings.TrimSpace(os.Getenv("PUSHPUSH_NOTIFY_SECRET"))
	pushpushHeartbeatMaxAge = 15 * time.Minute
	if configured, err := time.ParseDuration(strings.TrimSpace(os.Getenv("PUSHPUSH_HEARTBEAT_MAX_AGE"))); err == nil && configured > 0 {
		pushpushHeartbeatMaxAge = configured
	}
	capabilityMaxAge = mmcapabilities.ParseMaxAge(os.Getenv("MM_CEX_CAPABILITY_MAX_AGE"))

	// Session cookie Secure attribute: default true (prod is HTTPS). Set
	// SESSION_COOKIE_SECURE=false only for local HTTP dev, where browsers drop
	// Secure cookies served over http:// and the login session would never persist.
	sessionCookieSecure = !strings.EqualFold(os.Getenv("SESSION_COOKIE_SECURE"), "false")
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
	mmProxy = mmproxy.New(mmControllerAPIURL).WithInternalSecret(mmInternalSecret)
	tradingAccountRepo = tradingaccounts.NewRepository(db)
	if err := tradingAccountRepo.EncryptLegacySecrets(context.Background()); err != nil {
		slog.Error("failed to encrypt legacy account secrets", "err", err)
		os.Exit(1)
	}
	authSvc := auth.New(db, auth.Config{CookieSecure: sessionCookieSecure})

	orchestrator := tradecost.NewTradeCostEstimatorWithPersistedFees(db)
	tradeCostEstimators = make(map[string]*tradecost.TradeCostEstimator, len(supportedCEXes))
	for _, c := range supportedCEXes {
		tradeCostEstimators[c] = orchestrator
		slog.Info("trade-cost CEX enabled", "cex", c, "fee_source", "persisted_exchange_snapshot")
	}
	tradeRouteOptimizer = tradecost.NewTradeRouteOptimizer(tradeCostEstimators)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Metrics registry.
	metricsReg := metrics.NewServiceRegistry("dexmonitor")

	// Payment method grouping service — RefreshLoop performs the initial load
	// (with retry, in case the DB isn't ready yet) and refreshes every hour.
	pmService = paymentmethods.NewService(db)
	pmRepo = &paymentmethods.Repo{DB: db}
	go pmService.RefreshLoop(ctx, time.Hour)
	go runStatisticsRefreshLoop(ctx.Done())

	mux := http.NewServeMux()
	legacyMux := http.NewServeMux()

	// Existing handlers remain the response implementation behind generated
	// strict request adapters while they are migrated operation by operation.
	authSvc.RegisterRoutes(legacyMux)
	registerLegacyBackendRoutes(legacyMux)
	registerOpenAPIRoutes(mux, legacyMux)

	mux.Handle("GET /metrics", metricsReg.Handler())

	// Static frontend: full Vite dist tree (assets/, brand/, favicon.svg, …).
	// Registered after API routes; literal patterns beat the {path...} wildcard.
	mux.HandleFunc("GET /{$}", serveFrontend)
	mux.HandleFunc("GET /{path...}", serveDistStatic)

	// tracing.WrapHandler outermost starts the server span and continues inbound
	// trace context; RouteNamer innermost names the span by matched route.
	// No CORS layer: the SPA is same-origin in prod (served by this process via
	// nginx) and in dev (vite proxies /api), and these routes expose trading
	// credentials — browsers must not be invited to call them cross-origin.
	// LoadAndSave loads the session into the request context (and writes the
	// Set-Cookie on the way out); it must wrap the gate, which reads the session
	// to require login for /api/* and /ws/* (auth endpoints excepted, see
	// auth.Protected). RouteNamer stays innermost so spans are named by the matched route.
	handler := tracing.WrapHandler(
		metricsReg.Middleware(
			authSvc.LoadAndSave(
				authSvc.Gate(auth.Protected)(tracing.RouteNamer(mux)),
			),
		),
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

// --- Handlers ---

func serveFrontend(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-cache")
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
	switch {
	case strings.HasPrefix(rel, "assets/"):
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	case strings.HasPrefix(rel, "brand/"):
		w.Header().Set("Cache-Control", "public, max-age=86400")
	default:
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeFile(w, r, full)
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
	rawFiat := strings.TrimSpace(r.URL.Query().Get("fiat"))
	fiatCurrency := "EUR"
	if rawFiat != "" {
		var ok bool
		fiatCurrency, ok = fiat.Normalize(rawFiat)
		if !ok {
			http.Error(w, "invalid fiat currency", http.StatusBadRequest)
			return
		}
	}
	if fiatCurrency == "" {
		fiatCurrency = "EUR"
	}

	rows, err := db.Query(
		rebind("SELECT * FROM offers WHERE is_live = FALSE AND fiat_currency = ? AND last_seen >= ? ORDER BY last_seen DESC LIMIT ?"),
		fiatCurrency, cutoff, limit,
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
		if offerHasExcludedPaymentMethod(o, excludedPaymentMethods) {
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
	// Hash the full id set: a len:min:max key collides for different sets that
	// share those three values, which would serve one query's aggregates for
	// another's within the cache TTL.
	h := fnv.New64a()
	var buf [8]byte
	for _, id := range sorted {
		binary.LittleEndian.PutUint64(buf[:], uint64(id))
		_, _ = h.Write(buf[:])
	}
	return fmt.Sprintf("%d:%x", len(sorted), h.Sum64())
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
	// The order_lifecycle aggregate can take many seconds on tens of millions
	// of rows; without a deadline a mis-planned query pins one of the pool's
	// few connections indefinitely.
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	aggregates, err := lifecycleRepo.LoadPastAggregates(ctx, ids)
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

func handlePastOrderStats(w http.ResponseWriter, r *http.Request) {
	p := pastTakerParamsFromRequest(r)
	p.ApplyPaymentExclusions = len(p.ExcludePaymentMethods) > 0
	stats, err := buildPastOrderStatsForQuery(p)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, stats)
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
	ID             int64                      `json:"id"`
	Exchange       string                     `json:"exchange"`
	OfferID        *string                    `json:"offer_id"`
	PaymentMethods []string                   `json:"payment_methods"`
	Direction      string                     `json:"direction"`
	Status         pastOfferStatus            `json:"status"`
	Pricing        pastOfferPricing           `json:"pricing"`
	Summary        pastProfitableOrderSummary `json:"summary"`
	Analysis       pastOfferAnalysisAPI       `json:"analysis"`
	Offer          map[string]any             `json:"offer"`
}

type pastProfitableOrderCompactAPI struct {
	ID             int64                      `json:"id"`
	Exchange       string                     `json:"exchange"`
	OfferID        *string                    `json:"offer_id"`
	PaymentMethods []string                   `json:"payment_methods"`
	Direction      string                     `json:"direction"`
	Status         pastOfferStatus            `json:"status"`
	Pricing        pastOfferPricing           `json:"pricing"`
	Summary        pastProfitableOrderSummary `json:"summary"`
}

func handlePastProfitableOrders(w http.ResponseWriter, r *http.Request) {
	p := pastTakerParamsFromRequest(r)
	p.ApplyPaymentExclusions = len(p.ExcludePaymentMethods) > 0
	result, err := buildPastProfitableOrdersForQuery(p)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, result)
}

type generalStatsContext struct {
	hours                  int
	excludedPaymentMethods []string
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
	if inflight, ok := generalStatsCache.inFlight[key]; ok {
		generalStatsCache.Unlock()
		<-inflight.done
		if inflight.err != nil {
			return generalStatsContext{}, inflight.err
		}
		return inflight.ctx, nil
	}
	if generalStatsCache.inFlight == nil {
		generalStatsCache.inFlight = make(map[string]*generalStatsInFlightEntry)
	}
	inflight := &generalStatsInFlightEntry{done: make(chan struct{})}
	generalStatsCache.inFlight[key] = inflight
	generalStatsCache.Unlock()

	ctx, err := loadGeneralStatsContextUncached(r)
	inflight.ctx = ctx
	inflight.err = err

	generalStatsCache.Lock()
	delete(generalStatsCache.inFlight, key)
	if err == nil {
		if generalStatsCache.entries == nil {
			generalStatsCache.entries = make(map[string]generalStatsCacheEntry)
		}
		sweepGeneralStatsCache(now)
		generalStatsCache.entries[key] = generalStatsCacheEntry{ctx: ctx, expiry: now.Add(dashboardCacheTTL)}
	}
	generalStatsCache.Unlock()
	close(inflight.done)
	if err != nil {
		return generalStatsContext{}, err
	}
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

	rows, err := db.Query(rebind(analyticsOffersQuery), cutoff)
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
			PaymentMethods:   offerStringSlice(o, "payment_methods"),
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
		offers:                 offers,
		generalOffers:          generalOffers,
		closedOfferIDs:         closedOfferIDs,
		now:                    time.Now(),
	}, nil
}

func (ctx generalStatsContext) overview() pastorders.GeneralStatsOverview {
	return pastorders.BuildGeneralStatsOverview(ctx.generalOffers, ctx.now, ctx.hours, ctx.excludedPaymentMethods)
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

func handleGeneralStatsPastPremiums(w http.ResponseWriter, r *http.Request) {
	ctx, err := loadGeneralStatsContext(r)
	if err != nil {
		writeError(w, err)
		return
	}
	lifecycleAgg := fetchPastOfferLifecycleAggregates(ctx.closedOfferIDs)
	writeJSON(w, ctx.pastPremiums(r, lifecycleAgg))
}

func handleGeneralStatsLifetimes(w http.ResponseWriter, r *http.Request) {
	ctx, err := loadGeneralStatsContext(r)
	if err != nil {
		writeError(w, err)
		return
	}
	lifecycleAgg := fetchPastOfferLifecycleAggregates(ctx.closedOfferIDs)
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

func buildPastPremiumStats(offers []map[string]any, lifecycleAgg map[int64]pastLifecycleAggregate, now time.Time, excludedPaymentMethods []string, maxFiatLimitEUR float64, requiredConfirmations int, excludedCEXes []string, feeTier string) []pastorders.PastPremiumTimeframeStats {
	pastPremiums, _ := buildPastPremiumAndLifetimeStats(
		offers,
		lifecycleAgg,
		now,
		excludedPaymentMethods,
		maxFiatLimitEUR,
		requiredConfirmations,
		excludedCEXes,
		feeTier,
	)
	return pastPremiums
}

func buildPremiumLifetimeStats(offers []map[string]any, lifecycleAgg map[int64]pastLifecycleAggregate, now time.Time, excludedPaymentMethods []string, maxFiatLimitEUR float64, requiredConfirmations int, excludedCEXes []string, feeTier string) pastorders.PremiumLifetimeModes {
	_, lifetimes := buildPastPremiumAndLifetimeStats(
		offers,
		lifecycleAgg,
		now,
		excludedPaymentMethods,
		maxFiatLimitEUR,
		requiredConfirmations,
		excludedCEXes,
		feeTier,
	)
	return lifetimes
}

func persistedLifecycleAggregateForOffer(offer map[string]any) pastLifecycleAggregate {
	return pastLifecycleAggregate{
		AvgRefPrice:       tradecost.Round4(offerFloat(offer, "avg_ref_price")),
		AvgPremiumPercent: tradecost.Round4(offerFloat(offer, "avg_premium_pct")),
		AvgTradeCostPct:   tradecost.Round4(offerFloat(offer, "avg_trade_cost_pct")),
		AvgTradeCostBTC:   tradecost.Round8(offerFloat(offer, "avg_trade_cost_btc")),
		AvgNetPercent:     tradecost.Round4(offerFloat(offer, "avg_net_premium_pct")),
		AvgProfitBTC:      tradecost.Round8(offerFloat(offer, "avg_estimated_profit_btc")),
		AvgProfitFiat:     tradecost.Round4(offerFloat(offer, "avg_estimated_profit_fiat")),
		AvgBTCAmount:      tradecost.Round8(offerFloat(offer, "avg_btc_amount")),
	}
}

func buildPastPremiumAndLifetimeStatsFromPersistedOffers(
	offers []map[string]any,
	now time.Time,
	excludedPaymentMethods []string,
	maxFiatLimitEUR float64,
	requiredConfirmations int,
	excludedCEXes []string,
	feeTier string,
) ([]pastorders.PastPremiumTimeframeStats, pastorders.PremiumLifetimeModes) {
	lifecycleAgg := make(map[int64]pastLifecycleAggregate, len(offers))
	for _, offer := range offers {
		id := int64(offerFloat(offer, "id"))
		if id <= 0 {
			continue
		}
		lifecycleAgg[id] = persistedLifecycleAggregateForOffer(offer)
	}
	return buildPastPremiumAndLifetimeStats(
		offers,
		lifecycleAgg,
		now,
		excludedPaymentMethods,
		maxFiatLimitEUR,
		requiredConfirmations,
		excludedCEXes,
		feeTier,
	)
}

func buildPastPremiumAndLifetimeStats(
	offers []map[string]any,
	lifecycleAgg map[int64]pastLifecycleAggregate,
	now time.Time,
	excludedPaymentMethods []string,
	maxFiatLimitEUR float64,
	requiredConfirmations int,
	excludedCEXes []string,
	feeTier string,
) ([]pastorders.PastPremiumTimeframeStats, pastorders.PremiumLifetimeModes) {
	_ = requiredConfirmations
	_ = excludedCEXes
	_ = feeTier

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

	type premiumBucket struct {
		label       string
		hours       int
		cutoff      time.Time
		rawSum      map[string]float64
		rawCount    map[string]int
		netSum      map[string]float64
		netCount    map[string]int
		cappedSum   map[string]float64
		cappedCount map[string]int
	}

	premiumBuckets := make([]premiumBucket, len(pastorders.PastPremiumTimeframes))
	for i, tf := range pastorders.PastPremiumTimeframes {
		premiumBuckets[i] = premiumBucket{
			label:       tf.Label,
			hours:       tf.Hours,
			cutoff:      now.Add(-time.Duration(tf.Hours) * time.Hour),
			rawSum:      map[string]float64{},
			rawCount:    map[string]int{},
			netSum:      map[string]float64{},
			netCount:    map[string]int{},
			cappedSum:   map[string]float64{},
			cappedCount: map[string]int{},
		}
	}

	type lifetimeAcc struct {
		sum           time.Duration
		count         int
		sumByExchange map[string]time.Duration
		cntByExchange map[string]int
	}
	makeLifetimeAcc := func() lifetimeAcc {
		return lifetimeAcc{
			sumByExchange: map[string]time.Duration{},
			cntByExchange: map[string]int{},
		}
	}
	addLifetime := func(a *lifetimeAcc, exchange string, lifetime time.Duration) {
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
	rawLifetimeAcc := makeLifetimeAcc()
	netLifetimeAcc := makeLifetimeAcc()
	cappedLifetimeAcc := makeLifetimeAcc()

	for _, offer := range offers {
		if offerBool(offer, "is_live") {
			continue
		}
		exchange := offerString(offer, "exchange")
		if exchange == "" {
			continue
		}
		if offerHasExcludedPaymentMethod(offer, excludedPaymentMethods) {
			continue
		}

		lastSeen := parseDBTime(offerString(offer, "last_seen"))
		firstSeen := parseDBTime(offerString(offer, "first_seen"))

		id := int64(offerFloat(offer, "id"))
		agg := lifecycleAgg[id]

		rawPremium := agg.AvgPremiumPercent
		if rawPremium == 0 {
			rawPremium = tradecost.Round4(offerFloat(offer, "avg_premium_pct"))
		}
		netPremium := agg.AvgNetPercent
		if netPremium == 0 {
			netPremium = tradecost.Round4(offerFloat(offer, "avg_net_premium_pct"))
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
				if !cappedTradeIsExecutable(offer, btcCap, maxFiatLimitEUR) {
					cappedPremium = 0
				} else if fullTradeSizeBTC > btcCap {
					cappedPremium = cappedNetPremium(offer, agg, fullTradeSizeBTC, maxFiatLimitEUR)
				}
			}
		}

		if !firstSeen.IsZero() && !lastSeen.IsZero() && !lastSeen.Before(firstSeen) {
			lifetime := lastSeen.Sub(firstSeen)
			if rawPremium > 0 {
				addLifetime(&rawLifetimeAcc, exchange, lifetime)
			}
			if netPremium > 0 {
				addLifetime(&netLifetimeAcc, exchange, lifetime)
			}
			if cappedPremium > 0 {
				addLifetime(&cappedLifetimeAcc, exchange, lifetime)
			}
		}

		if lastSeen.IsZero() {
			continue
		}

		for i := range premiumBuckets {
			if lastSeen.Before(premiumBuckets[i].cutoff) {
				continue
			}
			if raw, ok := positiveOrZero(rawPremium); ok {
				premiumBuckets[i].rawSum[exchange] += raw
				premiumBuckets[i].rawCount[exchange]++
			}
			if net, ok := positiveOrZero(netPremium); ok {
				premiumBuckets[i].netSum[exchange] += net
				premiumBuckets[i].netCount[exchange]++
			}
			if capped, ok := positiveOrZero(cappedPremium); ok {
				premiumBuckets[i].cappedSum[exchange] += capped
				premiumBuckets[i].cappedCount[exchange]++
			}
		}
	}

	pastPremiums := make([]pastorders.PastPremiumTimeframeStats, 0, len(premiumBuckets))
	for _, bucket := range premiumBuckets {
		raw := buildNamed(bucket.rawSum, bucket.rawCount)
		pastPremiums = append(pastPremiums, pastorders.PastPremiumTimeframeStats{
			Timeframe:            bucket.label,
			Hours:                bucket.hours,
			AvgPremiumByExchange: raw,
			Modes: pastorders.PastPremiumModes{
				Raw:       raw,
				NetFull:   buildNamed(bucket.netSum, bucket.netCount),
				NetCapped: buildNamed(bucket.cappedSum, bucket.cappedCount),
			},
		})
	}

	toLifetimeStats := func(a lifetimeAcc) pastorders.PremiumLifetimeStats {
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

	return pastPremiums, pastorders.PremiumLifetimeModes{
		Raw:       toLifetimeStats(rawLifetimeAcc),
		NetFull:   toLifetimeStats(netLifetimeAcc),
		NetCapped: toLifetimeStats(cappedLifetimeAcc),
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
	// cappedTradeExecutable is false when the configured fiat cap is below
	// the offer's minimum executable volume.
	cappedTradeExecutable bool
	btcSizeMin            float64
	estimatedProfitBTCMin float64
	hasMin                bool
}

type takerOpportunityMode string

const (
	takerOpportunityModeNetFull   takerOpportunityMode = "net_full"
	takerOpportunityModeNetCapped takerOpportunityMode = "net_capped"
	takerOpportunityModeNetMin    takerOpportunityMode = "net_min"
)

func (a pastOfferAnalysis) valuesForMode(mode takerOpportunityMode) (float64, float64) {
	if mode == takerOpportunityModeNetCapped && !a.cappedTradeExecutable {
		return 0, 0
	}
	if mode == takerOpportunityModeNetCapped && a.hasCap {
		return a.btcSizeCapped, a.estimatedProfitBTCCapped
	}
	if mode == takerOpportunityModeNetMin && a.hasMin {
		return a.btcSizeMin, a.estimatedProfitBTCMin
	}
	return a.btcSize, a.estimatedProfitBTC
}

func cappedTradeIsExecutable(o map[string]any, btcCap, fiatCap float64) bool {
	if btcCap <= 0 {
		return false
	}
	if btcMin := offerFloat(o, "btc_min"); btcMin > btcCap {
		return false
	}
	if fiatMin := offerInt64Ptr(o, "fiat_min"); fiatMin != nil && float64(*fiatMin) > fiatCap {
		return false
	}
	return true
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
	CexTaker   pastOfferCostValue            `json:"cex_taker"`
	Withdrawal pastOfferCostValue            `json:"withdrawal"`
	DexFee     pastOfferCostValue            `json:"dex_fee"`
	Network    pastOfferCostValue            `json:"network"`
	Conversion tradecost.ConversionBreakdown `json:"conversion"`
	Hedge      pastOfferHedgeCosts           `json:"hedge"`
	Total      pastOfferCostValue            `json:"total"`
}

type pastOfferScenario struct {
	CapFiat       *float64                      `json:"cap_fiat,omitempty"`
	CostPolicy    string                        `json:"cost_policy,omitempty"`
	Assumptions   []string                      `json:"assumptions,omitempty"`
	TradeSizeBTC  float64                       `json:"trade_size_btc"`
	TradeSizeFiat float64                       `json:"trade_size_fiat"`
	Route         pastOfferRoute                `json:"route"`
	Premium       pastOfferPremium              `json:"premium"`
	Profit        pastOfferProfit               `json:"profit"`
	Costs         pastOfferScenarioCosts        `json:"costs"`
	Capital       *tradecost.CapitalRequirement `json:"capital,omitempty"`
}

type pastOfferAnalysisAPI struct {
	FullVolume             pastOfferScenario  `json:"full_volume"`
	CappedVolume           *pastOfferScenario `json:"capped_volume,omitempty"`
	CappedVolumeExecutable bool               `json:"capped_volume_executable"`
	MinVolume              *pastOfferScenario `json:"min_volume,omitempty"`
}

type pastOfferAPI struct {
	ID               int64                  `json:"id"`
	Exchange         string                 `json:"exchange"`
	OfferID          *string                `json:"offer_id"`
	PaymentMethods   []string               `json:"payment_methods"`
	Direction        string                 `json:"direction"`
	Status           pastOfferStatus        `json:"status"`
	Pricing          pastOfferPricing       `json:"pricing"`
	VolumeLimits     pastOfferVolumeLimits  `json:"volume_limits"`
	BTCNetworkFee    pastOfferBTCNetworkFee `json:"btc_network_fee"`
	Analysis         pastOfferAnalysisAPI   `json:"analysis"`
	ObservationCount int                    `json:"observation_count,omitempty"`
}

type pastOfferCompactAPI struct {
	ID             int64                 `json:"id"`
	Exchange       string                `json:"exchange"`
	OfferID        *string               `json:"offer_id"`
	PaymentMethods []string              `json:"payment_methods"`
	Direction      string                `json:"direction"`
	Status         pastOfferStatus       `json:"status"`
	Pricing        pastOfferPricing      `json:"pricing"`
	VolumeLimits   pastOfferVolumeLimits `json:"volume_limits"`
}

type pastLifecycleAggregate = lifecycle.PastAggregate

func addPastOfferCostFieldsFull(o map[string]any, agg pastLifecycleAggregate, requiredConfirmations int, excludedCEXes []string, feeTier string, maxFiatLimitEUR float64) pastOfferAnalysis {
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
	// agg (real historical hedge averages) isn't available in this stats-only
	// path; this cost_breakdown isn't what's served to the frontend (see
	// buildPastOfferAPI below for that), so the live-recomputed estimate is fine here.
	o["cost_breakdown"] = buildStoredPastBreakdown(o, btcSize, refPrice, storedTradeCostPct, storedTradeCostBTC, netPremium, estimatedProfitBTC, 0, 0, 0)

	// Capped profit is estimated once from the offer's whole-life averages
	// (agg, backed by a GROUP BY over order_lifecycle) rather than replaying
	// every historical tick — see buildPastOfferAPI's capped scenario for the
	// same approach and the reasoning behind it.
	avgRefPriceForCap := agg.AvgRefPrice
	if avgRefPriceForCap <= 0 {
		avgRefPriceForCap = refPrice
	}
	avgPremiumForCap := agg.AvgPremiumPercent
	if avgPremiumForCap == 0 {
		avgPremiumForCap = priceDiff
	}

	var btcSizeCapped float64
	var estimatedProfitBTCCapped float64
	hasCap := false
	cappedTradeExecutable := true
	if maxFiatLimitEUR > 0 && avgRefPriceForCap > 0 {
		btcCap := maxFiatLimitEUR / avgRefPriceForCap
		cappedTradeExecutable = cappedTradeIsExecutable(o, btcCap, maxFiatLimitEUR)
		if cappedTradeExecutable && btcSize > btcCap {
			bdCapped := buildCappedPastBreakdown(o, btcSize, btcCap, avgRefPriceForCap, avgPremiumForCap,
				agg.AvgHedgeNotionalEUR, agg.AvgLeverageUsed, agg.AvgRecommendedCollateral)
			btcSizeCapped = btcCap
			estimatedProfitBTCCapped = bdCapped.EstimatedProfitBTC
			hasCap = true
		}
	}

	var btcSizeMin float64
	var estimatedProfitBTCMin float64
	hasMin := btcMinPtr != nil && *btcMinPtr > 0 && *btcMinPtr < btcSize
	if hasMin {
		btcSizeMin = *btcMinPtr
		if stored := offerFloat(o, "avg_min_btc_amount"); stored > 0 {
			btcSizeMin = stored
		}
		if offerBool(o, "min_volume_analyzed") {
			estimatedProfitBTCMin = offerFloat(o, "avg_min_estimated_profit_btc")
		} else {
			minRep := buildCappedPastBreakdown(o, btcSize, btcSizeMin, avgRefPriceForCap, avgPremiumForCap,
				agg.AvgHedgeNotionalEUR, agg.AvgLeverageUsed, agg.AvgRecommendedCollateral)
			estimatedProfitBTCMin = minRep.EstimatedProfitBTC
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
		cappedTradeExecutable:    cappedTradeExecutable,
		btcSizeMin:               btcSizeMin,
		estimatedProfitBTCMin:    estimatedProfitBTCMin,
		hasMin:                   hasMin,
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
	fullRep := buildStoredPastBreakdown(o, fullTradeSizeBTC, avgRefPrice, avgTradeCostPct, avgTradeCostBTC, avgNetPercent, avgProfitBTC,
		agg.AvgHedgeNotionalEUR, agg.AvgLeverageUsed, agg.AvgRecommendedCollateral)
	fullCapital := pastOfferCapitalRequirement(o, fullTradeSizeBTC, avgRefPrice, fullRep.Hedge.Position)
	if avgNetworkPct == 0 {
		avgNetworkPct = tradecost.Round4(routingFeeSumPct(fullRep))
	}
	fullTradeSizeFiat := tradecost.Round4(fullTradeSizeBTC * avgRefPrice)

	fullScenario := pastOfferScenario{
		CostPolicy:    "historical_persisted",
		TradeSizeBTC:  tradecost.Round8(fullTradeSizeBTC),
		TradeSizeFiat: fullTradeSizeFiat,
		Route: pastOfferRoute{
			CEX:        offerString(o, "best_route_cex"),
			Settlement: offerRoutingSettlement(o),
		},
		Premium: pastOfferPremium{
			AvgTradeCostPercent: avgTradeCostPct,
			AvgNetPercent:       avgNetPercent,
		},
		Profit: pastOfferProfit{
			AvgBTC:  avgProfitBTC,
			AvgFiat: avgProfitFiat,
		},
		Costs:   buildPastScenarioCosts(fullRep, avgNetworkPct, avgTradeCostPct, avgTradeCostBTC),
		Capital: fullCapital,
	}

	cappedTradeExecutable := true
	var cappedScenario *pastOfferScenario
	if maxFiatLimitEUR > 0 && avgRefPrice > 0 {
		cappedTradeSizeBTC := tradecost.Round8(maxFiatLimitEUR / avgRefPrice)
		cappedTradeExecutable = cappedTradeIsExecutable(o, cappedTradeSizeBTC, maxFiatLimitEUR)
		if cappedTradeExecutable && fullTradeSizeBTC > cappedTradeSizeBTC {
			// Estimated once from whole-life averages rather than replaying every
			// historical tick (order_lifecycle can hold hundreds of rows per offer).
			cappedRep := buildCappedPastBreakdown(o, fullTradeSizeBTC, cappedTradeSizeBTC, avgRefPrice, avgPremiumPercent,
				agg.AvgHedgeNotionalEUR, agg.AvgLeverageUsed, agg.AvgRecommendedCollateral)
			cappedCapital := pastOfferCapitalRequirement(o, cappedTradeSizeBTC, avgRefPrice, cappedRep.Hedge.Position)
			cappedAvgTradeCostPct := tradecost.Round4(cappedRep.TotalCostPct)
			cappedAvgNetPct := tradecost.Round4(cappedRep.EstimatedProfitPct)
			cappedAvgProfitBTC := tradecost.Round8(cappedRep.EstimatedProfitBTC)
			cappedAvgProfitFiat := tradecost.Round4(cappedRep.EstimatedProfitBTC * avgRefPrice)
			cappedAvgTradeCostBTC := tradecost.Round8(cappedRep.TotalCostBTC)
			cappedAvgNetworkPct := tradecost.Round4(routingFeeSumPct(cappedRep))
			capFiat := tradecost.Round4(maxFiatLimitEUR)
			cappedScenario = &pastOfferScenario{
				CapFiat:       &capFiat,
				CostPolicy:    "historical_route_fixed_transfer_recomputed_size_proportional",
				Assumptions:   []string{"historical route", "fixed historical transfer/network assumptions", "recalculated hedge and proportional trading fees for capped BTC size"},
				TradeSizeBTC:  cappedTradeSizeBTC,
				TradeSizeFiat: tradecost.Round4(cappedTradeSizeBTC * avgRefPrice),
				Route: pastOfferRoute{
					CEX:        offerString(o, "best_route_cex"),
					Settlement: offerRoutingSettlement(o),
				},
				Premium: pastOfferPremium{
					AvgTradeCostPercent: cappedAvgTradeCostPct,
					AvgNetPercent:       cappedAvgNetPct,
				},
				Profit: pastOfferProfit{
					AvgBTC:  cappedAvgProfitBTC,
					AvgFiat: cappedAvgProfitFiat,
				},
				Costs:   buildPastScenarioCosts(cappedRep, cappedAvgNetworkPct, cappedAvgTradeCostPct, cappedAvgTradeCostBTC),
				Capital: cappedCapital,
			}
		}
	}

	var minScenario *pastOfferScenario
	if btcMinPtr != nil && *btcMinPtr > 0 && *btcMinPtr < fullTradeSizeBTC && avgRefPrice > 0 {
		minTradeSizeBTC := tradecost.Round8(*btcMinPtr)
		if stored := offerFloat(o, "avg_min_btc_amount"); stored > 0 {
			minTradeSizeBTC = tradecost.Round8(stored)
		}
		minRep := buildCappedPastBreakdown(o, fullTradeSizeBTC, minTradeSizeBTC, avgRefPrice, avgPremiumPercent,
			agg.AvgHedgeNotionalEUR, agg.AvgLeverageUsed, agg.AvgRecommendedCollateral)
		minCapital := pastOfferCapitalRequirement(o, minTradeSizeBTC, avgRefPrice, minRep.Hedge.Position)
		minTradeCostPct := tradecost.Round4(minRep.TotalCostPct)
		minTradeCostBTC := tradecost.Round8(minRep.TotalCostBTC)
		minNetPct := tradecost.Round4(minRep.EstimatedProfitPct)
		minProfitBTC := tradecost.Round8(minRep.EstimatedProfitBTC)
		minProfitFiat := tradecost.Round4(minProfitBTC * avgRefPrice)
		if offerBool(o, "min_volume_analyzed") && o["avg_min_estimated_profit_btc"] != nil {
			minTradeCostPct = tradecost.Round4(offerFloat(o, "avg_min_trade_cost_pct"))
			minTradeCostBTC = tradecost.Round8(offerFloat(o, "avg_min_trade_cost_btc"))
			minNetPct = tradecost.Round4(offerFloat(o, "avg_min_net_premium_pct"))
			minProfitBTC = tradecost.Round8(offerFloat(o, "avg_min_estimated_profit_btc"))
			minProfitFiat = tradecost.Round4(offerFloat(o, "avg_min_estimated_profit_fiat"))
		}
		minScenario = &pastOfferScenario{
			CostPolicy:    "historical_min_volume",
			Assumptions:   []string{"minimum executable offer volume", "historical route", "fixed historical transfer/network assumptions"},
			TradeSizeBTC:  minTradeSizeBTC,
			TradeSizeFiat: tradecost.Round4(minTradeSizeBTC * avgRefPrice),
			Route:         pastOfferRoute{CEX: offerString(o, "best_route_cex"), Settlement: offerRoutingSettlement(o)},
			Premium:       pastOfferPremium{AvgTradeCostPercent: minTradeCostPct, AvgNetPercent: minNetPct},
			Profit:        pastOfferProfit{AvgBTC: minProfitBTC, AvgFiat: minProfitFiat},
			Costs:         buildPastScenarioCosts(minRep, tradecost.Round4(routingFeeSumPct(minRep)), minTradeCostPct, minTradeCostBTC),
			Capital:       minCapital,
		}
	}

	return pastOfferAPI{
		ID:             id,
		Exchange:       offerString(o, "exchange"),
		OfferID:        offerStringPtr(o, "offer_id"),
		PaymentMethods: offerStringSlice(o, "payment_methods"),
		Direction:      offerString(o, "direction"),
		Status: pastOfferStatus{
			IsLive:    false,
			FirstSeen: firstSeen,
			LastSeen:  lastSeen,
			Duration:  duration,
		},
		Pricing: pastOfferPricing{
			PriceType:         normalizePastPriceType(offerString(o, "price_type")),
			FiatCurrency:      nonEmptyString(offerString(o, "fiat_currency"), "EUR"),
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
			FullVolume:             fullScenario,
			CappedVolume:           cappedScenario,
			CappedVolumeExecutable: cappedTradeExecutable,
			MinVolume:              minScenario,
		},
		ObservationCount: agg.Count,
	}
}

func pastOfferCapitalRequirement(o map[string]any, btcAmount, refPrice float64, hedgePosition *tradecost.HedgePositionDetail) *tradecost.CapitalRequirement {
	if btcAmount <= 0 {
		return nil
	}
	var depositPct *float64
	if value := offerFloat(o, "security_deposit_pct"); value > 0 {
		depositPct = &value
	}
	capital := tradecost.CapitalRequirementForTrade(
		btcAmount,
		refPrice,
		offerString(o, "exchange"),
		offerString(o, "direction") != "ask",
		hedgePosition,
		depositPct,
	)
	return &capital
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
		ID:             int64(offerFloat(o, "id")),
		Exchange:       offerString(o, "exchange"),
		OfferID:        offerStringPtr(o, "offer_id"),
		PaymentMethods: offerStringSlice(o, "payment_methods"),
		Direction:      offerString(o, "direction"),
		Status: pastOfferStatus{
			IsLive:    false,
			FirstSeen: firstSeen,
			LastSeen:  lastSeen,
			Duration:  buildPastOfferDuration(firstTime, lastTime),
		},
		Pricing: pastOfferPricing{
			PriceType:         normalizePastPriceType(offerString(o, "price_type")),
			FiatCurrency:      nonEmptyString(offerString(o, "fiat_currency"), "EUR"),
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

func buildPastProfitableOrderAPI(o map[string]any, analysis pastOfferAnalysis, agg pastLifecycleAggregate, requiredConfirmations int, excludedCEXes []string, feeTier string, maxFiatLimitEUR float64, mode takerOpportunityMode) pastProfitableOrderAPI {
	pastOffer := buildPastOfferAPI(o, agg, requiredConfirmations, excludedCEXes, feeTier, maxFiatLimitEUR)
	summary := buildPastProfitableOrderSummary(analysis, pastOffer.Analysis, mode)

	return pastProfitableOrderAPI{
		ID:             pastOffer.ID,
		Exchange:       pastOffer.Exchange,
		OfferID:        pastOffer.OfferID,
		PaymentMethods: pastOffer.PaymentMethods,
		Direction:      pastOffer.Direction,
		Status:         pastOffer.Status,
		Pricing:        pastOffer.Pricing,
		Summary:        summary,
		Analysis:       pastOffer.Analysis,
		Offer:          buildOfferTablePayload(o),
	}
}

func buildPastProfitableOrderSummary(analysis pastOfferAnalysis, offerAnalysis pastOfferAnalysisAPI, mode takerOpportunityMode) pastProfitableOrderSummary {
	tradeSizeBTC, netProfitBTC := analysis.valuesForMode(mode)
	summary := pastProfitableOrderSummary{
		NetProfitBTC:  tradecost.Round8(netProfitBTC),
		NetProfitFiat: tradecost.Round4(netProfitBTC * analysis.refPrice),
		TradeSizeBTC:  tradecost.Round8(tradeSizeBTC),
		TradeSizeFiat: tradecost.Round4(tradeSizeBTC * analysis.refPrice),
		NetPercent:    offerAnalysis.FullVolume.Premium.AvgNetPercent,
	}
	if mode == takerOpportunityModeNetCapped && offerAnalysis.CappedVolume != nil {
		summary.NetPercent = offerAnalysis.CappedVolume.Premium.AvgNetPercent
	}
	if mode == takerOpportunityModeNetMin && offerAnalysis.MinVolume != nil {
		summary.NetPercent = offerAnalysis.MinVolume.Premium.AvgNetPercent
	}
	if offerAnalysis.CappedVolume != nil {
		summary.CapFiat = offerAnalysis.CappedVolume.CapFiat
	}
	return summary
}

func buildPastProfitableOrderCompactAPI(o map[string]any, analysis pastOfferAnalysis) pastProfitableOrderCompactAPI {
	pastOffer := buildPastOfferCompactAPI(o)
	offerAnalysis := pastOfferAnalysisAPI{
		FullVolume: pastOfferScenario{
			TradeSizeBTC:  tradecost.Round8(analysis.btcSize),
			TradeSizeFiat: tradecost.Round4(analysis.btcSize * analysis.refPrice),
			Premium: pastOfferPremium{
				AvgNetPercent: tradecost.Round4(nonZeroFloat(offerFloat(o, "avg_net_premium_pct"), offerFloat(o, "net_premium_percent"))),
			},
			Profit: pastOfferProfit{
				AvgBTC:  tradecost.Round8(analysis.estimatedProfitBTC),
				AvgFiat: tradecost.Round4(analysis.estimatedProfitBTC * analysis.refPrice),
			},
		},
	}
	return pastProfitableOrderCompactAPI{
		ID:             pastOffer.ID,
		Exchange:       pastOffer.Exchange,
		OfferID:        pastOffer.OfferID,
		PaymentMethods: pastOffer.PaymentMethods,
		Direction:      pastOffer.Direction,
		Status:         pastOffer.Status,
		Pricing:        pastOffer.Pricing,
		Summary:        buildPastProfitableOrderSummary(analysis, offerAnalysis, takerOpportunityModeNetFull),
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
	if direction == "ask" {
		return "long"
	}
	return "short"
}

func buildStoredPastBreakdown(o map[string]any, btcSize, refPrice, tradeCostPct, tradeCostBTC, netPremiumPct, profitBTC, avgHedgeNotionalEUR, avgLeverageUsed, avgRecommendedCollateral float64) tradecost.CostBreakdown {
	if btcSize <= 0 {
		return tradecost.CostBreakdown{}
	}
	direction := offerString(o, "direction")
	isAsk := direction == "ask"
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
	routeCEX := offerString(o, "best_route_cex")

	// Recompute the hedge live (mirrors buildStoredCappedBreakdown) so the row survives even
	// when the stored hedge_* columns are NULL/0 — e.g. offers snapshotted before hedge was
	// persisted. Fall back to the stored columns when no estimator is available.
	hedge := tradecost.HedgeBreakdown{}
	if est := tradeCostEstimators[routeCEX]; est != nil {
		hedge = est.EstimateHedgeBreakdownForDirection(
			btcSize, refPrice, offerFloat(o, "hedge_transfer_minutes"), true, direction)
	}
	if hedge.FeeSumBTC == 0 {
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
	}
	// The real, measured collateral requirement beats the live-recomputed
	// estimate above: it reflects what this offer's hedge actually needed
	// while it was live, not what it would cost to hedge at today's price.
	if avgRecommendedCollateral > 0 {
		hedge.Position = &tradecost.HedgePositionDetail{
			Side:                  hedge.Side,
			HedgeRatio:            1.0,
			LeverageUsed:          tradecost.Round4(avgLeverageUsed),
			HedgeNotionalEUR:      tradecost.Round2(avgHedgeNotionalEUR),
			RecommendedCollateral: tradecost.Round2(avgRecommendedCollateral),
			BTCPrice:              tradecost.Round2(refPrice),
			Historical:            true,
		}
	}
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
	profile, method, onchainBTC, sumBTC, detailTxs, conversion, netDetail := pastRoutingFees(o)
	if detailTxs > 0 {
		numNetworkTxs = detailTxs
	}
	return tradecost.CostBreakdown{
		BTCAmount:          tradecost.Round8(btcSize),
		RouteCEX:           routeCEX,
		RouteDEX:           offerString(o, "exchange"),
		RouteMethod:        method,
		RoutingProfile:     profile,
		TradeDirection:     tradeDir,
		NumNetworkTxs:      numNetworkTxs,
		EstimatedProfitPct: tradecost.Round4(netPremiumPct),
		EstimatedProfitBTC: tradecost.Round8(profitBTC),
		CexTakerFeeBTC:     tradecost.Round8(offerFloat(o, "cex_taker_fee_btc")),
		CexTakerFeePct:     pct(offerFloat(o, "cex_taker_fee_btc")),
		WithdrawalFeeBTC:   tradecost.Round8(withdrawalBTC),
		WithdrawalFeePct:   pct(withdrawalBTC),
		NetworkFeeBTC:      tradecost.Round8(onchainBTC),
		NetworkFeePct:      pct(onchainBTC),
		RoutingFeeSumBTC:   tradecost.Round8(sumBTC),
		RoutingFeeSumPct:   pct(sumBTC),
		NetworkFeeMethod:   method,
		NetworkFeeDetail:   netDetail,
		Conversion:         conversion,
		Hedge:              hedge,
		DexFeeBTC:          tradecost.Round8(offerFloat(o, "dex_fee_btc")),
		DexFeePct:          pct(offerFloat(o, "dex_fee_btc")),
		TotalCostPct:       tradecost.Round4(tradeCostPct),
		TotalCostBTC:       tradecost.Round8(tradeCostBTC),
	}
}

func buildCappedPastBreakdown(o map[string]any, fullBTCSize, cappedBTCSize, refPrice, premiumPct, avgHedgeNotionalEUR, avgLeverageUsed, avgRecommendedCollateral float64) tradecost.CostBreakdown {
	if cappedBTCSize <= 0 {
		return tradecost.CostBreakdown{}
	}
	direction := offerString(o, "direction")
	isAsk := direction == "ask"
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
	// scaleSize scales a full-size historical figure (e.g. notional) down to
	// the capped trade size, same proportional approach as scaleStored.
	scaleSize := func(v float64) float64 {
		if fullBTCSize <= 0 {
			return 0
		}
		return cappedBTCSize * (v / fullBTCSize)
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
	// Scale the real measured full-size collateral down to the capped size —
	// notional scales linearly with trade size; leverage is a ratio and
	// doesn't scale. Beats the live-recomputed estimate above for the same
	// reason as the full-volume breakdown.
	if avgRecommendedCollateral > 0 {
		hedge.Position = &tradecost.HedgePositionDetail{
			Side:                  hedge.Side,
			HedgeRatio:            1.0,
			LeverageUsed:          tradecost.Round4(avgLeverageUsed),
			HedgeNotionalEUR:      tradecost.Round2(scaleSize(avgHedgeNotionalEUR)),
			RecommendedCollateral: tradecost.Round2(scaleSize(avgRecommendedCollateral)),
			BTCPrice:              tradecost.Round2(refPrice),
			Historical:            true,
		}
	}

	withdrawalBTC := 0.0
	tradeDir := "ask"
	numNetworkTxs := 1
	if !isAsk {
		withdrawalBTC = offerFloat(o, "cex_withdraw_fee_btc")
		tradeDir = "bid"
		numNetworkTxs = 2
	}
	profile, method, onchainBTC, sumBTC, detailTxs, conversion, netDetail := pastRoutingFees(o)
	if detailTxs > 0 {
		numNetworkTxs = detailTxs
	}
	// Cap path keeps historical routing fees fixed (not size-proportional).
	totalBTC := takerBTC + withdrawalBTC + sumBTC + dexFeeBTC + hedge.FeeSumBTC
	totalPct := pct(totalBTC)
	netPct := tradecost.Round4(premiumPct - totalPct)
	profitBTC := tradecost.Round8(cappedBTCSize * netPct / 100)
	return tradecost.CostBreakdown{
		BTCAmount:          tradecost.Round8(cappedBTCSize),
		RouteCEX:           routeCEX,
		RouteDEX:           dexExchange,
		RouteMethod:        method,
		RoutingProfile:     profile,
		TradeDirection:     tradeDir,
		NumNetworkTxs:      numNetworkTxs,
		EstimatedProfitPct: netPct,
		EstimatedProfitBTC: profitBTC,
		CexTakerFeePct:     pct(takerBTC),
		CexTakerFeeBTC:     tradecost.Round8(takerBTC),
		WithdrawalFeePct:   pct(withdrawalBTC),
		WithdrawalFeeBTC:   tradecost.Round8(withdrawalBTC),
		NetworkFeePct:      pct(onchainBTC),
		NetworkFeeBTC:      tradecost.Round8(onchainBTC),
		RoutingFeeSumPct:   pct(sumBTC),
		RoutingFeeSumBTC:   tradecost.Round8(sumBTC),
		NetworkFeeMethod:   method,
		NetworkFeeDetail:   netDetail,
		Conversion:         conversion,
		Hedge:              hedge,
		DexFeePct:          pct(dexFeeBTC),
		DexFeeBTC:          tradecost.Round8(dexFeeBTC),
		TotalCostPct:       totalPct,
		TotalCostBTC:       tradecost.Round8(totalBTC),
	}
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
		Conversion: rep.Conversion,
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

const ohlcCandleTimeLayout = "2006-01-02T15:04:05"

// Exchange APIs cap OHLC history (Kraken returns at most 720 candles per
// interval, so 1-min data only reaches ~12h back). The snapshot service
// continuously stores Kraken 1-min candles in the ohlc table; the DB
// back-fill window stays bounded so a runaway hours param can't scan years.
const maxOHLCBackfillHours = 24 * 180

func handleOHLC(w http.ResponseWriter, r *http.Request) {
	hours := queryInt(r, "hours", 24)
	cex := queryCex(r)
	fiatCurrency := queryFiat(r)
	intervalMin := queryOHLCInterval(r)

	if ohlcService == nil {
		ohlcService = ohlc.NewService()
	}
	candles := ohlcService.CandlesForFiat(r.Context(), cex, fiatCurrency, hours, intervalMin)
	if candles == nil {
		candles = make([]map[string]any, 0)
	}

	// The ohlc table only holds Kraken data, so other CEXes stay API-only.
	if cex == "kraken" {
		candles = backfillOHLCFromDB(r.Context(), candles, fiatCurrency, hours, intervalMin)
	}

	writeJSON(w, map[string]any{
		"candles":       candles,
		"fiat_currency": fiatCurrency,
		"interval_min":  intervalMin,
	})
}

type ohlcRow struct {
	time                   time.Time
	open, high, low, close float64
}

// backfillOHLCFromDB prepends candles aggregated from the stored 1-min Kraken
// data for the part of the requested window that the exchange API did not
// cover. API candles stay authoritative for their own range.
func backfillOHLCFromDB(ctx context.Context, apiCandles []map[string]any, fiatCurrency string, hours int, intervalMin int) []map[string]any {
	if db == nil {
		return apiCandles
	}
	if hours > maxOHLCBackfillHours {
		hours = maxOHLCBackfillHours
	}
	windowStart := time.Now().UTC().Add(-time.Duration(hours) * time.Hour)

	// Oldest candle the API delivered; everything older comes from the DB.
	apiOldest := time.Now().UTC()
	if len(apiCandles) > 0 {
		if t, ok := apiCandles[0]["time"].(string); ok {
			if parsed, err := time.Parse(ohlcCandleTimeLayout, t); err == nil {
				apiOldest = parsed
			}
		}
	}
	if !apiOldest.After(windowStart) {
		return apiCandles
	}

	rows, err := db.QueryContext(ctx,
		rebind("SELECT time, open, high, low, close FROM ohlc WHERE fiat_currency = ? AND time >= ? AND time < ? ORDER BY time"),
		fiatCurrency, windowStart, apiOldest,
	)
	if err != nil {
		fmt.Printf("[OHLC] backfill query error: %v\n", err)
		return apiCandles
	}
	defer rows.Close()

	var dbRows []ohlcRow
	for rows.Next() {
		var row ohlcRow
		if err := rows.Scan(&row.time, &row.open, &row.high, &row.low, &row.close); err != nil {
			fmt.Printf("[OHLC] backfill scan error: %v\n", err)
			return apiCandles
		}
		dbRows = append(dbRows, row)
	}
	if err := rows.Err(); err != nil {
		fmt.Printf("[OHLC] backfill rows error: %v\n", err)
		return apiCandles
	}
	if len(dbRows) == 0 {
		return apiCandles
	}

	// Buckets are epoch-floored like the API's; the bucket containing the API's
	// oldest candle is excluded so the merged series has no duplicate time.
	intervalSec := int64(intervalMin) * 60
	cutoffBucket := apiOldest.Unix() / intervalSec * intervalSec
	backfill := aggregateOHLCRows(dbRows, intervalMin, cutoffBucket)
	return append(backfill, apiCandles...)
}

// aggregateOHLCRows rolls 1-min rows up into intervalMin buckets, dropping any
// bucket starting at or after cutoffBucketStart (unix seconds).
func aggregateOHLCRows(dbRows []ohlcRow, intervalMin int, cutoffBucketStart int64) []map[string]any {
	intervalSec := int64(intervalMin) * 60
	candles := make([]map[string]any, 0, len(dbRows)/intervalMin+1)
	var bucketStart int64 = -1
	var cur ohlcRow
	flush := func() {
		if bucketStart < 0 {
			return
		}
		candles = append(candles, map[string]any{
			"time":  time.Unix(bucketStart, 0).UTC().Format(ohlcCandleTimeLayout),
			"open":  cur.open,
			"high":  cur.high,
			"low":   cur.low,
			"close": cur.close,
		})
	}
	for _, row := range dbRows {
		b := row.time.Unix() / intervalSec * intervalSec
		if b >= cutoffBucketStart {
			break
		}
		if b != bucketStart {
			flush()
			bucketStart = b
			cur = row
			continue
		}
		cur.high = max(cur.high, row.high)
		cur.low = min(cur.low, row.low)
		cur.close = row.close
	}
	flush()
	return candles
}

func handlePaymentMethodGroups(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	if pmService == nil {
		json.NewEncoder(w).Encode(map[string]any{"groups": []any{}})
		return
	}
	json.NewEncoder(w).Encode(map[string]any{"groups": pmService.GetGroups()})
}

// handleTradingPaymentMethods serves the payment-methods catalog list used by
// the categorization panel and Accounts Management payment-account linking.
func handleTradingPaymentMethods(w http.ResponseWriter, r *http.Request) {
	rows, err := pmRepo.List(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, map[string]any{"payment_methods": rows})
}

// handleTradingPaymentMethodByID updates or deletes one catalog row. After a
// successful update the grouping cache refreshes immediately so category and
// merge-regex edits apply without waiting for the hourly refresh.
func handleTradingPaymentMethodByID(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodPut:
		var payload paymentmethods.UpdatePayload
		if err := decodeJSON(r, &payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := pmRepo.Update(r.Context(), int64(id), payload); err != nil {
			writeRepoError(w, err)
			return
		}
		if pmService != nil {
			if err := pmService.RefreshNow(); err != nil {
				slog.Warn("payment method groups refresh after update failed", "err", err)
			}
		}
		rows, err := pmRepo.List(r.Context())
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, map[string]any{"payment_methods": rows})
	case http.MethodDelete:
		if err := pmRepo.Delete(r.Context(), int64(id)); err != nil {
			writeRepoError(w, err)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleTradingPaymentMethodDegradeToAlias atomically moves one payment-method
// name into another provider's alias list and removes the source catalog row.
func handleTradingPaymentMethodDegradeToAlias(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	providerID, err := pathID(r, "provider_id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := pmRepo.DegradeToAlias(r.Context(), int64(id), int64(providerID)); err != nil {
		writeRepoError(w, err)
		return
	}
	if pmService != nil {
		if err := pmService.RefreshNow(); err != nil {
			slog.Warn("payment method groups refresh after alias degradation failed", "err", err)
		}
	}
	rows, err := pmRepo.List(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, map[string]any{"payment_methods": rows})
}

func handleTradingPaymentMethodPromoteAlias(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var payload struct {
		Alias string `json:"alias"`
	}
	if err := decodeJSON(r, &payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := pmRepo.PromoteAlias(r.Context(), int64(id), payload.Alias); err != nil {
		writeRepoError(w, err)
		return
	}
	if pmService != nil {
		if err := pmService.RefreshNow(); err != nil {
			slog.Warn("payment method groups refresh after alias promotion failed", "err", err)
		}
	}
	rows, err := pmRepo.List(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, map[string]any{"payment_methods": rows})
}

// handleTradingPaymentMethodChatTemplates serves the chat templates for one
// payment method. The panel uses this to populate the per-exchange editors.
func handleTradingPaymentMethodChatTemplates(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	rows, err := pmRepo.ListChatTemplates(r.Context(), int64(id))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, map[string]any{"chat_templates": rows})
}

// handleTradingPaymentMethodChatTemplateByExchange creates, updates, or deletes
// the chat template for one payment method / exchange pair.
func handleTradingPaymentMethodChatTemplateByExchange(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	exchange := r.PathValue("exchange")
	direction := r.URL.Query().Get("trade_direction")
	switch r.Method {
	case http.MethodPut:
		var payload paymentmethods.ChatTemplatePayload
		if err := decodeJSON(r, &payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := pmRepo.UpsertChatTemplate(r.Context(), int64(id), exchange, payload); err != nil {
			writeRepoError(w, err)
			return
		}
		rows, err := pmRepo.ListChatTemplates(r.Context(), int64(id))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, map[string]any{"chat_templates": rows})
	case http.MethodDelete:
		if err := pmRepo.DeleteChatTemplate(r.Context(), int64(id), exchange, direction); err != nil {
			writeRepoError(w, err)
			return
		}
		writeJSON(w, map[string]any{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleTradingWalletAddresses serves the wallet_addresses list
// (read-only; dexMmController owns writes).
func handleTradingWalletAddresses(w http.ResponseWriter, r *http.Request) {
	rows, err := pmRepo.ListWalletAddresses(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, map[string]any{"wallet_addresses": rows})
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

func handleMmControllerTransactions(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/transactions")
}

func handleMmControllerDexPendingLiquidity(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/transactions/dex-pending-liquidity")
}

func handleMmControllerTransactionByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if strings.TrimSpace(id) == "" {
		http.Error(w, "missing transaction id", http.StatusBadRequest)
		return
	}
	forwardMMControllerJSON(w, r, "/api/transactions/"+url.PathEscape(id))
}

func handleMmControllerLNDWallet(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/lnd/wallet")
}

func handleMmControllerLNDWalletState(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/lnd/wallet/state")
}

func handleMmControllerServiceVersions(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/service-versions")
}

func handleMmControllerLNDWalletInit(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/lnd/wallet/init")
}

func handleMmControllerLNDCreateAddress(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/lnd/addresses")
}

func handleMmControllerLNDChannelPresets(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/lnd/channel-presets")
}

func handleMmControllerLNDOpenChannel(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/lnd/channels/open")
}

func handleMmControllerLNDCloseChannel(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/lnd/channels/close")
}

func handleMmControllerLSPChannel(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/lnd/lsp-channel")
}
func handleMmControllerLSPChannelStatus(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/lnd/lsp-channel/status")
}
func handleMmControllerLSPChannelCandidates(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/lnd/lsp-channel/candidates")
}

func handleMmControllerMagmaLSPInfo(w http.ResponseWriter, r *http.Request) {
	path := "/api/lnd/lsp-channel/magma/info"
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	forwardMMControllerJSON(w, r, path)
}

func handleMmControllerMagmaOffers(w http.ResponseWriter, r *http.Request) {
	path := "/api/lnd/lsp-channel/magma/offers"
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	forwardMMControllerJSON(w, r, path)
}

func handleMmControllerMagmaLSPOrders(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/lnd/lsp-channel/magma/orders")
}

func handleMmControllerMagmaLSPOrderByID(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		http.Error(w, "missing order id", http.StatusBadRequest)
		return
	}
	forwardMMControllerJSON(w, r, "/api/lnd/lsp-channel/magma/orders/"+url.PathEscape(id))
}

func handleMmControllerMagmaLSPOrderPay(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		http.Error(w, "missing order id", http.StatusBadRequest)
		return
	}
	forwardMMControllerJSON(w, r, "/api/lnd/lsp-channel/magma/orders/"+url.PathEscape(id)+"/pay")
}

func handleMmControllerSubmarineSwaps(w http.ResponseWriter, r *http.Request) {
	path := "/api/lnd/submarine-swaps"
	if r.URL.RawQuery != "" {
		path += "?" + r.URL.RawQuery
	}
	forwardMMControllerJSON(w, r, path)
}

func handleMmControllerCexPreTradeCheck(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/cex/pre-trade-check")
}

// handleMmControllerBisqPaymentAccounts proxies GET (list) and POST (create) of the bisq1
// daemon's own payment-account profile to dexMmController, which owns the bisq gRPC client.
func handleMmControllerBisqPaymentAccounts(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/bisq/payment-accounts")
}

// handleMmControllerBisqPaymentMethods proxies the daemon-backed supported fiat methods.
func handleMmControllerBisqPaymentMethods(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/bisq/payment-methods")
}

// handleMmControllerBisqPaymentMethodForm proxies one daemon-generated dynamic account form.
func handleMmControllerBisqPaymentMethodForm(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimSpace(r.PathValue("id"))
	if id == "" {
		http.Error(w, "missing payment method id", http.StatusBadRequest)
		return
	}
	forwardMMControllerJSON(w, r, "/api/bisq/payment-methods/"+url.PathEscape(id)+"/form")
}

// handleMmControllerBisqPaymentAccountByID proxies DELETE of a bisq payment account by id.
func handleMmControllerBisqPaymentAccountByID(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if strings.TrimSpace(id) == "" {
		http.Error(w, "missing payment account id", http.StatusBadRequest)
		return
	}
	forwardMMControllerJSON(w, r, "/api/bisq/payment-accounts/"+url.PathEscape(id))
}

// handleMmControllerBisqWalletBalances proxies the bisq1 wallet balance summary.
func handleMmControllerBisqWalletBalances(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/bisq/wallet/balances")
}

// handleMmControllerBisqWalletAddresses proxies the bisq1 wallet funding addresses.
func handleMmControllerBisqWalletAddresses(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/bisq/wallet/addresses")
}

// handleMmControllerBisqWalletTransactions proxies the bisq1 wallet transaction history.
func handleMmControllerBisqWalletTransactions(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/bisq/wallet/transactions")
}

// handleMmControllerBisqWalletWithdraw proxies bisq1 wallet BTC withdrawals.
func handleMmControllerBisqWalletWithdraw(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/bisq/wallet/withdraw")
}

// handleMmControllerBisqWalletUnlock proxies unlocking an encrypted bisq1 wallet.
func handleMmControllerBisqWalletUnlock(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/bisq/wallet/unlock")
}

// handleMmControllerTelegramConfig proxies GET/PUT of the shared Telegram bot
// configuration (token, chat_id, per-service webhook URLs) to dexMmController.
func handleMmControllerTelegramConfig(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/telegram/config")
}

func handleMmControllerTransactionalLiquidity(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/transactional-liquidity")
}

// handleMmControllerTelegramSetWebhook proxies POST set-webhook?service=dexmm|pushpush.
func handleMmControllerTelegramSetWebhook(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/telegram/set-webhook")
}

// handleMmControllerTelegramPair proxies creation of a short-lived Telegram QR pairing link.
func handleMmControllerTelegramPair(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/telegram/pair")
}

// handleMmControllerTelegramTest proxies POST test?service=dexmm|pushpush to send a
// one-way test message to the configured chat.
func handleMmControllerTelegramTest(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/telegram/test")
}

// phonePushSetup is intentionally free of credentials so it can be refreshed
// by the Communication Hub without ever putting deployment secrets in normal
// API responses or QR payloads.
type phonePushSetup struct {
	NotifyURL                     string                 `json:"notify_url"`
	HeartbeatURL                  string                 `json:"heartbeat_url"`
	NotifyCredentialConfigured    bool                   `json:"notify_credential_configured"`
	HeartbeatCredentialConfigured bool                   `json:"heartbeat_credential_configured"`
	Online                        bool                   `json:"online"`
	DeviceID                      string                 `json:"device_id"`
	LastSeen                      string                 `json:"last_seen"`
	MaxAgeSeconds                 int64                  `json:"max_age_seconds"`
	HeartbeatStatusError          string                 `json:"heartbeat_status_error,omitempty"`
	CallbackHistory               []phoneCallbackAttempt `json:"callback_history"`
	CallbackHistoryError          string                 `json:"callback_history_error,omitempty"`
}

type phoneCallbackAttempt struct {
	ReceivedAt time.Time `json:"received_at"`
	Endpoint   string    `json:"endpoint"`
	Outcome    string    `json:"outcome"`
	StatusCode int       `json:"status_code"`
	DeviceID   string    `json:"device_id,omitempty"`
	App        string    `json:"app,omitempty"`
	Detail     string    `json:"detail,omitempty"`
}

func phonePushPublicBaseURL(r *http.Request) string {
	scheme := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if scheme != "http" && scheme != "https" {
		if r.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}
	return fmt.Sprintf("%s://%s", scheme, r.Host)
}

func phonePushSetupMetadata(r *http.Request) phonePushSetup {
	ctx := r.Context()
	publicBaseURL := phonePushPublicBaseURL(r)
	setup := phonePushSetup{
		NotifyURL:                     fmt.Sprintf("%s/pushpush/notify", publicBaseURL),
		HeartbeatURL:                  fmt.Sprintf("%s/pushpush/phone-heartbeat", publicBaseURL),
		NotifyCredentialConfigured:    pushpushNotifySecret != "",
		HeartbeatCredentialConfigured: pushpushNotifySecret != "",
		MaxAgeSeconds:                 int64(pushpushHeartbeatMaxAge.Seconds()),
	}
	if pushpushNotifySecret == "" {
		setup.HeartbeatStatusError = "Heartbeat credential is not configured. Public callbacks are disabled."
		return setup
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fiatControllerURL+"/phone-heartbeat", nil)
	if err != nil {
		setup.HeartbeatStatusError = "Could not prepare heartbeat status request"
		return setup
	}
	req.Header.Set("X-Webhook-Secret", pushpushNotifySecret)
	client := &http.Client{Timeout: 5 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		setup.HeartbeatStatusError = "Fiat Controller heartbeat status is unavailable"
		return setup
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		setup.HeartbeatStatusError = "Fiat Controller rejected the heartbeat status request"
		return setup
	}
	var status struct {
		Online        bool      `json:"online"`
		DeviceID      string    `json:"device_id"`
		LastSeen      time.Time `json:"last_seen"`
		MaxAgeSeconds int64     `json:"max_age_seconds"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 16<<10)).Decode(&status); err != nil {
		setup.HeartbeatStatusError = "Fiat Controller returned an invalid heartbeat status"
		return setup
	}
	setup.Online, setup.DeviceID, setup.MaxAgeSeconds = status.Online, status.DeviceID, status.MaxAgeSeconds
	if !status.LastSeen.IsZero() {
		setup.LastSeen = status.LastSeen.UTC().Format(time.RFC3339)
	}
	setup.CallbackHistory, setup.CallbackHistoryError = phonePushCallbackHistory(ctx)
	return setup
}

func phonePushCallbackHistory(ctx context.Context) ([]phoneCallbackAttempt, string) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fiatControllerURL+"/phone-callback-history?limit=50", nil)
	if err != nil {
		return nil, "Could not prepare callback history request"
	}
	req.Header.Set("X-Webhook-Secret", pushpushNotifySecret)
	res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return nil, "Callback history is unavailable"
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, "Fiat Controller rejected the callback history request"
	}
	var payload struct {
		Attempts []phoneCallbackAttempt `json:"attempts"`
	}
	if err := json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&payload); err != nil {
		return nil, "Fiat Controller returned invalid callback history"
	}
	return payload.Attempts, ""
}

func handlePhonePushSetup(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, phonePushSetupMetadata(r))
}

// handlePhonePushSetupReveal deliberately requires the authenticated /api
// session gate and is the only dashboard endpoint that returns these secrets.
func handlePhonePushSetupReveal(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]string{
		"shared_secret": pushpushNotifySecret,
	})
}

func handleMmControllerCexTradeflow(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/cex/tradeflow")
}

func handleMmControllerCexWithdrawalTrack(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerJSON(w, r, "/api/cex/withdrawal-track")
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	if !coreTablesReady() {
		w.Header().Set("Content-Type", "application/json")
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
type tradingBankAccount = tradingaccounts.BankAccount
type tradingBankAccountPayload = tradingaccounts.BankAccountPayload

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
			writeRepoError(w, err)
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
			writeRepoError(w, err)
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

func handleTradingAccountPriorities(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		AccountIDs []int64 `json:"account_ids"`
	}
	if err := decodeJSON(r, &payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if err := tradingAccounts().ReorderPaymentAccounts(r.Context(), payload.AccountIDs); err != nil {
		writeRepoError(w, err)
		return
	}
	writeJSON(w, map[string]bool{"ok": true})
}

func handleTradingAccountCredentials(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	reveal, err := tradingAccounts().RevealCredentials(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, reveal)
}

func handleTradingAccountSecrets(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	account, err := tradingAccounts().RevealAccountSecrets(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, account)
}

func handleTradingAccountBisqAccountFile(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	fileName, contents, err := tradingAccounts().LatestBisqAccountFile(r.Context(), id)
	if errors.Is(err, sql.ErrNoRows) {
		http.Error(w, "No Bisq account file backup is available for this account.", http.StatusNotFound)
		return
	}
	if err != nil {
		writeError(w, err)
		return
	}
	// A fixed filename prevents a stored name from injecting response headers.
	if fileName == "" || strings.ContainsAny(fileName, "\\r\\n") {
		fileName = "UserPayload"
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", fileName))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Length", strconv.Itoa(len(contents)))
	_, _ = w.Write(contents)
}

// handleTradingAccountBisqDataDirectory streams a portable Bisq 1 data-folder
// archive. dexmonitor only receives the named volume as a read-only mount.
func handleTradingAccountBisqDataDirectory(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	account, err := loadTradingAccountByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			http.Error(w, "account not found", http.StatusNotFound)
			return
		}
		writeError(w, err)
		return
	}
	if !strings.EqualFold(strings.TrimSpace(account.Provider), "Bisq") {
		http.Error(w, "data-directory download is only available for the Bisq account", http.StatusBadRequest)
		return
	}

	dataDir := strings.TrimSpace(os.Getenv("BISQ_APP_DATA_DIR"))
	if dataDir == "" {
		dataDir = "/bisq-data"
	}
	if _, err := os.Stat(dataDir); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			http.Error(w, "Bisq data directory is not mounted", http.StatusServiceUnavailable)
			return
		}
		writeError(w, err)
		return
	}

	w.Header().Set("Content-Disposition", `attachment; filename="Bisq-data.tar.gz"`)
	w.Header().Set("Content-Type", "application/gzip")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if err := writeBisqDataArchive(w, dataDir); err != nil {
		slog.Error("stream Bisq data-directory archive", "err", err)
	}
}

func writeBisqDataArchive(dst io.Writer, dataDir string) error {
	gzipWriter := gzip.NewWriter(dst)
	defer gzipWriter.Close()
	tarWriter := tar.NewWriter(gzipWriter)
	defer tarWriter.Close()

	return filepath.WalkDir(dataDir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		relativePath, err := filepath.Rel(dataDir, path)
		if err != nil {
			return err
		}
		archivePath := "Bisq"
		if relativePath != "." {
			archivePath += "/" + filepath.ToSlash(relativePath)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		header.Name = archivePath
		if info.IsDir() {
			header.Name += "/"
		}
		if err := tarWriter.WriteHeader(header); err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		file, err := os.Open(path)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(tarWriter, file)
		closeErr := file.Close()
		if copyErr != nil {
			return copyErr
		}
		return closeErr
	})
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

// The loadTrading* helpers mask all stored secret material (passwords, TOTP
// secrets, seed phrases, API secrets, passkey private keys) before it leaves
// the repository: every HTTP response path goes through them, and no caller
// needs the cleartext (trading flows read credentials server-side from the
// DB). Updates that echo the mask back keep the stored value unchanged.
func loadTradingAccounts(ctx context.Context) ([]tradingAccount, error) {
	accs, err := tradingAccounts().List(ctx)
	tradingaccounts.MaskAccounts(accs)
	return accs, err
}

func loadTradingAccountByID(ctx context.Context, id int64) (*tradingAccount, error) {
	account, err := tradingAccounts().Get(ctx, id)
	tradingaccounts.MaskAccount(account)
	return account, err
}

func createTradingAccount(ctx context.Context, payload tradingAccountPayload) (int64, error) {
	return tradingAccounts().Create(ctx, payload)
}

func updateTradingAccount(ctx context.Context, id int64, payload tradingAccountPayload) error {
	return tradingAccounts().Update(ctx, id, payload)
}

func loadTradingTOTPSecretByID(ctx context.Context, id int64) (*tradingTOTPSecret, error) {
	row, err := tradingAccounts().GetTOTPSecret(ctx, id)
	tradingaccounts.MaskTOTPSecret(row)
	return row, err
}

func loadTradingPasskeyByID(ctx context.Context, id int64) (*tradingPasskey, error) {
	row, err := tradingAccounts().GetPasskey(ctx, id)
	tradingaccounts.MaskPasskey(row)
	return row, err
}

func loadTradingSeedByID(ctx context.Context, id int64) (*tradingSeed, error) {
	row, err := tradingAccounts().GetSeed(ctx, id)
	tradingaccounts.MaskSeed(row)
	return row, err
}

func loadTradingAPIKeyByID(ctx context.Context, id int64) (*tradingAPIKey, error) {
	row, err := tradingAccounts().GetAPIKey(ctx, id)
	tradingaccounts.MaskAPIKey(row)
	return row, err
}

func handleTradingAccountBankAccounts(w http.ResponseWriter, r *http.Request) {
	accountID, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	var payload tradingBankAccountPayload
	if err := decodeJSON(r, &payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	id, err := tradingAccounts().CreateBankAccount(r.Context(), accountID, payload)
	if err != nil {
		writeRepoError(w, err)
		return
	}
	row, err := loadTradingBankAccountByID(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, row)
}

func handleTradingBankAccountByID(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	switch r.Method {
	case http.MethodPut:
		var payload tradingBankAccountPayload
		if err := decodeJSON(r, &payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if err := tradingAccounts().UpdateBankAccount(r.Context(), id, payload); err != nil {
			writeRepoError(w, err)
			return
		}
		row, err := loadTradingBankAccountByID(r.Context(), id)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, row)
	case http.MethodDelete:
		if err := tradingAccounts().DeleteBankAccount(r.Context(), id); err != nil {
			writeError(w, err)
			return
		}
		writeJSON(w, map[string]bool{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func loadTradingBankAccountByID(ctx context.Context, id int64) (*tradingBankAccount, error) {
	return tradingAccounts().GetBankAccount(ctx, id)
}

// maxJSONBodyBytes bounds request bodies so a client can't stream an unbounded
// payload into memory before decoding.
const maxJSONBodyBytes = 1 << 20 // 1 MiB

func decodeJSON(r *http.Request, dest any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxJSONBodyBytes))
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
		"id":                            int64(offerFloat(o, "id")),
		"exchange":                      offerString(o, "exchange"),
		"direction":                     offerString(o, "direction"),
		"price":                         offerFloatPtr(o, "price"),
		"price_diff_percent":            offerFloatPtr(o, "price_diff_percent"),
		"btc_min":                       offerFloatPtr(o, "btc_min"),
		"btc_max":                       offerFloatPtr(o, "btc_max"),
		"fiat_min":                      offerInt64Ptr(o, "fiat_min"),
		"fiat_max":                      offerInt64Ptr(o, "fiat_max"),
		"payment_methods":               offerStringSlice(o, "payment_methods"),
		"offer_id":                      offerStringPtr(o, "offer_id"),
		"first_seen":                    nilIfEmpty(offerString(o, "first_seen")),
		"last_seen":                     nilIfEmpty(offerString(o, "last_seen")),
		"is_live":                       offerBool(o, "is_live"),
		"duration":                      offerInt64Ptr(o, "duration"),
		"historical_analysis_status":    nilIfEmpty(offerString(o, "historical_analysis_status")),
		"avg_ref_price":                 offerFloatPtr(o, "avg_ref_price"),
		"avg_premium_pct":               offerFloatPtr(o, "avg_premium_pct"),
		"avg_trade_cost_pct":            offerFloatPtr(o, "avg_trade_cost_pct"),
		"avg_trade_cost_btc":            offerFloatPtr(o, "avg_trade_cost_btc"),
		"avg_hedge_fee_sum_btc":         offerFloatPtr(o, "avg_hedge_fee_sum_btc"),
		"cex_taker_fee_btc":             offerFloatPtr(o, "cex_taker_fee_btc"),
		"cex_withdraw_fee_btc":          offerFloatPtr(o, "cex_withdraw_fee_btc"),
		"routing_fee_sum":               offerFloatPtr(o, "routing_fee_sum"),
		"routing_fee_detail":            offerRawJSON(o, "routing_fee_detail"),
		"hedge_open_fee_btc":            offerFloatPtr(o, "hedge_open_fee_btc"),
		"hedge_close_fee_btc":           offerFloatPtr(o, "hedge_close_fee_btc"),
		"hedge_funding_fee_btc":         offerFloatPtr(o, "hedge_funding_fee_btc"),
		"hedge_fee_sum_btc":             offerFloatPtr(o, "hedge_fee_sum_btc"),
		"hedge_venue":                   offerStringPtr(o, "hedge_venue"),
		"hedge_instrument":              offerStringPtr(o, "hedge_instrument"),
		"hedge_transfer_minutes":        offerInt64Ptr(o, "hedge_transfer_minutes"),
		"dex_fee_btc":                   offerFloatPtr(o, "dex_fee_btc"),
		"avg_net_premium_pct":           offerFloatPtr(o, "avg_net_premium_pct"),
		"avg_estimated_profit_btc":      offerFloatPtr(o, "avg_estimated_profit_btc"),
		"avg_estimated_profit_fiat":     offerFloatPtr(o, "avg_estimated_profit_fiat"),
		"avg_btc_amount":                offerFloatPtr(o, "avg_btc_amount"),
		"avg_min_trade_cost_pct":        offerFloatPtr(o, "avg_min_trade_cost_pct"),
		"avg_min_trade_cost_btc":        offerFloatPtr(o, "avg_min_trade_cost_btc"),
		"avg_min_net_premium_pct":       offerFloatPtr(o, "avg_min_net_premium_pct"),
		"avg_min_estimated_profit_btc":  offerFloatPtr(o, "avg_min_estimated_profit_btc"),
		"avg_min_estimated_profit_fiat": offerFloatPtr(o, "avg_min_estimated_profit_fiat"),
		"avg_min_btc_amount":            offerFloatPtr(o, "avg_min_btc_amount"),
		"min_volume_analyzed":           offerBool(o, "min_volume_analyzed"),
		"price_type":                    nilIfEmpty(offerString(o, "price_type")),
		"best_route_cex":                nilIfEmpty(offerString(o, "best_route_cex")),
		"routing_profile":               nilIfEmpty(offerString(o, "routing_profile")),
		"seller_rating_score":           offerFloatPtrPreserveZero(o, "seller_rating_score"),
		"seller_rating_confidence":      nilIfEmpty(offerString(o, "seller_rating_confidence")),
		"seller_rating_raw":             offerRawJSON(o, "seller_rating_raw"),
	}
}

// offerFloatPtrPreserveZero returns a *float64 that is nil only when the column
// is SQL NULL (a nil entry in the scanned row), preserving a genuine 0 — unlike
// offerFloatPtr, which treats 0 as absent. Needed for seller_rating_score, where
// 0 (a banned / zero-reputation maker) is a real score distinct from "no rating".
func offerFloatPtrPreserveZero(o map[string]any, key string) *float64 {
	if o[key] == nil {
		return nil
	}
	v := offerFloat(o, key)
	return &v
}

// offerRawJSON passes a JSONB column through as embedded JSON, or nil when
// absent/empty, so seller_rating_raw is nested rather than string-escaped.
func offerRawJSON(o map[string]any, key string) any {
	switch v := o[key].(type) {
	case []byte:
		if len(v) == 0 {
			return nil
		}
		return json.RawMessage(v)
	case string:
		if v == "" {
			return nil
		}
		return json.RawMessage(v)
	default:
		return nil
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

func nonZeroFloat(value, fallback float64) float64 {
	if value != 0 {
		return value
	}
	return fallback
}

func nonEmptyString(value, fallback string) string {
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

// queryFiat reads the selected fiat currency. Invalid or missing values retain
// the historic EUR default rather than accidentally querying a different pair.
func queryFiat(r *http.Request) string {
	if currency, ok := fiat.Normalize(r.URL.Query().Get("fiat")); ok {
		return currency
	}
	return "EUR"
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

// queryLegacyExcludedCEXes reads the compatibility exclusion that applies to
// both legs. New callers should use the leg-specific query fields.
func queryLegacyExcludedCEXes(r *http.Request) []string {
	return queryCEXList(r, "exclude_cexes")
}

// queryExcludedCEXes returns the conservative union used by legacy endpoints.
func queryExcludedCEXes(r *http.Request) []string {
	spot, hedge := effectiveRequestCEXExclusions(r)
	return mergeCEXLists(spot, hedge)
}

func queryExcludedSpotCEXes(r *http.Request) []string {
	return mergeCEXLists(queryLegacyExcludedCEXes(r), queryCEXList(r, "exclude_spot_cexes"))
}

func queryExcludedHedgeCEXes(r *http.Request) []string {
	return mergeCEXLists(queryLegacyExcludedCEXes(r), queryCEXList(r, "exclude_hedge_cexes"))
}

func authoritativeCEXExclusions(ctx context.Context) (spot, hedge []string) {
	var store *mmcapabilities.Store
	if db != nil {
		// Tests replace the package-level DB between cases; a fresh lightweight
		// store avoids retaining a closed handle. Production still shares sql.DB's
		// connection pool and performs the same two small reads.
		store = mmcapabilities.NewStore(db, capabilityMaxAge)
	}
	if store == nil {
		all := mmcapabilities.CostSupportedProviderIDs()
		return all, append([]string(nil), all...)
	}
	states, err := store.States(ctx)
	if err != nil {
		if strings.HasSuffix(os.Args[0], ".test") || strings.HasSuffix(os.Args[0], ".test.exe") {
			return nil, nil
		}
		slog.ErrorContext(ctx, "load MM CEX policy; routing fail-closed", "err", err)
		all := mmcapabilities.CostSupportedProviderIDs()
		return all, append([]string(nil), all...)
	}
	return mmcapabilities.EffectiveExclusions(states)
}

func effectiveRequestCEXExclusions(r *http.Request) (spot, hedge []string) {
	policySpot, policyHedge := authoritativeCEXExclusions(r.Context())
	return mergeCEXLists(queryExcludedSpotCEXes(r), policySpot),
		mergeCEXLists(queryExcludedHedgeCEXes(r), policyHedge)
}

func queryCEXList(r *http.Request, key string) []string {
	return normalizeCEXList(r.URL.Query()[key])
}

func normalizeCEXList(values []string) []string {
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

func mergeCEXLists(lists ...[]string) []string {
	seen := make(map[string]struct{})
	result := make([]string, 0)
	for _, list := range lists {
		for _, cex := range list {
			cex = strings.TrimSpace(strings.ToLower(cex))
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
	case string(takerOpportunityModeNetMin):
		return takerOpportunityModeNetMin
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

// offerHasExcludedPaymentMethod reports whether any of an offer's payment
// methods is in the excluded set. Offers carry payment_methods as a TEXT[]
// (migration 20260629 replaced the scalar payment_method column), so callers
// must match against every element rather than a single scalar field.
func offerHasExcludedPaymentMethod(o map[string]any, excluded []string) bool {
	if len(excluded) == 0 {
		return false
	}
	for _, method := range offerStringSlice(o, "payment_methods") {
		if isPaymentMethodExcluded(method, excluded) {
			return true
		}
	}
	return false
}

func offerRoutingSettlement(o map[string]any) string {
	return offerString(o, "routing_profile")
}

func offerJSONBytes(o map[string]any, key string) []byte {
	switch v := o[key].(type) {
	case nil:
		return nil
	case []byte:
		return v
	case string:
		return []byte(v)
	case json.RawMessage:
		return []byte(v)
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return nil
		}
		return b
	}
}

// pastRoutingFees reads persisted routing_fee_sum / routing_fee_detail.
// Without detail (historical rows), the sum is treated as on-chain-only.
func pastRoutingFees(o map[string]any) (profile, method string, onchainBTC, sumBTC float64, numTxs int, conversion tradecost.ConversionBreakdown, detail *tradecost.BTCNetworkFeeDetail) {
	profile = offerString(o, "routing_profile")
	method = tradecost.MethodForProfile(profile)
	sumBTC = offerFloat(o, "routing_fee_sum")
	onchainBTC = sumBTC
	d, err := tradecost.UnmarshalRoutingFeeDetail(offerJSONBytes(o, "routing_fee_detail"))
	if err != nil {
		return profile, method, onchainBTC, sumBTC, numTxs, conversion, detail
	}
	hasDetail := d.NumOnchainTxs > 0 || d.OnchainFeeBTC > 0 || d.ConversionFeeBTC > 0 || len(d.Legs) > 0 || d.Conversion != nil || d.Onchain != nil
	if !hasDetail {
		return profile, method, onchainBTC, sumBTC, numTxs, conversion, detail
	}
	onchainBTC = d.OnchainFeeBTC
	numTxs = d.NumOnchainTxs
	detail = d.Onchain
	if d.Conversion != nil {
		conversion = *d.Conversion
	}
	if sumBTC == 0 {
		sumBTC = tradecost.Round8(d.OnchainFeeBTC + d.ConversionFeeBTC)
	}
	return profile, method, onchainBTC, sumBTC, numTxs, conversion, detail
}

func routingFeeSumBTC(rep tradecost.CostBreakdown) float64 {
	if rep.RoutingFeeSumBTC > 0 {
		return rep.RoutingFeeSumBTC
	}
	return tradecost.RoutingFeeSumBTC(rep)
}

func routingFeeSumPct(rep tradecost.CostBreakdown) float64 {
	if rep.RoutingFeeSumPct > 0 {
		return rep.RoutingFeeSumPct
	}
	if rep.BTCAmount <= 0 {
		return 0
	}
	return tradecost.Round4(routingFeeSumBTC(rep) / rep.BTCAmount * 100)
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

func offerStringSlice(o map[string]any, key string) []string {
	switch v := o[key].(type) {
	case []string:
		return v
	case []any:
		out := make([]string, 0, len(v))
		for _, e := range v {
			if s, ok := e.(string); ok {
				out = append(out, s)
			}
		}
		return out
	case string:
		if v != "" {
			return parsePGTextArray(v)
		}
		return nil
	default:
		return nil
	}
}

// parsePGTextArray parses a Postgres text[] literal such as
// `{SEPA,"SEPA Instant",Wise}` into its elements. The pgx stdlib driver
// returns array columns in this raw literal form when scanned into a plain
// `any` (as scanOffers does for every column) rather than parsing them into
// a []string, so offerStringSlice needs to do that parsing itself. Strings
// that aren't in `{...}` form (e.g. test fixtures using a plain column
// value) are returned as a single element, unchanged from before.
func parsePGTextArray(raw string) []string {
	if len(raw) < 2 || raw[0] != '{' || raw[len(raw)-1] != '}' {
		return []string{raw}
	}
	body := raw[1 : len(raw)-1]
	if body == "" {
		return nil
	}
	out := make([]string, 0, strings.Count(body, ",")+1)
	var cur strings.Builder
	inQuotes := false
	for i := 0; i < len(body); i++ {
		ch := body[i]
		if inQuotes {
			if ch == '\\' && i+1 < len(body) {
				i++
				cur.WriteByte(body[i])
				continue
			}
			if ch == '"' {
				inQuotes = false
				continue
			}
			cur.WriteByte(ch)
			continue
		}
		switch ch {
		case '"':
			inQuotes = true
		case ',':
			out = append(out, cur.String())
			cur.Reset()
		default:
			cur.WriteByte(ch)
		}
	}
	out = append(out, cur.String())
	return out
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
		mmProxy = mmproxy.New(mmControllerAPIURL).WithInternalSecret(mmInternalSecret)
	}
	mmProxy.ForwardJSON(w, r, path)
}

func forwardMMControllerWebSocket(w http.ResponseWriter, r *http.Request, path string) {
	if mmProxy == nil {
		mmProxy = mmproxy.New(mmControllerAPIURL).WithInternalSecret(mmInternalSecret)
	}
	mmProxy.ForwardWebSocket(w, r, path)
}

// handleMmControllerHedgeStreamWS relays the live hedge-position WebSocket stream from
// mm-controller to the browser, carrying through the ?venue= query parameter.
func handleMmControllerHedgeStreamWS(w http.ResponseWriter, r *http.Request) {
	forwardMMControllerWebSocket(w, r, "/ws/cex/hedge-stream")
}

func writeJSON(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, err error) {
	// Log the real error server-side but return a generic message: raw err.Error()
	// can carry DB/driver internals (table names, connection strings, SQL state).
	slog.Error("request failed", "err", err)
	http.Error(w, "internal server error", http.StatusInternalServerError)
}

// writeRepoError distinguishes rejected user input from internal failures:
// a tradingaccounts.ValidationError is safe to show verbatim as a 400,
// everything else falls back to writeError's generic 500.
func writeRepoError(w http.ResponseWriter, err error) {
	var verr tradingaccounts.ValidationError
	if errors.As(err, &verr) {
		http.Error(w, verr.Error(), http.StatusBadRequest)
		return
	}
	var pmErr paymentmethods.ValidationError
	if errors.As(err, &pmErr) {
		http.Error(w, pmErr.Error(), http.StatusBadRequest)
		return
	}
	writeError(w, err)
}
