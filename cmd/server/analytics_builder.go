package main

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"commons/tradecost"
	"dexmonitor/internal/pastorders"
)

const analyticsResultCacheTTL = 10 * time.Minute

const (
	analyticsSectionOverview        = "overview"
	analyticsSectionTakerStatsFull  = "taker_stats_full"
	analyticsSectionTakerStats      = "taker_stats"
	analyticsSectionTakerOrdersFull = "taker_orders_full"
	analyticsSectionTakerOrders     = "taker_orders"
)

var analyticsResultCache struct {
	sync.Mutex
	entries  map[string]analyticsResultCacheEntry
	inFlight map[string][]*analyticsInFlightEntry
}

type analyticsResultCacheEntry struct {
	response        dashboardAnalyticsResponse
	expiry          time.Time
	builtOverview   bool
	builtStatsFull  bool
	builtStats      bool
	builtOrdersFull bool
	builtOrders     bool
}

type analyticsBuildTimings struct {
	cacheHit          bool
	waitedOnInFlight  bool
	selfBuilt         bool
	waitInFlightMs    float64
	loadContextMs     float64
	buildOverviewMs   float64
	buildStatsFullMs  float64
	buildStatsMs      float64
	lifecycleAggMs    float64
	buildOrdersFullMs float64
	buildOrdersMs     float64
}

type analyticsBuildPlan struct {
	overview   bool
	statsFull  bool
	stats      bool
	ordersFull bool
	orders     bool
}

type analyticsInFlightEntry struct {
	plan analyticsBuildPlan
	done chan struct{}
	err  error
}

type analyticsOfferDerived struct {
	id             int64
	paymentMethods []string
	firstSeenRaw   string
	lastSeenRaw    string
	firstSeen      time.Time
	lastSeen       time.Time
	fullTradeSize  float64
	excluded       bool
}

// cappedNetPremium estimates the capped-volume net premium once from the
// offer's whole-life averages (agg) rather than replaying every historical
// tick in order_lifecycle — see buildPastOfferAPI's capped scenario for the
// same approach.
func cappedNetPremium(o map[string]any, agg pastLifecycleAggregate, fullTradeSizeBTC, maxFiatLimitEUR float64) float64 {
	if maxFiatLimitEUR <= 0 || fullTradeSizeBTC <= 0 {
		return 0
	}
	avgRefPrice := agg.AvgRefPrice
	if avgRefPrice <= 0 {
		avgRefPrice = offerRefPrice(o)
	}
	if avgRefPrice <= 0 {
		return 0
	}
	btcCap := maxFiatLimitEUR / avgRefPrice
	if btcCap <= 0 || fullTradeSizeBTC <= btcCap {
		return 0
	}
	avgPremiumPercent := agg.AvgPremiumPercent
	if avgPremiumPercent == 0 {
		avgPremiumPercent = tradecost.Round4(offerFloat(o, "avg_premium_pct"))
	}
	bd := buildCappedPastBreakdown(o, fullTradeSizeBTC, btcCap, avgRefPrice, avgPremiumPercent,
		agg.AvgHedgeNotionalEUR, agg.AvgLeverageUsed, agg.AvgRecommendedCollateral)
	return bd.EstimatedProfitPct
}

type analyticsBuildContext struct {
	params            dashboardAnalyticsParams
	generalCtx        generalStatsContext
	closedOffers      []map[string]any
	closedIDs         []int64
	lifecycleAggCache map[int64]pastLifecycleAggregate
	aggByID           map[int64]pastLifecycleAggregate
	analysisByID      map[int64]pastOfferAnalysis
	derivedByID       map[int64]analyticsOfferDerived
	timings           *analyticsBuildTimings
}

// resolvedAggs returns per-offer lifecycle aggregates, preferring the
// analyzer-persisted offer-row columns and querying order_lifecycle only for
// offers without persisted values — so steady-state builds need no lifecycle
// SQL at all.
func (bc *analyticsBuildContext) resolvedAggs() map[int64]pastLifecycleAggregate {
	if bc.aggByID != nil {
		return bc.aggByID
	}
	start := time.Now()
	bc.aggByID = resolveAggsForOffers(bc.closedOffers)
	if bc.timings != nil {
		bc.timings.lifecycleAggMs = float64(time.Since(start).Microseconds()) / 1000
	}
	return bc.aggByID
}

