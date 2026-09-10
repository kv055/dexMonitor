package main

import (
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"dexmonitor/internal/pastorders"
)

const (
	statisticsResultCacheTTL       = 4 * time.Hour
	statisticsRefreshSweepInterval = 15 * time.Minute
	statisticsCacheRetention       = 48 * time.Hour
	statisticsCacheMaxEntries      = 32
)

const (
	statisticsCacheHeader   = "X-Stats-Cache"
	statisticsBuiltAtHeader = "X-Stats-Built-At"
)

type statisticsCacheStatus string

const (
	statisticsCacheStatusHit   statisticsCacheStatus = "hit"
	statisticsCacheStatusStale statisticsCacheStatus = "stale"
	statisticsCacheStatusMiss  statisticsCacheStatus = "miss"
)

var statisticsResultCache struct {
	sync.Mutex
	entries map[string]*statisticsResultCacheEntry
}

type statisticsResultCacheEntry struct {
	params            dashboardAnalyticsParams
	response          statisticsResponse
	builtAt           time.Time
	expiry            time.Time
	lastAccessed      time.Time
	refreshInProgress bool
	lastError         string
	refreshDone       chan struct{}
}

// liveStatistics holds the statistics that only make sense for currently-live
// offers: the live exchange distribution, the active/live counts, and the live
// premium summary (best/avg ask & bid premium pct) — the latter was previously
// computed by generalStatsContext.premiumSummary() but never surfaced, which is
// why the old GeneralStats "Open Premiums" card always rendered "—".
type liveStatistics struct {
	TotalOffers          int                                   `json:"total_offers"`
	ActiveOffers         int                                   `json:"active_offers"`
	ExchangesLive        int                                   `json:"exchanges_live"`
	OffersByExchange     []pastorders.Count                    `json:"offers_by_exchange"`
	PaymentMethodCounts  []pastorders.Count                    `json:"payment_method_counts"`
	PremiumSummary       pastorders.GeneralStatsPremiumSummary `json:"premium_summary"`
	OfferLifecyclePoints []offerLifecyclePremiumPoint          `json:"offer_lifecycle_points"`
}

// pastStatistics holds the statistics that only apply to closed/past offers:
// the per-timeframe past premium distribution (raw / net_full / net_capped) and
// the premium-weighted offer lifetime averages, plus a past-only exchange and
// payment-method breakdown.
type pastStatistics struct {
	TotalOffers          int                                    `json:"total_offers"`
	OffersByExchange     []pastorders.Count                     `json:"offers_by_exchange"`
	PaymentMethodCounts  []pastorders.Count                     `json:"payment_method_counts"`
	PastPremiums         []pastorders.PastPremiumTimeframeStats `json:"past_premiums"`
	PremiumLifetimes     pastorders.PremiumLifetimeModes        `json:"premium_lifetimes"`
	OfferLifecyclePoints []offerLifecyclePremiumPoint           `json:"offer_lifecycle_points"`
}

