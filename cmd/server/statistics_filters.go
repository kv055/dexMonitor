package main

import (
	"math"
	"strings"

	"dexmonitor/internal/pastorders"
)

type statisticsOfferMetrics struct {
	rawPremium      float64
	hasRaw          bool
	netFull         float64
	hasNetFull      bool
	netCapped       float64
	hasNetCapped    bool
	profitFull      float64
	hasProfitFull   bool
	profitCapped    float64
	hasProfitCapped bool
}

func (p dashboardAnalyticsParams) hasOfferFilters() bool {
	if p.Direction != "" || len(p.ExcludedExchanges) > 0 || len(p.IncludePaymentMethods) > 0 || p.PaymentScope == "linked" {
		return true
	}
	if p.PremiumMode != "" || p.PremiumOnly != nil {
		return true
	}
	if p.RangeMetric != "" || p.ProfitMin != nil || p.ProfitMax != nil || p.PremiumMin != nil || p.PremiumMax != nil {
		return true
	}
	return false
}

func (p dashboardAnalyticsParams) statisticsPremiumMode() string {
	if p.PremiumMode == "net_full" || p.PremiumMode == "net_capped" || p.PremiumMode == "raw" {
		return p.PremiumMode
	}
	return "raw"
}

func (m statisticsOfferMetrics) premium(mode string) (float64, bool) {
	switch mode {
	case "net_capped":
		return m.netCapped, m.hasNetCapped
	case "net_full":
		return m.netFull, m.hasNetFull
	default:
		return m.rawPremium, m.hasRaw
	}
}

func (m statisticsOfferMetrics) profit(mode string) (float64, bool) {
	if mode == "net_capped" {
		return m.profitCapped, m.hasProfitCapped
	}
	return m.profitFull, m.hasProfitFull
}

func statisticsOfferID(offer map[string]any) int64 {
	return int64(offerFloat(offer, "id"))
}

func computeStatisticsOfferMetrics(
	offer map[string]any,
	liveLifecycle map[int64]offerLifecycleSnapshot,
	maxFiatLimitEUR float64,
) statisticsOfferMetrics {
	var metrics statisticsOfferMetrics
	raw, ok := statisticsRawPremium(offer, liveLifecycle)
	if ok {
		metrics.rawPremium = raw
		metrics.hasRaw = true
	}

	if net := offerFloatPtrPreserveZero(offer, "avg_net_premium_pct"); net != nil {
		metrics.netFull = *net
		metrics.hasNetFull = true
	} else if metrics.hasRaw {
		if cost := offerFloatPtrPreserveZero(offer, "avg_trade_cost_pct"); cost != nil {
			metrics.netFull = raw - *cost
			metrics.hasNetFull = true
		} else {
			metrics.netFull = raw
			metrics.hasNetFull = true
		}
	}

	if profit := offerFloatPtrPreserveZero(offer, "avg_estimated_profit_fiat"); profit != nil {
		metrics.profitFull = *profit
		metrics.hasProfitFull = true
	} else if metrics.hasNetFull {
		if estimated, estimatedOK := estimateProfitFiat(offer, metrics.netFull, liveLifecycle); estimatedOK {
			metrics.profitFull = estimated
			metrics.hasProfitFull = true
		}
	}

	metrics.netCapped = metrics.netFull
	metrics.hasNetCapped = metrics.hasNetFull
	metrics.profitCapped = metrics.profitFull
	metrics.hasProfitCapped = metrics.hasProfitFull
	if maxFiatLimitEUR <= 0 || !metrics.hasNetFull {
		return metrics
	}

	agg := persistedLifecycleAggregateForOffer(offer)
	avgRefPrice := agg.AvgRefPrice
	if avgRefPrice <= 0 {
		avgRefPrice = offerRefPrice(offer)
	}
	fullTradeSizeBTC := pastOfferFullTradeSizeBTC(offer, agg.AvgOfferPrice)
	if avgRefPrice <= 0 || fullTradeSizeBTC <= 0 {
		return metrics
	}
	btcCap := maxFiatLimitEUR / avgRefPrice
	if !cappedTradeIsExecutable(offer, btcCap, maxFiatLimitEUR) {
		metrics.netCapped = 0
		metrics.hasNetCapped = true
		metrics.profitCapped = 0
		metrics.hasProfitCapped = true
		return metrics
	}
	if fullTradeSizeBTC > btcCap {
		capped := cappedNetPremium(offer, agg, fullTradeSizeBTC, maxFiatLimitEUR)
		metrics.netCapped = capped
		metrics.hasNetCapped = true
		if metrics.hasProfitFull && fullTradeSizeBTC > 0 {
			metrics.profitCapped = metrics.profitFull * (btcCap / fullTradeSizeBTC)
			metrics.hasProfitCapped = true
		}
	}
	return metrics
}

func statisticsRawPremium(offer map[string]any, liveLifecycle map[int64]offerLifecycleSnapshot) (float64, bool) {
	if premium := offerFloatPtrPreserveZero(offer, "avg_premium_pct"); premium != nil {
		if math.IsNaN(*premium) || math.IsInf(*premium, 0) {
			return 0, false
		}
		return *premium, true
	}
	refPrice := offerRefPrice(offer)
	offerID := statisticsOfferID(offer)
	isLive := offerBool(offer, "is_live")
	if refPrice <= 0 && isLive {
		if snap, ok := liveLifecycle[offerID]; ok && snap.RefPrice > 0 {
			computed := computeDirectionalPremiumPct(
				offerString(offer, "direction"),
				offerFloat(offer, "price"),
				snap.RefPrice,
			)
			if math.IsNaN(computed) || math.IsInf(computed, 0) {
				return 0, false
			}
			return computed, true
		}
	}
	if refPrice <= 0 {
		return 0, false
	}
	computed := computeDirectionalPremiumPct(
		offerString(offer, "direction"),
		offerFloat(offer, "price"),
		refPrice,
	)
	if math.IsNaN(computed) || math.IsInf(computed, 0) {
		return 0, false
	}
	return computed, true
}