// lifecycleAgg lazily fetches the whole-life lifecycle averages for
// closedOffers. Building the "full volume" orders/section needs none of
// this (it only reads the offer row's own persisted avg_* columns), so
// callers that don't touch capped/premium math never pay for this query.
func (bc *analyticsBuildContext) lifecycleAgg() map[int64]pastLifecycleAggregate {
	if bc.lifecycleAggCache == nil {
		start := time.Now()
		bc.lifecycleAggCache = fetchPastOfferLifecycleAggregates(bc.closedIDs)
		if bc.timings != nil {
			bc.timings.lifecycleAggMs = float64(time.Since(start).Microseconds()) / 1000
		}
	}
	return bc.lifecycleAggCache
}

func (bc *analyticsBuildContext) derivedOffer(o map[string]any) analyticsOfferDerived {
	id := int64(offerFloat(o, "id"))
	if bc.derivedByID == nil {
		bc.derivedByID = make(map[int64]analyticsOfferDerived, len(bc.closedOffers))
	}
	if derived, ok := bc.derivedByID[id]; ok {
		return derived
	}
	firstSeenRaw := offerString(o, "first_seen")
	lastSeenRaw := offerString(o, "last_seen")
	var btcMaxPtr, btcMinPtr *float64
	if v := offerFloat(o, "btc_max"); v > 0 {
		btcMaxPtr = &v
	}
	if v := offerFloat(o, "btc_min"); v > 0 {
		btcMinPtr = &v
	}
	derived := analyticsOfferDerived{
		id:             id,
		paymentMethods: offerStringSlice(o, "payment_methods"),
		firstSeenRaw:   firstSeenRaw,
		lastSeenRaw:    lastSeenRaw,
		firstSeen:      parseDBTime(firstSeenRaw),
		lastSeen:       parseDBTime(lastSeenRaw),
		fullTradeSize:  selectBTCTradeSize(btcMaxPtr, btcMinPtr),
		excluded:       offerHasExcludedPaymentMethod(o, bc.params.ExcludePaymentMethods),
	}
	bc.derivedByID[id] = derived
	return derived
}

// offerAnalyses computes each closed offer's cost/profit analysis once and
// caches it, so buildTakerStatsOnly and buildTakerOrdersOnly (which iterate
// the same closedOffers) don't each redo the same per-offer math.
func (bc *analyticsBuildContext) offerAnalyses() map[int64]pastOfferAnalysis {
	if bc.analysisByID != nil {
		return bc.analysisByID
	}
	agg := bc.resolvedAggs()
	result := make(map[int64]pastOfferAnalysis, len(bc.closedOffers))
	for _, o := range bc.closedOffers {
		id := int64(offerFloat(o, "id"))
		result[id] = addPastOfferCostFieldsFull(
			o,
			agg[id],
			bc.params.Confirmations,
			bc.params.ExcludeCEXes,
			bc.params.FeeTier,
			bc.params.MaxFiatLimitEUR,
		)
	}
	bc.analysisByID = result
	return result
}

type takerAnalyticsResult struct {
	statsAllFull        pastorders.StatsResponse
	statsFilteredFull   pastorders.StatsResponse
	statsAllCapped      pastorders.StatsResponse
	statsFilteredCapped pastorders.StatsResponse
	statsAllMin         pastorders.StatsResponse
	statsFilteredMin    pastorders.StatsResponse
}

func (p dashboardAnalyticsParams) wantsSection(section string) bool {
	if len(p.Sections) == 0 {
		return true
	}
	for _, s := range p.Sections {
		if s == section {
			return true
		}
	}
	return false
}

func (p dashboardAnalyticsParams) analyticsResultCacheKey() string {
	return p.cacheKey()
}

func filterDashboardAnalyticsResponse(full dashboardAnalyticsResponse, p dashboardAnalyticsParams) dashboardAnalyticsResponse {
	if len(p.Sections) == 0 {
		return full
	}
	filtered := dashboardAnalyticsResponse{}
	if p.wantsSection(analyticsSectionOverview) {
		filtered.GeneralStatsOverview = full.GeneralStatsOverview
		filtered.PastPremiums = full.PastPremiums
		filtered.PremiumLifetimes = full.PremiumLifetimes
	}
	if p.wantsSection(analyticsSectionTakerStatsFull) || p.wantsSection(analyticsSectionTakerStats) {
		filtered.PastOrderStatsAll = full.PastOrderStatsAll
		filtered.PastOrderStats = full.PastOrderStats
	}
	if p.wantsSection(analyticsSectionTakerStats) {
		filtered.PastOrderStatsAllNetCapped = full.PastOrderStatsAllNetCapped
		filtered.PastOrderStatsNetCapped = full.PastOrderStatsNetCapped
		filtered.PastOrderStatsAllNetMin = full.PastOrderStatsAllNetMin
		filtered.PastOrderStatsNetMin = full.PastOrderStatsNetMin
	}
	if p.wantsSection(analyticsSectionTakerOrdersFull) {
		filtered.PastProfitableOrdersCompact = full.PastProfitableOrdersCompact
	}
	if p.wantsSection(analyticsSectionTakerOrders) {
		filtered.PastProfitableOrders = full.PastProfitableOrders
	}
	return filtered
}

