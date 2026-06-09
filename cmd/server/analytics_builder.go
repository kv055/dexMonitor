package main

import (
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"dexmonitor/internal/pastorders"
)

const analyticsResultCacheTTL = 10 * time.Minute

const (
	analyticsSectionOverview   = "overview"
	analyticsSectionTakerStats = "taker_stats"
	analyticsSectionTakerOrders = "taker_orders"
)

var analyticsResultCache struct {
	sync.Mutex
	entries map[string]analyticsResultCacheEntry
}

type analyticsResultCacheEntry struct {
	response      dashboardAnalyticsResponse
	expiry        time.Time
	builtOverview bool
	builtStats    bool
	builtOrders   bool
}

type analyticsBuildTimings struct {
	cacheHit        bool
	loadContextMs   float64
	buildOverviewMs float64
	buildStatsMs    float64
	buildOrdersMs   float64
}

type cappedLifecycleAverages struct {
	tradeCostPct float64
	netPct       float64
	profitBTC    float64
	profitFiat   float64
	tradeCostBTC float64
	networkPct   float64
}

type cappedLifecycleMemo struct {
	maxFiatLimitEUR float64
	entries         map[int64]cappedLifecycleAverages
}

func newCappedLifecycleMemo(maxFiatLimitEUR float64) *cappedLifecycleMemo {
	if maxFiatLimitEUR <= 0 {
		return nil
	}
	return &cappedLifecycleMemo{
		maxFiatLimitEUR: maxFiatLimitEUR,
		entries:         make(map[int64]cappedLifecycleAverages),
	}
}

func (m *cappedLifecycleMemo) get(o map[string]any, agg pastLifecycleAggregate, fullBTCSize float64) cappedLifecycleAverages {
	id := int64(offerFloat(o, "id"))
	if cached, ok := m.entries[id]; ok {
		return cached
	}
	tc, net, pb, pf, tcb, np := recomputeCappedLifecycleAverages(o, agg.Samples, fullBTCSize, m.maxFiatLimitEUR)
	result := cappedLifecycleAverages{
		tradeCostPct: tc,
		netPct:       net,
		profitBTC:    pb,
		profitFiat:   pf,
		tradeCostBTC: tcb,
		networkPct:   np,
	}
	m.entries[id] = result
	return result
}

type pastAnalyticsOpts struct {
	cappedMemo *cappedLifecycleMemo
}

func cappedNetPremium(opts *pastAnalyticsOpts, o map[string]any, agg pastLifecycleAggregate, fullTradeSizeBTC, maxFiatLimitEUR float64) float64 {
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
	if opts != nil && opts.cappedMemo != nil {
		return opts.cappedMemo.get(o, agg, fullTradeSizeBTC).netPct
	}
	_, net, _, _, _, _ := recomputeCappedLifecycleAverages(o, agg.Samples, fullTradeSizeBTC, maxFiatLimitEUR)
	return net
}

type analyticsBuildContext struct {
	params       dashboardAnalyticsParams
	generalCtx   generalStatsContext
	closedOffers []map[string]any
	lifecycleAgg map[int64]pastLifecycleAggregate
	cappedMemo   *cappedLifecycleMemo
}

type takerAnalyticsResult struct {
	statsAllFull        pastorders.StatsResponse
	statsFilteredFull   pastorders.StatsResponse
	statsAllCapped      pastorders.StatsResponse
	statsFilteredCapped pastorders.StatsResponse
	orders              []pastProfitableOrderAPI
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
		filtered.OpenPremiums = full.OpenPremiums
		filtered.PastPremiums = full.PastPremiums
		filtered.PremiumLifetimes = full.PremiumLifetimes
	}
	if p.wantsSection(analyticsSectionTakerStats) {
		filtered.PastOrderStatsAll = full.PastOrderStatsAll
		filtered.PastOrderStats = full.PastOrderStats
		filtered.PastOrderStatsAllNetCapped = full.PastOrderStatsAllNetCapped
		filtered.PastOrderStatsNetCapped = full.PastOrderStatsNetCapped
	}
	if p.wantsSection(analyticsSectionTakerOrders) {
		filtered.PastProfitableOrders = full.PastProfitableOrders
	}
	return filtered
}