// offerLifecyclePremiumPoint is one bubble in the lifecycle/premium chart.
// LifecycleHours is an offer's current age for live offers and its completed
// first-seen-to-last-seen lifetime for past offers. VolumeBTC is the offered
// maximum volume (falling back to the best persisted size when unavailable).
// CounterpartyStakeBTC and CounterpartyStakePct are the maker's lock; nil when
// the venue has none. The frontend drops those offers from the matching
// deposit scatter charts.
type offerLifecyclePremiumPoint struct {
	LifecycleHours       float64  `json:"lifecycle_hours"`
	PremiumRatePct       float64  `json:"premium_rate_pct"`
	VolumeBTC            float64  `json:"volume_btc"`
	CounterpartyStakeBTC *float64 `json:"counterparty_stake_btc,omitempty"`
	CounterpartyStakePct *float64 `json:"counterparty_stake_pct,omitempty"`
	Exchange             string   `json:"exchange"`
	Direction            string   `json:"direction"`
	IsLive               bool     `json:"is_live"`
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

type statisticsBuildTimings struct {
	cacheHit        bool
	loadContextMs   float64
	buildLiveMs     float64
	buildPastMs     float64
	buildSharedMs   float64
	buildResponseMs float64
}

// offerLifecycleSnapshot is the newest order_lifecycle baseline row for one
// live offer: the price/reference-price pair the snapshot pipeline recorded
// most recently, including its directional premium.
type offerLifecycleSnapshot struct {
	RefPrice   float64
	PremiumPct float64
}

type statisticsContext struct {
	hours                  int
	excludedPaymentMethods []string
	offers                 []map[string]any
	generalOffers          []pastorders.Offer
	liveLifecycle          map[int64]offerLifecycleSnapshot
	now                    time.Time
}

const statisticsOffersQuery = `
SELECT
	id,
	exchange,
	direction,
	price,
	btc_min,
	btc_max,
	payment_methods,
	first_seen,
	last_seen,
	is_live,
	avg_ref_price,
	avg_premium_pct,
	avg_net_premium_pct,
	avg_trade_cost_pct,
	avg_trade_cost_btc,
	cex_taker_fee_btc,
	cex_withdraw_fee_btc,
	routing_fee_sum,
	hedge_open_fee_btc,
	hedge_close_fee_btc,
	hedge_funding_fee_btc,
	hedge_fee_sum_btc,
	hedge_venue,
	hedge_instrument,
	hedge_transfer_minutes,
	dex_fee_btc,
	avg_estimated_profit_btc,
	avg_estimated_profit_fiat,
	avg_btc_amount,
	best_route_cex,
	routing_profile,
	routing_fee_detail,
	counterparty_stake_btc,
	counterparty_stake_pct
FROM offers
WHERE last_seen >= ?
ORDER BY last_seen DESC
`

// splitGeneralOffersByLiveness partitions ctx.generalOffers into live and past
// slices by the IsLive flag set when the context was built.
func splitGeneralOffersByLiveness(ctx statisticsContext) (live, past []pastorders.Offer) {
	for _, o := range ctx.generalOffers {
		if o.IsLive {
			live = append(live, o)
		} else {
			past = append(past, o)
		}
	}
	return live, past
}

// buildOfferLifecyclePremiumPoints builds the lifecycle/premium bubbles. Live
// offers use their current age as lifecycle; past offers their completed
// first-seen-to-last-seen lifetime. liveLifecycle carries each live offer's
// newest order_lifecycle baseline snapshot, used as premium fallback because
// live offers have no persisted avg_premium_pct/avg_ref_price until they close.
func buildOfferLifecyclePremiumPoints(
	offers []map[string]any,
	now time.Time,
	hours int,
	excludedPaymentMethods []string,
	liveLifecycle map[int64]offerLifecycleSnapshot,
) (live, past []offerLifecyclePremiumPoint) {
	if now.IsZero() {
		now = time.Now()
	}
	if hours <= 0 {
		hours = 24
	}
	cutoff := now.Add(-time.Duration(hours) * time.Hour)
	live = make([]offerLifecyclePremiumPoint, 0)
	past = make([]offerLifecyclePremiumPoint, 0)

	for _, offer := range offers {
		if offerHasExcludedPaymentMethod(offer, excludedPaymentMethods) {
			continue
		}
		firstSeen := parseDBTime(offerString(offer, "first_seen"))
		lastSeen := parseDBTime(offerString(offer, "last_seen"))
		if firstSeen.IsZero() || lastSeen.IsZero() || lastSeen.Before(cutoff) {
			continue
		}

		isLive := offerBool(offer, "is_live")
		lifecycleEnd := lastSeen
		if isLive {
			lifecycleEnd = now
		}
		if lifecycleEnd.Before(firstSeen) {
			continue
		}

		offerID := int64(offerFloat(offer, "id"))
		premium := offerFloatPtrPreserveZero(offer, "avg_premium_pct")
		if premium == nil {
			refPrice := offerRefPrice(offer)
			if refPrice <= 0 && isLive {
				if snap, ok := liveLifecycle[offerID]; ok && snap.RefPrice > 0 {
					computed := computeDirectionalPremiumPct(
						offerString(offer, "direction"),
						offerFloat(offer, "price"),
						snap.RefPrice,
					)
					premium = &computed
				}
			}
			if premium == nil && refPrice <= 0 {
				continue
			}
			if premium == nil {
				computed := computeDirectionalPremiumPct(
					offerString(offer, "direction"),
					offerFloat(offer, "price"),
					refPrice,
				)
				premium = &computed
			}
		}
		if math.IsNaN(*premium) || math.IsInf(*premium, 0) {
			continue
		}

		volume := offerFloat(offer, "btc_max")
		if volume <= 0 {
			volume = offerFloat(offer, "avg_btc_amount")
		}
		if volume <= 0 {
			volume = offerFloat(offer, "btc_min")
		}
		if volume <= 0 || math.IsNaN(volume) || math.IsInf(volume, 0) {
			continue
		}

		point := offerLifecyclePremiumPoint{
			LifecycleHours: lifecycleEnd.Sub(firstSeen).Hours(),
			PremiumRatePct: *premium,
			VolumeBTC:      volume,
			Exchange:       offerString(offer, "exchange"),
			Direction:      offerString(offer, "direction"),
			IsLive:         isLive,
		}
		if stake := offerFloatPtrPreserveZero(offer, "counterparty_stake_btc"); stake != nil && *stake > 0 && !math.IsNaN(*stake) && !math.IsInf(*stake, 0) {
			point.CounterpartyStakeBTC = stake
		}
		if stakePct := offerFloatPtrPreserveZero(offer, "counterparty_stake_pct"); stakePct != nil && *stakePct > 0 && !math.IsNaN(*stakePct) && !math.IsInf(*stakePct, 0) {
			point.CounterpartyStakePct = stakePct
		}
		if isLive {
			live = append(live, point)
		} else {
			past = append(past, point)
		}
	}
	return live, past
}

func loadStatisticsContextForParams(p dashboardAnalyticsParams) (statisticsContext, error) {
	query := statisticsOffersQuery
	args := []any{}
	if p.hasCustomPastRange() {
		query = strings.Replace(query, "WHERE last_seen >= ?", "WHERE last_seen >= ? AND last_seen < ?", 1)
		args = append(args, p.pastRangeStart.Format("2006-01-02 15:04:05"), p.pastRangeEnd.Format("2006-01-02 15:04:05"))
	} else {
		historyHours := p.Hours
		if historyHours < 168 {
			historyHours = 168
		}
		args = append(args, time.Now().Add(-time.Duration(historyHours)*time.Hour))
	}

	rows, err := db.Query(rebind(query), args...)
	if err != nil {
		return statisticsContext{}, err
	}
	defer rows.Close()

	offers, err := scanOffers(rows)
	if err != nil {
		return statisticsContext{}, err
	}

	windowHours := p.Hours
	if windowHours <= 0 {
		windowHours = 24
	}
	liveLifecycle, err := loadLiveLifecyclePremiums(offers, time.Now().Add(-time.Duration(windowHours)*time.Hour))
	if err != nil {
		return statisticsContext{}, err
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
			PaymentMethods:   offerStringSlice(o, "payment_methods"),
			PriceDiffPercent: priceDiffPtr,
			FirstSeen:        parseDBTime(offerString(o, "first_seen")),
			LastSeen:         parseDBTime(offerString(o, "last_seen")),
			IsLive:           offerBool(o, "is_live"),
		})
	}

	return statisticsContext{
		hours:                  p.Hours,
		excludedPaymentMethods: p.ExcludePaymentMethods,
		offers:                 offers,
		generalOffers:          generalOffers,
		liveLifecycle:          liveLifecycle,
		now:                    time.Now(),
	}, nil
}