// cloneOfferMap shallow-copies an offer row. addPastOfferCostFieldsFull
// writes derived fields (ref_price, cost_breakdown, ...) back onto the map
// it's given; offers here come from generalStatsCache, a 30s cache shared
// across concurrent requests, so mutating the cached map in place is a data
// race (fatal "concurrent map read and map write" — hit this once two
// analytics requests for the same params run in parallel). Each request
// gets its own copy to mutate instead.
func cloneOfferMap(o map[string]any) map[string]any {
	clone := make(map[string]any, len(o))
	for k, v := range o {
		clone[k] = v
	}
	return clone
}

// filterClosedAnalyzedOffers derives the closed/analyzed offer set from
// an already-loaded, cached offer list instead of issuing a second "SELECT *
// FROM offers" query — generalCtx.offers already covers at least 168h and is
// ordered by last_seen DESC (see loadGeneralStatsContextUncachedForParams).
// Each returned offer is a private clone (see cloneOfferMap) since callers
// mutate it.
func filterClosedAnalyzedOffers(offers []map[string]any, p dashboardAnalyticsParams) []map[string]any {
	cutoff := time.Now().Add(-168 * time.Hour)
	result := make([]map[string]any, 0, len(offers))
	for _, o := range offers {
		if offerBool(o, "is_live") {
			continue
		}
		if offerString(o, "historical_analysis_status") != "analyzed" {
			continue
		}
		lastSeen := parseDBTime(offerString(o, "last_seen"))
		if (!p.hasCustomPastRange() && lastSeen.Before(cutoff)) ||
			(p.hasCustomPastRange() && (lastSeen.Before(p.pastRangeStart) || !lastSeen.Before(p.pastRangeEnd))) {
			continue
		}
		result = append(result, cloneOfferMap(o))
	}
	return result
}

func loadAnalyticsBuildContext(p dashboardAnalyticsParams) (*analyticsBuildContext, error) {
	generalCtx, err := loadGeneralStatsContextForParams(p)
	if err != nil {
		return nil, err
	}

	closedOffers := filterClosedAnalyzedOffers(generalCtx.offers, p)

	closedIDs := make([]int64, 0, len(closedOffers))
	for _, o := range closedOffers {
		closedIDs = append(closedIDs, int64(offerFloat(o, "id")))
	}

	return &analyticsBuildContext{
		params:       p,
		generalCtx:   generalCtx,
		closedOffers: closedOffers,
		closedIDs:    closedIDs,
	}, nil
}

func premiumOrderFromAnalysis(derived analyticsOfferDerived, analysis pastOfferAnalysis, mode takerOpportunityMode) pastorders.PremiumOrder {
	btcAmount, netProfitBTC := analysis.valuesForMode(mode)
	return pastorders.PremiumOrder{
		PaymentMethods:      derived.paymentMethods,
		LastSeen:            derived.lastSeen,
		BTCAmount:           btcAmount,
		NetProfitBTC:        netProfitBTC,
		NetProfitFiat:       netProfitBTC * analysis.refPrice,
		BTCAmountCapped:     analysis.btcSizeCapped,
		NetProfitBTCCapped:  analysis.estimatedProfitBTCCapped,
		NetProfitFiatCapped: analysis.estimatedProfitBTCCapped * analysis.refPrice,
		HasCap:              mode == takerOpportunityModeNetCapped && analysis.hasCap,
	}
}

// buildTakerStatsFullOnly derives full-volume stats from the persisted offer
// row only. It avoids the order_lifecycle aggregate query entirely so the
// frontend can render summary cards immediately from DB-backed fields.
func (bc *analyticsBuildContext) buildTakerStatsFullOnly() (pastorders.StatsResponse, pastorders.StatsResponse) {
	now := time.Now()
	hasExclusions := len(bc.params.ExcludePaymentMethods) > 0
	fullAll := make([]pastorders.PremiumOrder, 0, len(bc.closedOffers))
	fullFiltered := make([]pastorders.PremiumOrder, 0, len(bc.closedOffers))

	for _, o := range bc.closedOffers {
		derived := bc.derivedOffer(o)
		analysis := addPastOfferCostFieldsFull(o, pastLifecycleAggregate{}, bc.params.Confirmations, bc.params.ExcludeCEXes, bc.params.FeeTier, 0)
		if !analysis.profitableInMode(takerOpportunityModeNetFull) {
			continue
		}
		po := premiumOrderFromAnalysis(derived, analysis, takerOpportunityModeNetFull)
		fullAll = append(fullAll, po)
		if !hasExclusions || !derived.excluded {
			fullFiltered = append(fullFiltered, po)
		}
	}

	excludedMethods := []string(nil)
	if hasExclusions {
		excludedMethods = bc.params.ExcludePaymentMethods
	}

	return pastorders.BuildStats(fullAll, now, bc.params.Fiat, nil), pastorders.BuildStats(fullFiltered, now, bc.params.Fiat, excludedMethods)
}