func estimateProfitFiat(offer map[string]any, netPremiumPct float64, liveLifecycle map[int64]offerLifecycleSnapshot) (float64, bool) {
	volume := statisticsOfferVolumeBTC(offer)
	if volume <= 0 {
		return 0, false
	}
	refPrice := offerRefPrice(offer)
	if refPrice <= 0 && offerBool(offer, "is_live") {
		if snap, ok := liveLifecycle[statisticsOfferID(offer)]; ok {
			refPrice = snap.RefPrice
		}
	}
	if refPrice <= 0 {
		refPrice = offerFloat(offer, "price")
	}
	if refPrice <= 0 || math.IsNaN(refPrice) || math.IsInf(refPrice, 0) {
		return 0, false
	}
	return (netPremiumPct / 100) * volume * refPrice, true
}

func statisticsOfferVolumeBTC(offer map[string]any) float64 {
	volume := offerFloat(offer, "btc_max")
	if !offerBool(offer, "is_live") {
		// A closed fiat-denominated offer's btc_max is its last snapshot's
		// conversion; use its whole-life volume like the past-offer analysis.
		_, volume = derefBounds(pastOfferBTCBounds(offer, 0))
	}
	if volume <= 0 {
		volume = offerFloat(offer, "avg_btc_amount")
	}
	if volume <= 0 {
		volume = offerFloat(offer, "btc_min")
	}
	if volume <= 0 || math.IsNaN(volume) || math.IsInf(volume, 0) {
		return 0
	}
	return volume
}

func (p dashboardAnalyticsParams) withoutOfferFilters() dashboardAnalyticsParams {
	cleared := p
	cleared.Direction = ""
	cleared.ExcludedExchanges = nil
	cleared.IncludePaymentMethods = nil
	cleared.PaymentScope = ""
	cleared.PremiumMode = ""
	cleared.PremiumOnly = nil
	cleared.RangeMetric = ""
	cleared.ProfitMin = nil
	cleared.ProfitMax = nil
	cleared.PremiumMin = nil
	cleared.PremiumMax = nil
	cleared.Refresh = false
	return cleared
}

func offerMatchesStatisticsFilters(
	offer map[string]any,
	p dashboardAnalyticsParams,
	metrics statisticsOfferMetrics,
) bool {
	if p.Direction != "" && !strings.EqualFold(offerString(offer, "direction"), p.Direction) {
		return false
	}
	if len(p.ExcludedExchanges) > 0 {
		exchange := strings.ToLower(strings.TrimSpace(offerString(offer, "exchange")))
		for _, excluded := range p.ExcludedExchanges {
			if exchange == excluded {
				return false
			}
		}
	}
	if p.PaymentScope == "linked" {
		if len(p.IncludePaymentMethods) == 0 || !offerHasIncludedPaymentMethod(offer, p.IncludePaymentMethods) {
			return false
		}
	} else if len(p.IncludePaymentMethods) > 0 && !offerHasIncludedPaymentMethod(offer, p.IncludePaymentMethods) {
		return false
	}

	mode := p.statisticsPremiumMode()
	premium, hasPremium := metrics.premium(mode)
	if p.PremiumOnly != nil && *p.PremiumOnly {
		if !hasPremium || premium <= 0 {
			return false
		}
	}
	if p.RangeMetric == "premium" {
		if p.PremiumMin != nil && (!hasPremium || premium < *p.PremiumMin) {
			return false
		}
		if p.PremiumMax != nil && (!hasPremium || premium > *p.PremiumMax) {
			return false
		}
	}
	if p.RangeMetric == "profit" {
		profit, _ := metrics.profit(mode)
		if p.ProfitMin != nil && profit < *p.ProfitMin {
			return false
		}
		if p.ProfitMax != nil && profit > *p.ProfitMax {
			return false
		}
	}
	return true
}

func offerHasIncludedPaymentMethod(offer map[string]any, included []string) bool {
	if len(included) == 0 {
		return true
	}
	allowed := make(map[string]struct{}, len(included))
	for _, method := range included {
		allowed[method] = struct{}{}
	}
	for _, method := range offerStringSlice(offer, "payment_methods") {
		if _, ok := allowed[method]; ok {
			return true
		}
	}
	return false
}

func filterStatisticsContext(ctx statisticsContext, p dashboardAnalyticsParams) statisticsContext {
	if !p.hasOfferFilters() || len(ctx.offers) == 0 {
		return ctx
	}
	filteredOffers := make([]map[string]any, 0, len(ctx.offers))
	filteredGeneral := make([]pastorders.Offer, 0, len(ctx.generalOffers))
	mode := p.statisticsPremiumMode()
	for i, offer := range ctx.offers {
		metrics := computeStatisticsOfferMetrics(offer, ctx.liveLifecycle, p.MaxFiatLimitEUR)
		if !offerMatchesStatisticsFilters(offer, p, metrics) {
			continue
		}
		filteredOffers = append(filteredOffers, offer)
		if i < len(ctx.generalOffers) {
			general := ctx.generalOffers[i]
			if premium, ok := metrics.premium(mode); ok {
				value := premium
				general.PriceDiffPercent = &value
			} else {
				general.PriceDiffPercent = nil
			}
			filteredGeneral = append(filteredGeneral, general)
		}
	}
	ctx.offers = filteredOffers
	ctx.generalOffers = filteredGeneral
	return ctx
}