// loadLiveLifecyclePremiums returns each live offer's newest order_lifecycle
// baseline row inside the window. Live offers carry no persisted premium
// averages (reconcileLiveOfferStatus nulls them until close), so this single
// indexed lookup — not a full lifecycle replay — supplies the reference price
// the lifecycle/premium chart needs for currently-live offers.
func loadLiveLifecyclePremiums(offers []map[string]any, cutoff time.Time) (map[int64]offerLifecycleSnapshot, error) {
	liveIDs := make([]int64, 0, len(offers))
	for _, o := range offers {
		if offerBool(o, "is_live") {
			liveIDs = append(liveIDs, int64(offerFloat(o, "id")))
		}
	}
	if len(liveIDs) == 0 {
		return nil, nil
	}

	query := `
SELECT offer_db_id, ref_price, premium_pct
FROM order_lifecycle
WHERE snapshot_time >= ? AND offer_db_id IN (` + strings.TrimSuffix(strings.Repeat("?,", len(liveIDs)), ",") + `)
ORDER BY offer_db_id, snapshot_time`
	args := make([]any, 0, len(liveIDs)+1)
	args = append(args, cutoff.Format("2006-01-02 15:04:05"))
	for _, id := range liveIDs {
		args = append(args, id)
	}

	rows, err := db.Query(rebind(query), args...)
	if err != nil {
		// Non-fatal: without lifecycle rows (or the table itself) the chart
		// simply loses its live-offer fallback, as before this lookup existed.
		slog.Warn("statistics: live lifecycle premium lookup failed", "err", err)
		return nil, nil
	}
	defer rows.Close()

	latest := make(map[int64]offerLifecycleSnapshot, len(liveIDs))
	for rows.Next() {
		var (
			id   int64
			snap offerLifecycleSnapshot
		)
		if err := rows.Scan(&id, &snap.RefPrice, &snap.PremiumPct); err != nil {
			return nil, fmt.Errorf("scan live lifecycle premium: %w", err)
		}
		latest[id] = snap
	}
	return latest, rows.Err()
}

