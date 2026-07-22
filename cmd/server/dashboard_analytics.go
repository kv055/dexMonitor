package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"dexmonitor/internal/pastorders"
)

type dashboardAnalyticsParams struct {
	Hours                 int      `json:"hours"`
	Cex                   string   `json:"cex"`
	ExcludePaymentMethods []string `json:"exclude_payment_methods"`
	ExcludeCEXes          []string `json:"exclude_cexes"`
	FeeTier               string   `json:"fee_tier"`
	CoupledHedge          bool     `json:"coupled_hedge"`
	MaxFiatLimitEUR       float64  `json:"max_fiat_limit"`
	Confirmations         int      `json:"confirmations"`
	Fiat                  string   `json:"fiat"`
	Sections              []string `json:"sections"`
}

type dashboardAnalyticsResponse struct {
	GeneralStatsOverview        pastorders.GeneralStatsOverview        `json:"general_stats_overview,omitempty"`
	PastPremiums                []pastorders.PastPremiumTimeframeStats `json:"past_premiums,omitempty"`
	PremiumLifetimes            pastorders.PremiumLifetimeModes        `json:"premium_lifetimes,omitempty"`
	PastOrderStatsAll           pastorders.StatsResponse               `json:"past_order_stats_all,omitempty"`
	PastOrderStats              pastorders.StatsResponse               `json:"past_order_stats,omitempty"`
	PastOrderStatsAllNetCapped  pastorders.StatsResponse               `json:"past_order_stats_all_net_capped,omitempty"`
	PastOrderStatsNetCapped     pastorders.StatsResponse               `json:"past_order_stats_net_capped,omitempty"`
	PastOrderStatsAllNetMin     pastorders.StatsResponse               `json:"past_order_stats_all_net_min,omitempty"`
	PastOrderStatsNetMin        pastorders.StatsResponse               `json:"past_order_stats_net_min,omitempty"`
	PastProfitableOrders        []pastProfitableOrderAPI               `json:"past_profitable_orders,omitempty"`
	PastProfitableOrdersCompact []pastProfitableOrderCompactAPI        `json:"past_profitable_orders_compact,omitempty"`
}

func parseDashboardAnalyticsParams(r *http.Request) (dashboardAnalyticsParams, error) {
	var body dashboardAnalyticsParams
	if err := json.NewDecoder(http.MaxBytesReader(nil, r.Body, maxJSONBodyBytes)).Decode(&body); err != nil {
		return dashboardAnalyticsParams{}, err
	}
	if body.Hours <= 0 {
		body.Hours = 24
	}
	if strings.TrimSpace(body.Cex) == "" {
		body.Cex = defaultCEX
	}
	body.Fiat = strings.ToUpper(strings.TrimSpace(body.Fiat))
	if body.Fiat == "" {
		body.Fiat = "EUR"
	}
	body.ExcludePaymentMethods = normalizePaymentMethodList(body.ExcludePaymentMethods)
	body.Sections = normalizeAnalyticsSections(body.Sections)
	return body, nil
}

func normalizeAnalyticsSections(sections []string) []string {
	if len(sections) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(sections))
	result := make([]string, 0, len(sections))
	for _, raw := range sections {
		section := strings.TrimSpace(strings.ToLower(raw))
		if section == "" {
			continue
		}
		if _, ok := seen[section]; ok {
			continue
		}
		switch section {
		case analyticsSectionOverview, analyticsSectionTakerStatsFull, analyticsSectionTakerStats, analyticsSectionTakerOrdersFull, analyticsSectionTakerOrders:
			seen[section] = struct{}{}
			result = append(result, section)
		}
	}
	return result
}

func normalizePaymentMethodList(methods []string) []string {
	seen := make(map[string]struct{}, len(methods))
	result := make([]string, 0, len(methods))
	for _, raw := range methods {
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

func (p dashboardAnalyticsParams) cacheKey() string {
	parts := []string{
		strconv.Itoa(p.Hours),
		p.Cex,
		strings.Join(p.ExcludePaymentMethods, ","),
		strings.Join(p.ExcludeCEXes, ","),
		p.FeeTier,
		strconv.FormatBool(p.CoupledHedge),
		strconv.FormatFloat(p.MaxFiatLimitEUR, 'f', -1, 64),
		strconv.Itoa(p.Confirmations),
		p.Fiat,
	}
	return strings.Join(parts, "|")
}

func loadGeneralStatsContextForParams(p dashboardAnalyticsParams) (generalStatsContext, error) {
	key := p.cacheKey()
	now := time.Now()
	for {
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

		ctx, err := loadGeneralStatsContextUncachedForParams(p)
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
}

func loadGeneralStatsContextUncachedForParams(p dashboardAnalyticsParams) (generalStatsContext, error) {
	historyHours := p.Hours
	if historyHours < 168 {
		historyHours = 168
	}
	cutoff := time.Now().Add(-time.Duration(historyHours) * time.Hour)

	rows, err := db.Query(rebind(analyticsOffersQuery), cutoff)
	if err != nil {
		return generalStatsContext{}, err
	}
	defer rows.Close()

	offers, err := scanOffers(rows)
	if err != nil {
		return generalStatsContext{}, err
	}
	filtered := offers[:0]
	for _, offer := range offers {
		offerFiat := offerString(offer, "fiat_currency")
		if offerFiat == "" {
			offerFiat = "EUR" // compatibility with rows written before the currency column
		}
		if strings.EqualFold(offerFiat, p.Fiat) {
			filtered = append(filtered, offer)
		}
	}
	offers = filtered

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
		hours:                  p.Hours,
		excludedPaymentMethods: p.ExcludePaymentMethods,
		offers:                 offers,
		generalOffers:          generalOffers,
		closedOfferIDs:         closedOfferIDs,
		now:                    time.Now(),
	}, nil
}

func loadClosedOffers168h() ([]map[string]any, error) {
	rows, err := db.Query(
		rebind(closedAnalyzedOffersQuery),
		time.Now().Add(-168*time.Hour),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOffers(rows)
}

func handleDashboardAnalytics(w http.ResponseWriter, r *http.Request) {
	p, err := parseDashboardAnalyticsParams(r)
	if err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	resp, timings, err := buildDashboardAnalyticsResponse(p)
	if err != nil {
		writeError(w, err)
		return
	}

	writeAnalyticsServerTiming(w, timings)
	writeJSON(w, resp)
}
