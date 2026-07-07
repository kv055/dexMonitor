package main

import (
	"net/http"
	"sync"
	"time"

	"dexmonitor/internal/pastorders"
)

// statisticsResultCacheTTL mirrors analyticsResultCacheTTL: the past-premium
// and lifetime aggregation is expensive and only depends on the param set
// (filters + fee/cap config) and the 168h offer window, so a 10-minute TTL
// trades a tiny staleness window for eliminating the per-request rebuild that
// made /api/statistics slow enough to time out under load.
const statisticsResultCacheTTL = 10 * time.Minute

var statisticsResultCache struct {
	sync.Mutex
	entries map[string]statisticsResultCacheEntry
}

type statisticsResultCacheEntry struct {
	response statisticsResponse
	expiry   time.Time
}

// liveStatistics holds the statistics that only make sense for currently-live
// offers: the live exchange distribution, the active/live counts, and the live
// premium summary (best/avg ask & bid premium pct) — the latter was previously
// computed by generalStatsContext.premiumSummary() but never surfaced, which is
// why the old GeneralStats "Open Premiums" card always rendered "—".
type liveStatistics struct {
	TotalOffers         int                              `json:"total_offers"`
	ActiveOffers        int                              `json:"active_offers"`
	ExchangesLive       int                              `json:"exchanges_live"`
	OffersByExchange    []pastorders.Count               `json:"offers_by_exchange"`
	PaymentMethodCounts []pastorders.Count               `json:"payment_method_counts"`
	PremiumSummary      pastorders.GeneralStatsPremiumSummary `json:"premium_summary"`
}

// pastStatistics holds the statistics that only apply to closed/past offers:
// the per-timeframe past premium distribution (raw / net_full / net_capped) and
// the premium-weighted offer lifetime averages, plus a past-only exchange and
// payment-method breakdown.
type pastStatistics struct {
	TotalOffers         int                                   `json:"total_offers"`
	OffersByExchange    []pastorders.Count                    `json:"offers_by_exchange"`
	PaymentMethodCounts []pastorders.Count                    `json:"payment_method_counts"`
	PastPremiums        []pastorders.PastPremiumTimeframeStats `json:"past_premiums"`
	PremiumLifetimes    pastorders.PremiumLifetimeModes       `json:"premium_lifetimes"`
}

// sharedStatistics holds aggregates that span both live and past offers in the
// configured window: the combined totals, exchange distribution, and payment
// method counts.
type sharedStatistics struct {
	Hours               int                `json:"hours"`
	TotalOffers         int                `json:"total_offers"`
	ActiveOffers        int                `json:"active_offers"`
	ExchangesLive       int                `json:"exchanges_live"`
	OffersByExchange    []pastorders.Count `json:"offers_by_exchange"`
	PaymentMethodCounts []pastorders.Count `json:"payment_method_counts"`
}

type statisticsResponse struct {
	Live   liveStatistics   `json:"live"`
	Past   pastStatistics   `json:"past"`
	Shared sharedStatistics `json:"shared"`
}

// splitGeneralOffersByLiveness partitions ctx.generalOffers into live and past
// slices by the IsLive flag set when the context was built.
func splitGeneralOffersByLiveness(ctx generalStatsContext) (live, past []pastorders.Offer) {
	for _, o := range ctx.generalOffers {
		if o.IsLive {
			live = append(live, o)
		} else {
			past = append(past, o)
		}
	}
	return live, past
}