func writeStatisticsServerTiming(w http.ResponseWriter, timings statisticsBuildTimings) {
	w.Header().Add("Server-Timing", fmt.Sprintf(
		"cache;desc=\"hit=%t\", ctx;dur=%.1f, live;dur=%.1f, past;dur=%.1f, shared;dur=%.1f, total;dur=%.1f",
		timings.cacheHit,
		timings.loadContextMs,
		timings.buildLiveMs,
		timings.buildPastMs,
		timings.buildSharedMs,
		timings.buildResponseMs,
	))
}

func buildStatisticsResponse(p dashboardAnalyticsParams) (statisticsResponse, statisticsBuildTimings, error) {
	timings := statisticsBuildTimings{}
	start := time.Now()
	ctxStart := time.Now()
	ctx, err := loadStatisticsContextForParams(p)
	timings.loadContextMs = float64(time.Since(ctxStart).Milliseconds())
	if err != nil {
		return statisticsResponse{}, timings, err
	}

	liveOffers, pastOffers := splitGeneralOffersByLiveness(ctx)
	liveLifecyclePoints, pastLifecyclePoints := buildOfferLifecyclePremiumPoints(
		ctx.offers,
		ctx.now,
		ctx.hours,
		ctx.excludedPaymentMethods,
		ctx.liveLifecycle,
	)

	// Live dimension: overview (active/live counts + exchange distribution) and
	// the previously-unused premium summary, both scoped to currently-live offers.
	liveStart := time.Now()
	liveOverview := pastorders.BuildGeneralStatsOverview(liveOffers, ctx.now, ctx.hours, ctx.excludedPaymentMethods)
	livePremiums := pastorders.BuildGeneralStatsPremiumSummary(liveOffers, ctx.now, ctx.hours, ctx.excludedPaymentMethods)
	timings.buildLiveMs = float64(time.Since(liveStart).Milliseconds())

	// Past dimension: per-timeframe past premiums and premium-weighted lifetimes.
	// This summary endpoint intentionally uses only persisted per-offer averages
	// from offers and avoids order_lifecycle aggregation.
	pastStart := time.Now()
	pastPremiums, premiumLifetimes := buildPastPremiumAndLifetimeStatsFromPersistedOffers(
		ctx.offers,
		ctx.now,
		ctx.excludedPaymentMethods,
		p.MaxFiatLimitEUR,
		p.Confirmations,
		p.ExcludeCEXes,
		p.FeeTier,
	)
	timings.buildPastMs = float64(time.Since(pastStart).Milliseconds())

	// Past-only exchange + payment method breakdown. BuildGeneralStatsOverview's
	// active/exchangesLive fields are meaningless on a closed-only set, so only
	// the totals, exchange, and payment-method fields are carried into the
	// pastStatistics response.
	pastOverview := pastorders.BuildGeneralStatsOverview(pastOffers, ctx.now, ctx.hours, ctx.excludedPaymentMethods)

	// Shared dimension: the full-window overview (live + past combined).
	sharedStart := time.Now()
	sharedOverview := pastorders.BuildGeneralStatsOverview(ctx.generalOffers, ctx.now, ctx.hours, ctx.excludedPaymentMethods)
	timings.buildSharedMs = float64(time.Since(sharedStart).Milliseconds())

	resp := statisticsResponse{
		Live: liveStatistics{
			TotalOffers:          liveOverview.TotalOffers,
			ActiveOffers:         liveOverview.ActiveOffers,
			ExchangesLive:        liveOverview.ExchangesLive,
			OffersByExchange:     liveOverview.OffersByExchange,
			PaymentMethodCounts:  liveOverview.PaymentMethodCounts,
			PremiumSummary:       livePremiums,
			OfferLifecyclePoints: liveLifecyclePoints,
		},
		Past: pastStatistics{
			TotalOffers:          pastOverview.TotalOffers,
			OffersByExchange:     pastOverview.OffersByExchange,
			PaymentMethodCounts:  pastOverview.PaymentMethodCounts,
			PastPremiums:         pastPremiums,
			PremiumLifetimes:     premiumLifetimes,
			OfferLifecyclePoints: pastLifecyclePoints,
		},
		Shared: sharedStatistics{
			Hours:               ctx.hours,
			TotalOffers:         sharedOverview.TotalOffers,
			ActiveOffers:        sharedOverview.ActiveOffers,
			ExchangesLive:       sharedOverview.ExchangesLive,
			OffersByExchange:    sharedOverview.OffersByExchange,
			PaymentMethodCounts: sharedOverview.PaymentMethodCounts,
		},
	}
	timings.buildResponseMs = float64(time.Since(start).Milliseconds())
	return resp, timings, nil
}

