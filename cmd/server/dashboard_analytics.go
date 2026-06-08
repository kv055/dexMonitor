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
}

type dashboardAnalyticsResponse struct {
	GeneralStatsOverview            pastorders.GeneralStatsOverview      `json:"general_stats_overview"`
	OpenPremiums                    pastorders.OpenPremiumStats          `json:"open_premiums"`
	PastPremiums                    []pastorders.PastPremiumTimeframeStats `json:"past_premiums"`
	PremiumLifetimes                pastorders.PremiumLifetimeModes      `json:"premium_lifetimes"`
	PastOrderStatsAll               pastorders.StatsResponse             `json:"past_order_stats_all"`
	PastOrderStats                  pastorders.StatsResponse             `json:"past_order_stats"`
	PastOrderStatsAllNetCapped      pastorders.StatsResponse             `json:"past_order_stats_all_net_capped"`
	PastOrderStatsNetCapped         pastorders.StatsResponse             `json:"past_order_stats_net_capped"`
	PastProfitableOrdersAll         []pastProfitableOrderAPI             `json:"past_profitable_orders_all"`
	PastProfitableOrders            []pastProfitableOrderAPI             `json:"past_profitable_orders"`
	PastProfitableOrdersAllNetCapped []pastProfitableOrderAPI            `json:"past_profitable_orders_all_net_capped"`
	PastProfitableOrdersNetCapped   []pastProfitableOrderAPI             `json:"past_profitable_orders_net_capped"`
}

func parseDashboardAnalyticsParams(r *http.Request) (dashboardAnalyticsParams, error) {
	var body dashboardAnalyticsParams
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
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
	return body, nil
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
	}
	return strings.Join(parts, "|")
}

func (p dashboardAnalyticsParams) liveSub() liveSubscription {
	return liveSubscription{
		cex:                   p.Cex,
		requiredConfirmations: p.Confirmations,
		excludedCEXes:         strings.Join(p.ExcludeCEXes, ","),
		feeTier:               p.FeeTier,
		coupledHedge:          p.CoupledHedge,
		maxFiatLimitEUR:       p.MaxFiatLimitEUR,
	}
}

func loadGeneralStatsContextForParams(p dashboardAnalyticsParams) (generalStatsContext, error) {
	key := p.cacheKey()
	now := time.Now()
	generalStatsCache.Lock()
	if entry, ok := generalStatsCache.entries[key]; ok && now.Before(entry.expiry) {
		ctx := entry.ctx
		generalStatsCache.Unlock()
		return ctx, nil
	}
	generalStatsCache.Unlock()

	ctx, err := loadGeneralStatsContextUncachedForParams(p)
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

func loadGeneralStatsContextUncachedForParams(p dashboardAnalyticsParams) (generalStatsContext, error) {
	historyHours := p.Hours
	if historyHours < 168 {
		historyHours = 168
	}
	cutoff := time.Now().Add(-time.Duration(historyHours) * time.Hour)

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
		hours:                  p.Hours,
		excludedPaymentMethods: p.ExcludePaymentMethods,
		sub:                    p.liveSub(),
		offers:                 offers,
		generalOffers:          generalOffers,
		closedOfferIDs:         closedOfferIDs,
		now:                    time.Now(),
	}, nil
}