func (bc *analyticsBuildContext) buildTakerStatsOnly() takerAnalyticsResult {
	now := time.Now()
	hasExclusions := len(bc.params.ExcludePaymentMethods) > 0
	analyses := bc.offerAnalyses()

	fullAll := make([]pastorders.PremiumOrder, 0, len(bc.closedOffers))
	fullFiltered := make([]pastorders.PremiumOrder, 0, len(bc.closedOffers))
	cappedAll := make([]pastorders.PremiumOrder, 0, len(bc.closedOffers))
	cappedFiltered := make([]pastorders.PremiumOrder, 0, len(bc.closedOffers))
	minAll := make([]pastorders.PremiumOrder, 0, len(bc.closedOffers))
	minFiltered := make([]pastorders.PremiumOrder, 0, len(bc.closedOffers))

	for _, o := range bc.closedOffers {
		derived := bc.derivedOffer(o)
		analysis := analyses[derived.id]
		excluded := hasExclusions && derived.excluded

		if analysis.profitableInMode(takerOpportunityModeNetFull) {
			po := premiumOrderFromAnalysis(derived, analysis, takerOpportunityModeNetFull)
			fullAll = append(fullAll, po)
			if !excluded {
				fullFiltered = append(fullFiltered, po)
			}
		}
		if analysis.profitableInMode(takerOpportunityModeNetCapped) {
			po := premiumOrderFromAnalysis(derived, analysis, takerOpportunityModeNetCapped)
			cappedAll = append(cappedAll, po)
			if !excluded {
				cappedFiltered = append(cappedFiltered, po)
			}
		}
		if analysis.profitableInMode(takerOpportunityModeNetMin) {
			po := premiumOrderFromAnalysis(derived, analysis, takerOpportunityModeNetMin)
			minAll = append(minAll, po)
			if !excluded {
				minFiltered = append(minFiltered, po)
			}
		}
	}

	excludedMethods := []string(nil)
	if hasExclusions {
		excludedMethods = bc.params.ExcludePaymentMethods
	}

	return takerAnalyticsResult{
		statsAllFull:        pastorders.BuildStats(fullAll, now, bc.params.Fiat, nil),
		statsFilteredFull:   pastorders.BuildStats(fullFiltered, now, bc.params.Fiat, excludedMethods),
		statsAllCapped:      pastorders.BuildStats(cappedAll, now, bc.params.Fiat, nil),
		statsFilteredCapped: pastorders.BuildStats(cappedFiltered, now, bc.params.Fiat, excludedMethods),
		statsAllMin:         pastorders.BuildStats(minAll, now, bc.params.Fiat, nil),
		statsFilteredMin:    pastorders.BuildStats(minFiltered, now, bc.params.Fiat, excludedMethods),
	}
}

func (bc *analyticsBuildContext) buildTakerOrdersOnly() []pastProfitableOrderAPI {
	analyses := bc.offerAnalyses()
	agg := bc.resolvedAggs()
	orders := make([]pastProfitableOrderAPI, 0, len(bc.closedOffers))

	for _, o := range bc.closedOffers {
		derived := bc.derivedOffer(o)
		analysis := analyses[derived.id]
		if !analysis.profitableInMode(takerOpportunityModeNetFull) && !analysis.profitableInMode(takerOpportunityModeNetCapped) && !analysis.profitableInMode(takerOpportunityModeNetMin) {
			continue
		}
		orders = append(orders, buildPastProfitableOrderAPI(
			o,
			analysis,
			agg[derived.id],
			bc.params.Confirmations,
			bc.params.ExcludeCEXes,
			bc.params.FeeTier,
			bc.params.MaxFiatLimitEUR,
			takerOpportunityModeNetFull,
		))
	}
	return orders
}