func ensureStatisticsCacheEntry(cacheKey string, params dashboardAnalyticsParams, now time.Time) *statisticsResultCacheEntry {
	if statisticsResultCache.entries == nil {
		statisticsResultCache.entries = make(map[string]*statisticsResultCacheEntry)
	}
	entry := statisticsResultCache.entries[cacheKey]
	if entry == nil {
		entry = &statisticsResultCacheEntry{}
		statisticsResultCache.entries[cacheKey] = entry
	}
	entry.params = params
	entry.lastAccessed = now
	return entry
}

func statisticsCacheEntryUsable(entry *statisticsResultCacheEntry) bool {
	return entry != nil && !entry.builtAt.IsZero()
}

func beginStatisticsRefreshLocked(entry *statisticsResultCacheEntry) chan struct{} {
	if entry.refreshInProgress {
		return entry.refreshDone
	}
	entry.refreshInProgress = true
	entry.refreshDone = make(chan struct{})
	return entry.refreshDone
}

func finishStatisticsRefresh(cacheKey string, params dashboardAnalyticsParams, resp statisticsResponse, err error) {
	now := time.Now()
	statisticsResultCache.Lock()
	entry := ensureStatisticsCacheEntry(cacheKey, params, now)
	done := entry.refreshDone
	entry.refreshInProgress = false
	entry.refreshDone = nil
	if err != nil {
		entry.lastError = err.Error()
	} else {
		entry.response = resp
		entry.builtAt = now
		entry.expiry = now.Add(statisticsResultCacheTTL)
		entry.lastError = ""
	}
	sweepStatisticsResultCacheLocked(now)
	statisticsResultCache.Unlock()

	if done != nil {
		close(done)
	}
}

func triggerStatisticsRefresh(cacheKey string, params dashboardAnalyticsParams) {
	go func() {
		start := time.Now()
		resp, timings, err := buildStatisticsResponse(params)
		finishStatisticsRefresh(cacheKey, params, resp, err)
		if err != nil {
			slog.Warn("statistics refresh failed", "cache_key", cacheKey, "duration_ms", time.Since(start).Milliseconds(), "err", err)
			return
		}
		slog.Debug(
			"statistics refresh completed",
			"cache_key", cacheKey,
			"duration_ms", time.Since(start).Milliseconds(),
			"ctx_ms", timings.loadContextMs,
			"live_ms", timings.buildLiveMs,
			"past_ms", timings.buildPastMs,
			"shared_ms", timings.buildSharedMs,
		)
	}()
}

func sweepStatisticsResultCacheLocked(now time.Time) {
	for key, entry := range statisticsResultCache.entries {
		if entry.refreshInProgress {
			continue
		}
		if !entry.lastAccessed.IsZero() && now.Sub(entry.lastAccessed) > statisticsCacheRetention {
			delete(statisticsResultCache.entries, key)
		}
	}
	if len(statisticsResultCache.entries) <= statisticsCacheMaxEntries {
		return
	}
	type cacheAge struct {
		key          string
		lastAccessed time.Time
	}
	ages := make([]cacheAge, 0, len(statisticsResultCache.entries))
	for key, entry := range statisticsResultCache.entries {
		if entry.refreshInProgress {
			continue
		}
		ages = append(ages, cacheAge{key: key, lastAccessed: entry.lastAccessed})
	}
	for len(statisticsResultCache.entries) > statisticsCacheMaxEntries && len(ages) > 0 {
		oldestIdx := 0
		for i := 1; i < len(ages); i++ {
			if ages[i].lastAccessed.Before(ages[oldestIdx].lastAccessed) {
				oldestIdx = i
			}
		}
		delete(statisticsResultCache.entries, ages[oldestIdx].key)
		ages = append(ages[:oldestIdx], ages[oldestIdx+1:]...)
	}
}