func loadAnalyticsBuildContext(p dashboardAnalyticsParams) (*analyticsBuildContext, error) {
	generalCtx, err := loadGeneralStatsContextForParams(p)
	if err != nil {
		return nil, err
	}

	closedOffers, err := loadClosedOffers168h()
	if err != nil {
		return nil, err
	}

	closedIDs := make([]int64, 0, len(closedOffers))
	for _, o := range closedOffers {
		closedIDs = append(closedIDs, int64(offerFloat(o, "id")))
	}

	lifecycleAgg := fetchPastOfferLifecycleAggregates(closedIDs)
	enrichLifecycleSamplesForCapped(lifecycleAgg, closedOffers, p.MaxFiatLimitEUR)

	return &analyticsBuildContext{
		params:       p,
		generalCtx:   generalCtx,
		closedOffers: closedOffers,
		lifecycleAgg: lifecycleAgg,
		cappedMemo:   newCappedLifecycleMemo(p.MaxFiatLimitEUR),
	}, nil
}

func premiumOrderFromAnalysis(o map[string]any, analysis pastOfferAnalysis, mode takerOpportunityMode) pastorders.PremiumOrder {
	btcAmount, netProfitBTC := analysis.valuesForMode(mode)
	return pastorders.PremiumOrder{
		PaymentMethod:       offerString(o, "payment_method"),
		LastSeen:            parseDBTime(offerString(o, "last_seen")),
		BTCAmount:           btcAmount,
		NetProfitBTC:        netProfitBTC,
		NetProfitFiat:       netProfitBTC * analysis.refPrice,
		BTCAmountCapped:     analysis.btcSizeCapped,
		NetProfitBTCCapped:  analysis.estimatedProfitBTCCapped,
		NetProfitFiatCapped: analysis.estimatedProfitBTCCapped * analysis.refPrice,
		HasCap:              mode == takerOpportunityModeNetCapped && analysis.hasCap,
	}
}