// buildTakerOrdersFullOnly renders the full-volume order list without the
// order_lifecycle aggregate query (or the capped-volume calc, which needs
// it): every field it uses lives on the offer row already fetched for the
// overview/stats pass. This lets the frontend paint the table immediately,
// while the capped-aware buildTakerOrdersOnly result (which does need the
// aggregate query) fills in afterward — see the taker_orders_full section.
func (bc *analyticsBuildContext) buildTakerOrdersFullOnly() []pastProfitableOrderCompactAPI {
	orders := make([]pastProfitableOrderCompactAPI, 0, len(bc.closedOffers))
	for _, o := range bc.closedOffers {
		analysis := addPastOfferCostFieldsFull(o, pastLifecycleAggregate{}, bc.params.Confirmations, bc.params.ExcludeCEXes, bc.params.FeeTier, 0)
		if !analysis.profitableInMode(takerOpportunityModeNetFull) {
			continue
		}
		orders = append(orders, buildPastProfitableOrderCompactAPI(o, analysis))
	}
	return orders
}

func (bc *analyticsBuildContext) applyOverviewSections(resp *dashboardAnalyticsResponse, p dashboardAnalyticsParams) {
	resp.GeneralStatsOverview = bc.generalCtx.overview()
	resp.PastPremiums, resp.PremiumLifetimes = buildPastPremiumAndLifetimeStats(
		bc.generalCtx.offers,
		bc.resolvedAggs(),
		bc.generalCtx.now,
		bc.generalCtx.excludedPaymentMethods,
		p.MaxFiatLimitEUR,
		p.Confirmations,
		p.ExcludeCEXes,
		p.FeeTier,
	)
}

func (bc *analyticsBuildContext) applyTakerStatsSections(resp *dashboardAnalyticsResponse) {
	taker := bc.buildTakerStatsOnly()
	resp.PastOrderStatsAll = taker.statsAllFull
	resp.PastOrderStats = taker.statsFilteredFull
	resp.PastOrderStatsAllNetCapped = taker.statsAllCapped
	resp.PastOrderStatsNetCapped = taker.statsFilteredCapped
	resp.PastOrderStatsAllNetMin = taker.statsAllMin
	resp.PastOrderStatsNetMin = taker.statsFilteredMin
}

func (bc *analyticsBuildContext) applyTakerStatsFullSection(resp *dashboardAnalyticsResponse) {
	resp.PastOrderStatsAll, resp.PastOrderStats = bc.buildTakerStatsFullOnly()
}

func (bc *analyticsBuildContext) applyTakerOrdersFullSection(resp *dashboardAnalyticsResponse) {
	resp.PastProfitableOrdersCompact = bc.buildTakerOrdersFullOnly()
}

func (bc *analyticsBuildContext) applyTakerOrdersSection(resp *dashboardAnalyticsResponse) {
	resp.PastProfitableOrders = bc.buildTakerOrdersOnly()
}

func (p dashboardAnalyticsParams) needsOverviewBuild() bool {
	return len(p.Sections) == 0 || p.wantsSection(analyticsSectionOverview)
}

func (p dashboardAnalyticsParams) needsStatsBuild() bool {
	return len(p.Sections) == 0 || p.wantsSection(analyticsSectionTakerStats)
}

// needsStatsFullBuild reports whether the fast, full-volume-only stats
// section was requested. A completed capped-aware stats build supersedes it.
func (p dashboardAnalyticsParams) needsStatsFullBuild() bool {
	return len(p.Sections) == 0 || p.wantsSection(analyticsSectionTakerStatsFull)
}

// needsOrdersFullBuild reports whether the fast, full-volume-only orders
// section was requested. A completed capped-aware build (builtOrders)
// already supersedes it, so callers should treat that as satisfying this
// too — see analyticsSectionsSatisfied.
func (p dashboardAnalyticsParams) needsOrdersFullBuild() bool {
	return len(p.Sections) == 0 || p.wantsSection(analyticsSectionTakerOrdersFull)
}

func (p dashboardAnalyticsParams) needsOrdersBuild() bool {
	return len(p.Sections) == 0 || p.wantsSection(analyticsSectionTakerOrders)
}

func analyticsSectionsSatisfied(p dashboardAnalyticsParams, entry analyticsResultCacheEntry) bool {
	if p.needsOverviewBuild() && !entry.builtOverview {
		return false
	}
	if p.needsStatsFullBuild() && !entry.builtStatsFull && !entry.builtStats {
		return false
	}
	if p.needsStatsBuild() && !entry.builtStats {
		return false
	}
	// builtOrders does NOT satisfy ordersFull: the capped orders build fills
	// PastProfitableOrders only, never PastProfitableOrdersCompact.
	if p.needsOrdersFullBuild() && !entry.builtOrdersFull {
		return false
	}
	if p.needsOrdersBuild() && !entry.builtOrders {
		return false
	}
	return true
}