func writeStatisticsCacheHeaders(w http.ResponseWriter, status statisticsCacheStatus, builtAt time.Time) {
	w.Header().Set(statisticsCacheHeader, string(status))
	if !builtAt.IsZero() {
		w.Header().Set(statisticsBuiltAtHeader, builtAt.UTC().Format(time.RFC3339))
	}
}

func runStatisticsRefreshLoop(stop <-chan struct{}) {
	ticker := time.NewTicker(statisticsRefreshSweepInterval)
	defer ticker.Stop()

	refreshExpired := func(now time.Time) {
		type refreshTask struct {
			cacheKey string
			params   dashboardAnalyticsParams
		}
		tasks := make([]refreshTask, 0)
		statisticsResultCache.Lock()
		sweepStatisticsResultCacheLocked(now)
		for cacheKey, entry := range statisticsResultCache.entries {
			if entry.refreshInProgress {
				continue
			}
			if entry.lastAccessed.IsZero() || now.Sub(entry.lastAccessed) > statisticsCacheRetention {
				continue
			}
			if !entry.expiry.IsZero() && now.Before(entry.expiry) {
				continue
			}
			beginStatisticsRefreshLocked(entry)
			tasks = append(tasks, refreshTask{cacheKey: cacheKey, params: entry.params})
		}
		statisticsResultCache.Unlock()

		for _, task := range tasks {
			triggerStatisticsRefresh(task.cacheKey, task.params)
		}
	}

	for {
		select {
		case <-stop:
			return
		case now := <-ticker.C:
			refreshExpired(now)
		}
	}
}

// handleStatistics serves POST /api/statistics: a single-call breakdown of the
// offer window into live, past, and shared statistics. This endpoint is a
// persisted-summary surface: it builds from selected offers columns only,
// keeps the same body schema as /api/dashboard/analytics, and avoids lifecycle
// replay — except for one indexed newest-snapshot lookup per live offer that
// backs the lifecycle/premium chart (see loadLiveLifecyclePremiums). Statistics
// are served stale-while-revalidate: the first request for a key builds
// synchronously, later expired snapshots are returned immediately while a
// background refresh rebuilds them.
func handleStatistics(w http.ResponseWriter, r *http.Request) {
	p, err := parseDashboardAnalyticsParams(r)
	if err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	cacheKey := p.cacheKey()
	for {
		now := time.Now()
		statisticsResultCache.Lock()
		entry := ensureStatisticsCacheEntry(cacheKey, p, now)
		sweepStatisticsResultCacheLocked(now)

		if statisticsCacheEntryUsable(entry) && now.Before(entry.expiry) {
			resp := entry.response
			builtAt := entry.builtAt
			statisticsResultCache.Unlock()
			writeStatisticsCacheHeaders(w, statisticsCacheStatusHit, builtAt)
			writeStatisticsServerTiming(w, statisticsBuildTimings{cacheHit: true})
			writeJSON(w, resp)
			return
		}
		if statisticsCacheEntryUsable(entry) {
			resp := entry.response
			builtAt := entry.builtAt
			startRefresh := !entry.refreshInProgress
			if startRefresh {
				beginStatisticsRefreshLocked(entry)
			}
			statisticsResultCache.Unlock()
			if startRefresh {
				triggerStatisticsRefresh(cacheKey, p)
			}
			writeStatisticsCacheHeaders(w, statisticsCacheStatusStale, builtAt)
			writeStatisticsServerTiming(w, statisticsBuildTimings{cacheHit: true})
			writeJSON(w, resp)
			return
		}
		if entry.refreshInProgress {
			done := entry.refreshDone
			statisticsResultCache.Unlock()
			if done != nil {
				<-done
				continue
			}
		} else {
			beginStatisticsRefreshLocked(entry)
			statisticsResultCache.Unlock()

			resp, timings, err := buildStatisticsResponse(p)
			finishStatisticsRefresh(cacheKey, p, resp, err)
			if err != nil {
				writeError(w, err)
				return
			}
			statisticsResultCache.Lock()
			builtAt := time.Time{}
			if refreshed := statisticsResultCache.entries[cacheKey]; refreshed != nil {
				builtAt = refreshed.builtAt
			}
			statisticsResultCache.Unlock()
			writeStatisticsCacheHeaders(w, statisticsCacheStatusMiss, builtAt)
			writeStatisticsServerTiming(w, timings)
			writeJSON(w, resp)
			return
		}
	}
}