func (bc *analyticsBuildContext) buildTakerStatsOnly() takerAnalyticsResult {
	now := time.Now()
	hasExclusions := len(bc.params.ExcludePaymentMethods) > 0

	fullAll := make([]pastorders.PremiumOrder, 0, len(bc.closedOffers))
	fullFiltered := make([]pastorders.PremiumOrder, 0, len(bc.closedOffers))
	cappedAll := make([]pastorders.PremiumOrder, 0, len(bc.closedOffers))
	cappedFiltered := make([]pastorders.PremiumOrder, 0, len(bc.closedOffers))

	for _, o := range bc.closedOffers {
		analysis := addPastOfferCostFieldsFull(
			o,
			bc.params.Confirmations,
			bc.params.ExcludeCEXes,
			bc.params.FeeTier,
			bc.params.MaxFiatLimitEUR,
		)
		excluded := hasExclusions && isPaymentMethodExcluded(offerString(o, "payment_method"), bc.params.ExcludePaymentMethods)

		if analysis.profitableInMode(takerOpportunityModeNetFull) {
			po := premiumOrderFromAnalysis(o, analysis, takerOpportunityModeNetFull)
			fullAll = append(fullAll, po)
			if !excluded {
				fullFiltered = append(fullFiltered, po)
			}
		}
		if analysis.profitableInMode(takerOpportunityModeNetCapped) {
			po := premiumOrderFromAnalysis(o, analysis, takerOpportunityModeNetCapped)
			cappedAll = append(cappedAll, po)
			if !excluded {
				cappedFiltered = append(cappedFiltered, po)
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
	}
}

func (bc *analyticsBuildContext) buildTakerOrdersOnly() []pastProfitableOrderAPI {
	opts := &pastAnalyticsOpts{cappedMemo: bc.cappedMemo}
	orders := make([]pastProfitableOrderAPI, 0, len(bc.closedOffers))

	for _, o := range bc.closedOffers {
		analysis := addPastOfferCostFieldsFull(
			o,
			bc.params.Confirmations,
			bc.params.ExcludeCEXes,
			bc.params.FeeTier,
			bc.params.MaxFiatLimitEUR,
		)
		if !analysis.profitableInMode(takerOpportunityModeNetFull) && !analysis.profitableInMode(takerOpportunityModeNetCapped) {
			continue
		}
		id := int64(offerFloat(o, "id"))
		orders = append(orders, buildPastProfitableOrderAPI(
			o,
			bc.lifecycleAgg[id],
			bc.params.Confirmations,
			bc.params.ExcludeCEXes,
			bc.params.FeeTier,
			bc.params.MaxFiatLimitEUR,
			takerOpportunityModeNetFull,
			opts,
		))
	}
	return orders
}

func (bc *analyticsBuildContext) buildTakerAnalytics() takerAnalyticsResult {
	result := bc.buildTakerStatsOnly()
	result.orders = bc.buildTakerOrdersOnly()
	return result
}

func (bc *analyticsBuildContext) applyOverviewSections(resp *dashboardAnalyticsResponse, p dashboardAnalyticsParams) {
	opts := &pastAnalyticsOpts{cappedMemo: bc.cappedMemo}
	resp.GeneralStatsOverview = bc.generalCtx.overview()
	resp.OpenPremiums = bc.generalCtx.openPremiums()
	resp.PastPremiums, resp.PremiumLifetimes = buildPastPremiumAndLifetimeStats(
		bc.generalCtx.offers,
		bc.lifecycleAgg,
		bc.generalCtx.now,
		bc.generalCtx.excludedPaymentMethods,
		p.MaxFiatLimitEUR,
		p.Confirmations,
		p.ExcludeCEXes,
		p.FeeTier,
		opts,
	)
}

func (bc *analyticsBuildContext) applyTakerStatsSections(resp *dashboardAnalyticsResponse) {
	taker := bc.buildTakerStatsOnly()
	resp.PastOrderStatsAll = taker.statsAllFull
	resp.PastOrderStats = taker.statsFilteredFull
	resp.PastOrderStatsAllNetCapped = taker.statsAllCapped
	resp.PastOrderStatsNetCapped = taker.statsFilteredCapped
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

func (p dashboardAnalyticsParams) needsOrdersBuild() bool {
	return len(p.Sections) == 0 || p.wantsSection(analyticsSectionTakerOrders)
}

func analyticsSectionsSatisfied(p dashboardAnalyticsParams, entry analyticsResultCacheEntry) bool {
	if p.needsOverviewBuild() && !entry.builtOverview {
		return false
	}
	if p.needsStatsBuild() && !entry.builtStats {
		return false
	}
	if p.needsOrdersBuild() && !entry.builtOrders {
		return false
	}
	return true
}

func writeAnalyticsServerTiming(w http.ResponseWriter, timings analyticsBuildTimings) {
	w.Header().Add("Server-Timing", fmt.Sprintf(
		"cache;desc=\"hit=%t\", ctx;dur=%.1f, overview;dur=%.1f, stats;dur=%.1f, orders;dur=%.1f",
		timings.cacheHit,
		timings.loadContextMs,
		timings.buildOverviewMs,
		timings.buildStatsMs,
		timings.buildOrdersMs,
	))
}

func buildDashboardAnalyticsResponse(p dashboardAnalyticsParams) (dashboardAnalyticsResponse, analyticsBuildTimings, error) {
	timings := analyticsBuildTimings{}
	cacheKey := p.analyticsResultCacheKey()
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
	builtOverview := false
	builtStats := false
	builtOrders := false
	if cached && now.Before(entry.expiry) {
		merged = entry.response
		builtOverview = entry.builtOverview
		builtStats = entry.builtStats
		builtOrders = entry.builtOrders
	}
	analyticsResultCache.Unlock()

	needOverview := p.needsOverviewBuild() && !builtOverview
	needStats := p.needsStatsBuild() && !builtStats
	needOrders := p.needsOrdersBuild() && !builtOrders
	if !needOverview && !needStats && !needOrders {
		timings.cacheHit = true
		return filterDashboardAnalyticsResponse(merged, p), timings, nil
	}

	ctxStart := time.Now()
	bc, err := loadAnalyticsBuildContext(p)
	if err != nil {
		return dashboardAnalyticsResponse{}, timings, err
	}
	timings.loadContextMs = float64(time.Since(ctxStart).Microseconds()) / 1000

	if needOverview {
		start := time.Now()
		bc.applyOverviewSections(&merged, p)
		timings.buildOverviewMs = float64(time.Since(start).Microseconds()) / 1000
		builtOverview = true
	}
	if needStats {
		start := time.Now()
		bc.applyTakerStatsSections(&merged)
		timings.buildStatsMs = float64(time.Since(start).Microseconds()) / 1000
		builtStats = true
	}
	if needOrders {
		start := time.Now()
		bc.applyTakerOrdersSection(&merged)
		timings.buildOrdersMs = float64(time.Since(start).Microseconds()) / 1000
		builtOrders = true
	}

	analyticsResultCache.Lock()
	if analyticsResultCache.entries == nil {
		analyticsResultCache.entries = make(map[string]analyticsResultCacheEntry)
	}
	analyticsResultCache.entries[cacheKey] = analyticsResultCacheEntry{
		response:      merged,
		expiry:        now.Add(analyticsResultCacheTTL),
		builtOverview: builtOverview,
		builtStats:    builtStats,
		builtOrders:   builtOrders,
	}
	analyticsResultCache.Unlock()

	return filterDashboardAnalyticsResponse(merged, p), timings, nil
}

type pastTakerQueryParams struct {
	ExcludePaymentMethods []string
	ExcludeCEXes          []string
	FeeTier               string
	MaxFiatLimitEUR       float64
	Confirmations         int
	Fiat                  string
	PremiumMode           takerOpportunityMode
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
	lifecycleAgg := fetchPastOfferLifecycleAggregates(closedIDs)
	enrichLifecycleSamplesForCapped(lifecycleAgg, closedOffers, maxFiatLimitEUR)
	return &analyticsBuildContext{
		closedOffers: closedOffers,
		lifecycleAgg: lifecycleAgg,
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
		if p.ApplyPaymentExclusions && isPaymentMethodExcluded(offerString(o, "payment_method"), p.ExcludePaymentMethods) {
			continue
		}
		analysis := addPastOfferCostFieldsFull(o, p.Confirmations, p.ExcludeCEXes, p.FeeTier, p.MaxFiatLimitEUR)
		if !analysis.profitableInMode(p.PremiumMode) {
			continue
		}
		profitableOrders = append(profitableOrders, premiumOrderFromAnalysis(o, analysis, p.PremiumMode))
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
	opts := &pastAnalyticsOpts{cappedMemo: newCappedLifecycleMemo(p.MaxFiatLimitEUR)}

	result := make([]pastProfitableOrderAPI, 0, len(bc.closedOffers))
	for _, o := range bc.closedOffers {
		if p.ApplyPaymentExclusions && isPaymentMethodExcluded(offerString(o, "payment_method"), p.ExcludePaymentMethods) {
			continue
		}
		analysis := addPastOfferCostFieldsFull(o, p.Confirmations, p.ExcludeCEXes, p.FeeTier, p.MaxFiatLimitEUR)
		if !analysis.profitableInMode(p.PremiumMode) {
			continue
		}
		id := int64(offerFloat(o, "id"))
		result = append(result, buildPastProfitableOrderAPI(
			o,
			bc.lifecycleAgg[id],
			p.Confirmations,
			p.ExcludeCEXes,
			p.FeeTier,
			p.MaxFiatLimitEUR,
			p.PremiumMode,
			opts,
		))
	}
	return result, nil
}

func logLargeCappedSampleLoad(needIDs []int64) {
	if len(needIDs) > 500 {
		fmt.Printf("[analytics] capped sample load for %d offers\n", len(needIDs))
	}
}