// planCoversSections reports whether waiting on an in-flight build with this
// plan would satisfy every section the request needs. Unlike
// analyticsSectionsSatisfied, an in-flight capped build (stats/orders) only
// counts toward its fast variant (statsFull/ordersFull) when the request needs
// the capped section anyway: the capped build can take many seconds (it
// aggregates order_lifecycle), while a fast section builds in milliseconds, so
// a fast-only request must self-build rather than queue behind it.
func planCoversSections(p dashboardAnalyticsParams, plan analyticsBuildPlan) bool {
	if p.needsOverviewBuild() && !plan.overview {
		return false
	}
	if p.needsStatsFullBuild() && !plan.statsFull && !(plan.stats && p.needsStatsBuild()) {
		return false
	}
	if p.needsStatsBuild() && !plan.stats {
		return false
	}
	if p.needsOrdersFullBuild() && !plan.ordersFull {
		return false
	}
	if p.needsOrdersBuild() && !plan.orders {
		return false
	}
	return true
}

// overlayBuiltSections copies the sections this plan built from src into dst
// and marks them built. Concurrent builds for the same cache key finish in any
// order (a fast section build races the multi-second capped build), so each
// writer must overlay only what it produced onto the latest cached entry
// instead of replacing the entry wholesale from its own stale snapshot.
func (p analyticsBuildPlan) overlayBuiltSections(dst *analyticsResultCacheEntry, src dashboardAnalyticsResponse) {
	if p.overview {
		dst.response.GeneralStatsOverview = src.GeneralStatsOverview
		dst.response.PastPremiums = src.PastPremiums
		dst.response.PremiumLifetimes = src.PremiumLifetimes
		dst.builtOverview = true
	}
	if p.statsFull || p.stats {
		dst.response.PastOrderStatsAll = src.PastOrderStatsAll
		dst.response.PastOrderStats = src.PastOrderStats
		dst.builtStatsFull = true
	}
	if p.stats {
		dst.response.PastOrderStatsAllNetCapped = src.PastOrderStatsAllNetCapped
		dst.response.PastOrderStatsNetCapped = src.PastOrderStatsNetCapped
		dst.response.PastOrderStatsAllNetMin = src.PastOrderStatsAllNetMin
		dst.response.PastOrderStatsNetMin = src.PastOrderStatsNetMin
		dst.builtStats = true
	}
	if p.ordersFull {
		dst.response.PastProfitableOrdersCompact = src.PastProfitableOrdersCompact
		dst.builtOrdersFull = true
	}
	if p.orders {
		dst.response.PastProfitableOrders = src.PastProfitableOrders
		dst.builtOrders = true
	}
}

func (p analyticsBuildPlan) isEmpty() bool {
	return !p.overview && !p.statsFull && !p.stats && !p.ordersFull && !p.orders
}

func analyticsMissingBuildPlan(p dashboardAnalyticsParams, entry analyticsResultCacheEntry) analyticsBuildPlan {
	needOverview := p.needsOverviewBuild() && !entry.builtOverview
	needStats := p.needsStatsBuild() && !entry.builtStats
	needStatsFull := p.needsStatsFullBuild() && !entry.builtStatsFull && !entry.builtStats && !needStats
	needOrders := p.needsOrdersBuild() && !entry.builtOrders
	needOrdersFull := p.needsOrdersFullBuild() && !entry.builtOrdersFull
	return analyticsBuildPlan{
		overview:   needOverview,
		statsFull:  needStatsFull,
		stats:      needStats,
		ordersFull: needOrdersFull,
		orders:     needOrders,
	}
}

func writeAnalyticsServerTiming(w http.ResponseWriter, timings analyticsBuildTimings) {
	w.Header().Add("Server-Timing", fmt.Sprintf(
		"cache;desc=\"hit=%t\", inflight;desc=\"waited=%t,self=%t\";dur=%.1f, ctx;dur=%.1f, overview;dur=%.1f, statsFull;dur=%.1f, stats;dur=%.1f, lifecycle;dur=%.1f, ordersFull;dur=%.1f, orders;dur=%.1f",
		timings.cacheHit,
		timings.waitedOnInFlight,
		timings.selfBuilt,
		timings.waitInFlightMs,
		timings.loadContextMs,
		timings.buildOverviewMs,
		timings.buildStatsFullMs,
		timings.buildStatsMs,
		timings.lifecycleAggMs,
		timings.buildOrdersFullMs,
		timings.buildOrdersMs,
	))
}