func loadClosedOffers168h() ([]map[string]any, error) {
	rows, err := db.Query(
		rebind("SELECT * FROM offers WHERE is_live = FALSE AND last_seen >= ? ORDER BY last_seen DESC"),
		time.Now().Add(-168*time.Hour),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanOffers(rows)
}

func buildPastOrderStatsFromOffers(offers []map[string]any, p dashboardAnalyticsParams, mode takerOpportunityMode, applyPaymentExclusions bool) pastorders.StatsResponse {
	excluded := []string{}
	if applyPaymentExclusions {
		excluded = p.ExcludePaymentMethods
	}
	profitableOrders := make([]pastorders.PremiumOrder, 0, len(offers))
	for _, o := range offers {
		analysis := addPastOfferCostFieldsFull(o, p.Confirmations, p.ExcludeCEXes, p.FeeTier, p.MaxFiatLimitEUR)
		if !analysis.profitableInMode(mode) {
			continue
		}
		btcAmount, netProfitBTC := analysis.valuesForMode(mode)
		profitableOrders = append(profitableOrders, pastorders.PremiumOrder{
			PaymentMethod:       offerString(o, "payment_method"),
			LastSeen:            parseDBTime(offerString(o, "last_seen")),
			BTCAmount:           btcAmount,
			NetProfitBTC:        netProfitBTC,
			NetProfitFiat:       netProfitBTC * analysis.refPrice,
			BTCAmountCapped:     analysis.btcSizeCapped,
			NetProfitBTCCapped:  analysis.estimatedProfitBTCCapped,
			NetProfitFiatCapped: analysis.estimatedProfitBTCCapped * analysis.refPrice,
			HasCap:              mode == takerOpportunityModeNetCapped && analysis.hasCap,
		})
	}
	return pastorders.BuildStats(profitableOrders, time.Now(), p.Fiat, excluded)
}

func buildPastProfitableOrdersFromOffers(
	offers []map[string]any,
	p dashboardAnalyticsParams,
	mode takerOpportunityMode,
	applyPaymentExclusions bool,
	lifecycleAgg map[int64]pastLifecycleAggregate,
) []pastProfitableOrderAPI {
	result := make([]pastProfitableOrderAPI, 0, len(offers))
	for _, o := range offers {
		if applyPaymentExclusions && isPaymentMethodExcluded(offerString(o, "payment_method"), p.ExcludePaymentMethods) {
			continue
		}
		analysis := addPastOfferCostFieldsFull(o, p.Confirmations, p.ExcludeCEXes, p.FeeTier, p.MaxFiatLimitEUR)
		if !analysis.profitableInMode(mode) {
			continue
		}
		id := int64(offerFloat(o, "id"))
		result = append(result, buildPastProfitableOrderAPI(o, lifecycleAgg[id], p.Confirmations, p.ExcludeCEXes, p.FeeTier, p.MaxFiatLimitEUR, mode))
	}
	return result
}

func (ctx generalStatsContext) pastPremiumsFor(
	lifecycleAgg map[int64]pastLifecycleAggregate,
	maxFiatLimitEUR float64,
	confirmations int,
	excludedCEXes []string,
	feeTier string,
) []pastorders.PastPremiumTimeframeStats {
	return buildPastPremiumStats(ctx.offers, lifecycleAgg, ctx.now, ctx.excludedPaymentMethods, maxFiatLimitEUR, confirmations, excludedCEXes, feeTier)
}

func (ctx generalStatsContext) premiumLifetimesFor(
	lifecycleAgg map[int64]pastLifecycleAggregate,
	maxFiatLimitEUR float64,
	confirmations int,
	excludedCEXes []string,
	feeTier string,
) pastorders.PremiumLifetimeModes {
	return buildPremiumLifetimeStats(ctx.offers, lifecycleAgg, ctx.now, ctx.excludedPaymentMethods, maxFiatLimitEUR, confirmations, excludedCEXes, feeTier)
}

func handleDashboardAnalytics(w http.ResponseWriter, r *http.Request) {
	p, err := parseDashboardAnalyticsParams(r)
	if err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	ctx, err := loadGeneralStatsContextForParams(p)
	if err != nil {
		writeError(w, err)
		return
	}

	lifecycleAgg := fetchPastOfferLifecycleAggregates(ctx.closedOfferIDs)
	enrichLifecycleSamplesForCapped(lifecycleAgg, ctx.offers, p.MaxFiatLimitEUR)

	closedOffers, err := loadClosedOffers168h()
	if err != nil {
		writeError(w, err)
		return
	}

	profitableLifecycleAgg := lifecycleAgg
	if len(p.ExcludePaymentMethods) > 0 {
		filteredIDs := make([]int64, 0, len(closedOffers))
		for _, o := range closedOffers {
			if isPaymentMethodExcluded(offerString(o, "payment_method"), p.ExcludePaymentMethods) {
				continue
			}
			filteredIDs = append(filteredIDs, int64(offerFloat(o, "id")))
		}
		profitableLifecycleAgg = fetchPastOfferLifecycleAggregates(filteredIDs)
		enrichLifecycleSamplesForCapped(profitableLifecycleAgg, closedOffers, p.MaxFiatLimitEUR)
	}

	hasPaymentExclusions := len(p.ExcludePaymentMethods) > 0

	writeJSON(w, dashboardAnalyticsResponse{
		GeneralStatsOverview:             ctx.overview(),
		OpenPremiums:                     ctx.openPremiums(),
		PastPremiums:                     ctx.pastPremiumsFor(lifecycleAgg, p.MaxFiatLimitEUR, p.Confirmations, p.ExcludeCEXes, p.FeeTier),
		PremiumLifetimes:                 ctx.premiumLifetimesFor(lifecycleAgg, p.MaxFiatLimitEUR, p.Confirmations, p.ExcludeCEXes, p.FeeTier),
		PastOrderStatsAll:                buildPastOrderStatsFromOffers(closedOffers, p, takerOpportunityModeNetFull, false),
		PastOrderStats:                   buildPastOrderStatsFromOffers(closedOffers, p, takerOpportunityModeNetFull, hasPaymentExclusions),
		PastOrderStatsAllNetCapped:       buildPastOrderStatsFromOffers(closedOffers, p, takerOpportunityModeNetCapped, false),
		PastOrderStatsNetCapped:          buildPastOrderStatsFromOffers(closedOffers, p, takerOpportunityModeNetCapped, hasPaymentExclusions),
		PastProfitableOrdersAll:          buildPastProfitableOrdersFromOffers(closedOffers, p, takerOpportunityModeNetFull, false, lifecycleAgg),
		PastProfitableOrders:             buildPastProfitableOrdersFromOffers(closedOffers, p, takerOpportunityModeNetFull, hasPaymentExclusions, profitableLifecycleAgg),
		PastProfitableOrdersAllNetCapped: buildPastProfitableOrdersFromOffers(closedOffers, p, takerOpportunityModeNetCapped, false, lifecycleAgg),
		PastProfitableOrdersNetCapped:   buildPastProfitableOrdersFromOffers(closedOffers, p, takerOpportunityModeNetCapped, hasPaymentExclusions, profitableLifecycleAgg),
	})
}