func buildStatisticsResponse(p dashboardAnalyticsParams) (statisticsResponse, error) {
	ctx, err := loadGeneralStatsContextForParams(p)
	if err != nil {
		return statisticsResponse{}, err
	}

	liveOffers, pastOffers := splitGeneralOffersByLiveness(ctx)

	// Live dimension: overview (active/live counts + exchange distribution) and
	// the previously-unused premium summary, both scoped to currently-live offers.
	liveOverview := pastorders.BuildGeneralStatsOverview(liveOffers, ctx.now, ctx.hours, ctx.excludedPaymentMethods)
	livePremiums := pastorders.BuildGeneralStatsPremiumSummary(liveOffers, ctx.now, ctx.hours, ctx.excludedPaymentMethods)

	// Past dimension: per-timeframe past premiums and premium-weighted lifetimes.
	// buildPastPremiumAndLifetimeStats already skips is_live rows internally, but
	// it iterates the full 168h offer set so it can bucket by last_seen; pass the
	// whole context offer slice. The lifecycle aggregate is needed for net/capped
	// premium math.
	lifecycleAgg := fetchPastOfferLifecycleAggregates(ctx.closedOfferIDs)
	pastPremiums, premiumLifetimes := buildPastPremiumAndLifetimeStats(
		ctx.offers,
		lifecycleAgg,
		ctx.now,
		ctx.excludedPaymentMethods,
		p.MaxFiatLimitEUR,
		p.Confirmations,
		p.ExcludeCEXes,
		p.FeeTier,
	)

	// Past-only exchange + payment method breakdown. BuildGeneralStatsOverview's
	// active/exchangesLive fields are meaningless on a closed-only set, so only
	// the totals, exchange, and payment-method fields are carried into the
	// pastStatistics response.
	pastOverview := pastorders.BuildGeneralStatsOverview(pastOffers, ctx.now, ctx.hours, ctx.excludedPaymentMethods)

	// Shared dimension: the full-window overview (live + past combined).
	sharedOverview := ctx.overview()

	return statisticsResponse{
		Live: liveStatistics{
			TotalOffers:         liveOverview.TotalOffers,
			ActiveOffers:        liveOverview.ActiveOffers,
			ExchangesLive:       liveOverview.ExchangesLive,
			OffersByExchange:    liveOverview.OffersByExchange,
			PaymentMethodCounts: liveOverview.PaymentMethodCounts,
			PremiumSummary:      livePremiums,
		},
		Past: pastStatistics{
			TotalOffers:         pastOverview.TotalOffers,
			OffersByExchange:    pastOverview.OffersByExchange,
			PaymentMethodCounts: pastOverview.PaymentMethodCounts,
			PastPremiums:        pastPremiums,
			PremiumLifetimes:    premiumLifetimes,
		},
		Shared: sharedStatistics{
			Hours:               ctx.hours,
			TotalOffers:         sharedOverview.TotalOffers,
			ActiveOffers:        sharedOverview.ActiveOffers,
			ExchangesLive:       sharedOverview.ExchangesLive,
			OffersByExchange:    sharedOverview.OffersByExchange,
			PaymentMethodCounts: sharedOverview.PaymentMethodCounts,
		},
	}, nil
}

// handleStatistics serves POST /api/statistics: a single-call breakdown of the
// offer window into live, past, and shared statistics. It reuses the cached
// generalStatsContext (30s TTL) and the same body schema as
// /api/dashboard/analytics. The full statisticsResponse is additionally cached
// per param set for statisticsResultCacheTTL, since buildStatisticsResponse
// rebuilds the past-premium/lifetime aggregation from scratch on every call —
// the dominant cost that made the Statistics page slow.
func handleStatistics(w http.ResponseWriter, r *http.Request) {
	p, err := parseDashboardAnalyticsParams(r)
	if err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	cacheKey := p.cacheKey()
	now := time.Now()
	statisticsResultCache.Lock()
	if entry, ok := statisticsResultCache.entries[cacheKey]; ok && now.Before(entry.expiry) {
		resp := entry.response
		statisticsResultCache.Unlock()
		writeJSON(w, resp)
		return
	}
	statisticsResultCache.Unlock()

	resp, err := buildStatisticsResponse(p)
	if err != nil {
		writeError(w, err)
		return
	}

	statisticsResultCache.Lock()
	if statisticsResultCache.entries == nil {
		statisticsResultCache.entries = make(map[string]statisticsResultCacheEntry)
	}
	for k, e := range statisticsResultCache.entries {
		if !now.Before(e.expiry) {
			delete(statisticsResultCache.entries, k)
		}
	}
	statisticsResultCache.entries[cacheKey] = statisticsResultCacheEntry{
		response: resp,
		expiry:   now.Add(statisticsResultCacheTTL),
	}
	statisticsResultCache.Unlock()

	writeJSON(w, resp)
}