func buildDashboardAnalyticsResponse(p dashboardAnalyticsParams) (dashboardAnalyticsResponse, analyticsBuildTimings, error) {
	timings := analyticsBuildTimings{}
	cacheKey := p.analyticsResultCacheKey()
	for {
		now := time.Now()
		analyticsResultCache.Lock()
		entry, cached := analyticsResultCache.entries[cacheKey]
		if cached && now.Before(entry.expiry) && analyticsSectionsSatisfied(p, entry) {
			resp := filterDashboardAnalyticsResponse(entry.response, p)
			analyticsResultCache.Unlock()
			timings.cacheHit = true
			return resp, timings, nil
		}

		merged := dashboardAnalyticsResponse{}
		current := analyticsResultCacheEntry{}
		if cached && now.Before(entry.expiry) {
			merged = entry.response
			current = entry
		}
		plan := analyticsMissingBuildPlan(p, current)
		if plan.isEmpty() {
			analyticsResultCache.Unlock()
			timings.cacheHit = true
			return filterDashboardAnalyticsResponse(merged, p), timings, nil
		}

		waited := false
		for _, inflight := range analyticsResultCache.inFlight[cacheKey] {
			if planCoversSections(p, inflight.plan) {
				analyticsResultCache.Unlock()
				waitStart := time.Now()
				<-inflight.done
				timings.waitedOnInFlight = true
				timings.waitInFlightMs += float64(time.Since(waitStart).Microseconds()) / 1000
				if inflight.err != nil {
					return dashboardAnalyticsResponse{}, timings, inflight.err
				}
				waited = true
				break
			}
		}
		if waited {
			continue
		}

		if analyticsResultCache.inFlight == nil {
			analyticsResultCache.inFlight = make(map[string][]*analyticsInFlightEntry)
		}
		inflight := &analyticsInFlightEntry{plan: plan, done: make(chan struct{})}
		analyticsResultCache.inFlight[cacheKey] = append(analyticsResultCache.inFlight[cacheKey], inflight)
		analyticsResultCache.Unlock()

		timings.selfBuilt = true
		ctxStart := time.Now()
		bc, err := loadAnalyticsBuildContext(p)
		if err != nil {
			inflight.err = err
		} else {
			bc.timings = &timings
			timings.loadContextMs = float64(time.Since(ctxStart).Microseconds()) / 1000

			if plan.overview {
				start := time.Now()
				bc.applyOverviewSections(&merged, p)
				timings.buildOverviewMs = float64(time.Since(start).Microseconds()) / 1000
			}
			if plan.statsFull {
				start := time.Now()
				bc.applyTakerStatsFullSection(&merged)
				timings.buildStatsFullMs = float64(time.Since(start).Microseconds()) / 1000
			}
			if plan.stats {
				start := time.Now()
				bc.applyTakerStatsSections(&merged)
				timings.buildStatsMs = float64(time.Since(start).Microseconds()) / 1000
			}
			if plan.ordersFull {
				start := time.Now()
				bc.applyTakerOrdersFullSection(&merged)
				timings.buildOrdersFullMs = float64(time.Since(start).Microseconds()) / 1000
			}
			if plan.orders {
				start := time.Now()
				bc.applyTakerOrdersSection(&merged)
				timings.buildOrdersMs = float64(time.Since(start).Microseconds()) / 1000
			}

			analyticsResultCache.Lock()
			if analyticsResultCache.entries == nil {
				analyticsResultCache.entries = make(map[string]analyticsResultCacheEntry)
			}
			for k, e := range analyticsResultCache.entries {
				if !now.Before(e.expiry) {
					delete(analyticsResultCache.entries, k)
				}
			}
			final, ok := analyticsResultCache.entries[cacheKey]
			if !ok || !now.Before(final.expiry) {
				final = analyticsResultCacheEntry{}
			}
			plan.overlayBuiltSections(&final, merged)
			final.expiry = now.Add(analyticsResultCacheTTL)
			analyticsResultCache.entries[cacheKey] = final
			entries := analyticsResultCache.inFlight[cacheKey]
			for i, candidate := range entries {
				if candidate == inflight {
					analyticsResultCache.inFlight[cacheKey] = append(entries[:i], entries[i+1:]...)
					break
				}
			}
			if len(analyticsResultCache.inFlight[cacheKey]) == 0 {
				delete(analyticsResultCache.inFlight, cacheKey)
			}
			analyticsResultCache.Unlock()
		}

		if inflight.err != nil {
			analyticsResultCache.Lock()
			entries := analyticsResultCache.inFlight[cacheKey]
			for i, candidate := range entries {
				if candidate == inflight {
					analyticsResultCache.inFlight[cacheKey] = append(entries[:i], entries[i+1:]...)
					break
				}
			}
			if len(analyticsResultCache.inFlight[cacheKey]) == 0 {
				delete(analyticsResultCache.inFlight, cacheKey)
			}
			analyticsResultCache.Unlock()
			close(inflight.done)
			return dashboardAnalyticsResponse{}, timings, inflight.err
		}
		close(inflight.done)
		return filterDashboardAnalyticsResponse(merged, p), timings, nil
	}
}

type pastTakerQueryParams struct {
	ExcludePaymentMethods  []string
	ExcludeCEXes           []string
	FeeTier                string
	MaxFiatLimitEUR        float64
	Confirmations          int
	Fiat                   string
	PremiumMode            takerOpportunityMode
	ApplyPaymentExclusions bool
}

func pastTakerParamsFromRequest(r *http.Request) pastTakerQueryParams {
	excludedPaymentMethods := queryExcludedPaymentMethods(r)
	fiatCurrency := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("fiat")))
	if fiatCurrency == "" {
		fiatCurrency = "EUR"
	}
	return pastTakerQueryParams{
		ExcludePaymentMethods:  excludedPaymentMethods,
		ExcludeCEXes:           queryExcludedCEXes(r),
		FeeTier:                queryFeeTier(r),
		MaxFiatLimitEUR:        queryMaxFiatLimitEUR(r),
		Confirmations:          queryConfirmations(r),
		Fiat:                   fiatCurrency,
		PremiumMode:            queryTakerOpportunityMode(r),
		ApplyPaymentExclusions: len(excludedPaymentMethods) > 0,
	}
}

func loadPastTakerBuildContext(maxFiatLimitEUR float64) (*analyticsBuildContext, error) {
	closedOffers, err := loadClosedOffers168h()
	if err != nil {
		return nil, err
	}
	closedIDs := make([]int64, 0, len(closedOffers))
	for _, o := range closedOffers {
		closedIDs = append(closedIDs, int64(offerFloat(o, "id")))
	}
	return &analyticsBuildContext{
		closedOffers:      closedOffers,
		closedIDs:         closedIDs,
		lifecycleAggCache: resolveAggsForOffers(closedOffers),
	}, nil
}

func buildPastOrderStatsForQuery(p pastTakerQueryParams) (pastorders.StatsResponse, error) {
	bc, err := loadPastTakerBuildContext(p.MaxFiatLimitEUR)
	if err != nil {
		return pastorders.StatsResponse{}, err
	}

	now := time.Now()
	profitableOrders := make([]pastorders.PremiumOrder, 0, len(bc.closedOffers))
	for _, o := range bc.closedOffers {
		derived := bc.derivedOffer(o)
		if p.ApplyPaymentExclusions && derived.excluded {
			continue
		}
		analysis := addPastOfferCostFieldsFull(o, bc.lifecycleAgg()[derived.id], p.Confirmations, p.ExcludeCEXes, p.FeeTier, p.MaxFiatLimitEUR)
		if !analysis.profitableInMode(p.PremiumMode) {
			continue
		}
		profitableOrders = append(profitableOrders, premiumOrderFromAnalysis(derived, analysis, p.PremiumMode))
	}

	excluded := []string(nil)
	if p.ApplyPaymentExclusions {
		excluded = p.ExcludePaymentMethods
	}
	return pastorders.BuildStats(profitableOrders, now, p.Fiat, excluded), nil
}

func buildPastProfitableOrdersForQuery(p pastTakerQueryParams) ([]pastProfitableOrderAPI, error) {
	bc, err := loadPastTakerBuildContext(p.MaxFiatLimitEUR)
	if err != nil {
		return nil, err
	}

	result := make([]pastProfitableOrderAPI, 0, len(bc.closedOffers))
	for _, o := range bc.closedOffers {
		if p.ApplyPaymentExclusions && offerHasExcludedPaymentMethod(o, p.ExcludePaymentMethods) {
			continue
		}
		id := int64(offerFloat(o, "id"))
		agg := bc.lifecycleAgg()[id]
		analysis := addPastOfferCostFieldsFull(o, agg, p.Confirmations, p.ExcludeCEXes, p.FeeTier, p.MaxFiatLimitEUR)
		if !analysis.profitableInMode(p.PremiumMode) {
			continue
		}
		result = append(result, buildPastProfitableOrderAPI(
			o,
			analysis,
			agg,
			p.Confirmations,
			p.ExcludeCEXes,
			p.FeeTier,
			p.MaxFiatLimitEUR,
			p.PremiumMode,
		))
	}
	return result, nil
}
