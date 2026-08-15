package pastorders

import (
	"math"
	"sort"
	"time"
)

// Timeframe represents a timeframe.
type Timeframe struct {
	// Label is the label value for the timeframe.
	Label string
	// Hours is the hours value for the timeframe.
	Hours int
}

// DefaultTimeframes lists the standard reporting windows.
var DefaultTimeframes = []Timeframe{
	{Label: "1h", Hours: 1},
	{Label: "6h", Hours: 6},
	{Label: "24h", Hours: 24},
	{Label: "48h", Hours: 48},
	{Label: "7d", Hours: 168},
}

// PremiumOrder represents a premium order.
type PremiumOrder struct {
	// PaymentMethods lists the payment methods accepted.
	PaymentMethods []string
	// LastSeen is the last seen value for the premium order.
	LastSeen time.Time
	// BTCAmount is a BTC-denominated btcamount value.
	BTCAmount float64
	// NetProfitBTC is a BTC-denominated net profit btc value.
	NetProfitBTC float64
	// NetProfitFiat is a fiat-denominated net profit fiat value.
	NetProfitFiat float64
	// BTCAmountCapped is set when the order exceeded a max fiat limit.
	BTCAmountCapped float64
	// NetProfitBTCCapped is a BTC-denominated net profit btccapped value.
	NetProfitBTCCapped float64
	// NetProfitFiatCapped is a fiat-denominated net profit fiat capped value.
	NetProfitFiatCapped float64
	// HasCap reports whether the premium order condition is true.
	HasCap bool
}

// StatsResponse represents a stats response.
type StatsResponse struct {
	// FiatCurrency is a fiat-denominated fiat currency value.
	FiatCurrency string `json:"fiat_currency"`
	// ExcludedPaymentMethods is the excluded payment methods value for the stats response.
	ExcludedPaymentMethods []string `json:"excluded_payment_methods"`
	// Timeframes records the relevant time for the stats response.
	Timeframes []TimeframeStats `json:"timeframes"`
}

// TimeframeStats represents a timeframe stats.
type TimeframeStats struct {
	// Timeframe records the relevant time for the timeframe stats.
	Timeframe string `json:"timeframe"`
	// Hours is the hours value for the timeframe stats.
	Hours int `json:"hours"`
	// PremiumOrderCount is the count associated with the timeframe stats.
	PremiumOrderCount int `json:"premium_order_count"`
	// TotalProfitBTC is a BTC-denominated total profit btc value.
	TotalProfitBTC float64 `json:"total_net_profit_btc"`
	// TotalProfitFiat is a fiat-denominated total profit fiat value.
	TotalProfitFiat float64 `json:"total_net_profit_fiat"`
	// AverageOrderBTC is a BTC-denominated average order btc value.
	AverageOrderBTC float64 `json:"average_order_size_btc"`
	// SmallestOrderBTC is a BTC-denominated smallest order btc value.
	SmallestOrderBTC float64 `json:"smallest_order_size_btc"`
	// BiggestOrderBTC is a BTC-denominated biggest order btc value.
	BiggestOrderBTC float64 `json:"biggest_order_size_btc"`
	// TotalProfitBTCCapped is set when at least one order in the window was capped by a max fiat limit.
	TotalProfitBTCCapped *float64 `json:"total_net_profit_btc_capped,omitempty"`
	// TotalProfitFiatCapped is a fiat-denominated total profit fiat capped value.
	TotalProfitFiatCapped *float64 `json:"total_net_profit_fiat_capped,omitempty"`
	// AverageOrderBTCCapped is a BTC-denominated average order btccapped value.
	AverageOrderBTCCapped *float64 `json:"average_order_size_btc_capped,omitempty"`
}

// Offer is a normalized DEX offer used by this package.
type Offer struct {
	// Exchange is the exchange value for the offer.
	Exchange string
	// Direction is the direction value for the offer.
	Direction string
	// PaymentMethods lists the payment methods accepted by the offer.
	PaymentMethods []string
	// PriceDiffPercent is a percentage value.
	PriceDiffPercent *float64
	// FirstSeen is the first seen value for the offer.
	FirstSeen time.Time
	// LastSeen is the last seen value for the offer.
	LastSeen time.Time
	// IsLive reports whether the offer condition is true.
	IsLive bool
}

// GeneralStatsOverview represents a general stats overview.
type GeneralStatsOverview struct {
	// TotalOffers is the total offers value for the general stats overview.
	TotalOffers int `json:"total_offers"`
	// ActiveOffers is the active offers value for the general stats overview.
	ActiveOffers int `json:"active_offers"`
	// ExchangesLive is the exchanges live value for the general stats overview.
	ExchangesLive int `json:"exchanges_live"`
	// OffersByExchange is the offers by exchange value for the general stats overview.
	OffersByExchange []Count `json:"offers_by_exchange"`
	// PaymentMethodCounts is the count associated with the general stats overview.
	PaymentMethodCounts []Count `json:"payment_method_counts"`
}

// GeneralStatsPremiumSummary represents a general stats premium summary.
type GeneralStatsPremiumSummary struct {
	// BestAskPremiumPct is a percentage value.
	BestAskPremiumPct *float64 `json:"best_ask_premium_pct"`
	// AvgAskPremiumPct is a percentage value.
	AvgAskPremiumPct *float64 `json:"avg_ask_premium_pct"`
	// BestBidPremiumPct is a percentage value.
	BestBidPremiumPct *float64 `json:"best_bid_premium_pct"`
	// AvgBidPremiumPct is a percentage value.
	AvgBidPremiumPct *float64 `json:"avg_bid_premium_pct"`
}

// GeneralStatsResponse represents a general stats response.
type GeneralStatsResponse struct {
	// TotalOffers is the total offers value for the general stats response.
	TotalOffers int `json:"total_offers"`
	// ActiveOffers is the active offers value for the general stats response.
	ActiveOffers int `json:"active_offers"`
	// ExchangesLive is the exchanges live value for the general stats response.
	ExchangesLive int `json:"exchanges_live"`
	// OffersByExchange is the offers by exchange value for the general stats response.
	OffersByExchange []Count `json:"offers_by_exchange"`
	// BestAskPremiumPct is a percentage value.
	BestAskPremiumPct *float64 `json:"best_ask_premium_pct"`
	// AvgAskPremiumPct is a percentage value.
	AvgAskPremiumPct *float64 `json:"avg_ask_premium_pct"`
	// BestBidPremiumPct is a percentage value.
	BestBidPremiumPct *float64 `json:"best_bid_premium_pct"`
	// AvgBidPremiumPct is a percentage value.
	AvgBidPremiumPct *float64 `json:"avg_bid_premium_pct"`
	// AvgOfferLifetimeMs records the relevant time for the general stats response.
	AvgOfferLifetimeMs *int64 `json:"avg_offer_lifetime_ms"`
	// AvgOfferLifetimeMsByExchange records the relevant time for the general stats response.
	AvgOfferLifetimeMsByExchange []NamedDuration `json:"avg_offer_lifetime_ms_by_exchange"`
	// PremiumLifetimes records the relevant time for the general stats response.
	PremiumLifetimes PremiumLifetimeModes `json:"premium_lifetimes"`
	// PaymentMethodCounts is the count associated with the general stats response.
	PaymentMethodCounts []Count `json:"payment_method_counts"`
	// PastPremiums is the past premiums value for the general stats response.
	PastPremiums []PastPremiumTimeframeStats `json:"past_premiums"`
}

// PremiumLifetimeStats represents a premium lifetime stats.
type PremiumLifetimeStats struct {
	// AvgOfferLifetimeMs records the relevant time for the premium lifetime stats.
	AvgOfferLifetimeMs *int64 `json:"avg_offer_lifetime_ms"`
	// AvgOfferLifetimeMsByExchange records the relevant time for the premium lifetime stats.
	AvgOfferLifetimeMsByExchange []NamedDuration `json:"avg_offer_lifetime_ms_by_exchange"`
}

// PremiumLifetimeModes represents a premium lifetime modes.
type PremiumLifetimeModes struct {
	// Raw preserves additional source data for the premium lifetime modes.
	Raw PremiumLifetimeStats `json:"raw"`
	// NetFull is the net full value for the premium lifetime modes.
	NetFull PremiumLifetimeStats `json:"net_full"`
	// NetCapped is the net capped value for the premium lifetime modes.
	NetCapped PremiumLifetimeStats `json:"net_capped"`
}

// NamedDuration represents a named duration.
type NamedDuration struct {
	// Name is the name value for the named duration.
	Name string `json:"name"`
	// Ms is the ms value for the named duration.
	Ms int64 `json:"ms"`
}

// NamedPremium represents a named premium.
type NamedPremium struct {
	// Name is the name value for the named premium.
	Name string `json:"name"`
	// AvgPremiumPct is a percentage value.
	AvgPremiumPct float64 `json:"avg_premium_pct"`
}

// PastPremiumTimeframeStats represents a past premium timeframe stats.
type PastPremiumTimeframeStats struct {
	// Timeframe records the relevant time for the past premium timeframe stats.
	Timeframe string `json:"timeframe"`
	// Hours is the hours value for the past premium timeframe stats.
	Hours int `json:"hours"`
	// AvgPremiumByExchange is the avg premium by exchange value for the past premium timeframe stats.
	AvgPremiumByExchange []NamedPremium `json:"avg_premium_by_exchange,omitempty"`
	// Modes is the modes value for the past premium timeframe stats.
	Modes PastPremiumModes `json:"modes"`
}

// PastPremiumModes represents a past premium modes.
type PastPremiumModes struct {
	// Raw preserves additional source data for the past premium modes.
	Raw []NamedPremium `json:"raw"`
	// NetFull is the net full value for the past premium modes.
	NetFull []NamedPremium `json:"net_full"`
	// NetCapped is the net capped value for the past premium modes.
	NetCapped []NamedPremium `json:"net_capped"`
}

// Count represents a count.
type Count struct {
	// Name is the name value for the count.
	Name string `json:"name"`
	// Count is the count associated with the count.
	Count int `json:"count"`
}

// BuildStats builds a stats.
func BuildStats(orders []PremiumOrder, now time.Time, fiatCurrency string, excludedPaymentMethods []string) StatsResponse {
	if now.IsZero() {
		now = time.Now()
	}

	excluded := make(map[string]struct{}, len(excludedPaymentMethods))
	for _, method := range excludedPaymentMethods {
		excluded[method] = struct{}{}
	}

	stats := make([]TimeframeStats, 0, len(DefaultTimeframes))
	for _, tf := range DefaultTimeframes {
		stats = append(stats, buildTimeframeStats(orders, now, tf, excluded))
	}

	return StatsResponse{
		FiatCurrency:           fiatCurrency,
		ExcludedPaymentMethods: excludedPaymentMethods,
		Timeframes:             stats,
	}
}

// PastPremiumTimeframes is the past premium timeframes value.
var PastPremiumTimeframes = []Timeframe{
	{Label: "6h", Hours: 6},
	{Label: "24h", Hours: 24},
	{Label: "48h", Hours: 48},
	{Label: "7d", Hours: 168},
}

func filterGeneralStatsOffers(offers []Offer, now time.Time, hours int, excludedPaymentMethods []string) []Offer {
	if now.IsZero() {
		now = time.Now()
	}
	if hours <= 0 {
		hours = 24
	}

	excluded := make(map[string]struct{}, len(excludedPaymentMethods))
	for _, method := range excludedPaymentMethods {
		excluded[method] = struct{}{}
	}

	filtered := make([]Offer, 0, len(offers))
	for _, offer := range offers {
		if hasExcludedMethod(offer.PaymentMethods, excluded) {
			continue
		}
		filtered = append(filtered, offer)
	}

	cutoff := now.Add(-time.Duration(hours) * time.Hour)
	windowed := make([]Offer, 0, len(filtered))
	for _, offer := range filtered {
		if offer.LastSeen.IsZero() || offer.LastSeen.Before(cutoff) {
			continue
		}
		windowed = append(windowed, offer)
	}
	return windowed
}

func latestOfferTimeByExchange(offers []Offer) map[string]time.Time {
	lastSeenByExchange := make(map[string]time.Time)
	for _, offer := range offers {
		if offer.Exchange == "" || offer.LastSeen.IsZero() {
			continue
		}
		if offer.LastSeen.After(lastSeenByExchange[offer.Exchange]) {
			lastSeenByExchange[offer.Exchange] = offer.LastSeen
		}
	}
	return lastSeenByExchange
}

func isCurrentExchangeOffer(offer Offer, lastSeenByExchange map[string]time.Time) bool {
	return !offer.LastSeen.IsZero() && offer.LastSeen.Equal(lastSeenByExchange[offer.Exchange])
}

// BuildGeneralStatsOverview builds a general stats overview.
func BuildGeneralStatsOverview(offers []Offer, now time.Time, hours int, excludedPaymentMethods []string) GeneralStatsOverview {
	windowed := filterGeneralStatsOffers(offers, now, hours, excludedPaymentMethods)
	lastSeenByExchange := latestOfferTimeByExchange(windowed)

	var activeOffers int
	exchangesLive := make(map[string]struct{})
	paymentCounts := make(map[string]int)
	offersByExchange := make(map[string]int)

	for _, offer := range windowed {
		if !isCurrentExchangeOffer(offer, lastSeenByExchange) {
			continue
		}
		activeOffers++
		exchangesLive[offer.Exchange] = struct{}{}
		if offer.Exchange != "" {
			offersByExchange[offer.Exchange]++
		}
		for _, m := range offer.PaymentMethods {
			paymentCounts[m]++
		}
	}

	return GeneralStatsOverview{
		TotalOffers:         len(windowed),
		ActiveOffers:        activeOffers,
		ExchangesLive:       len(exchangesLive),
		OffersByExchange:    sortedCounts(offersByExchange),
		PaymentMethodCounts: sortedCounts(paymentCounts),
	}
}

// BuildGeneralStatsPremiumSummary builds a general stats premium summary.
func BuildGeneralStatsPremiumSummary(offers []Offer, now time.Time, hours int, excludedPaymentMethods []string) GeneralStatsPremiumSummary {
	windowed := filterGeneralStatsOffers(offers, now, hours, excludedPaymentMethods)
	lastSeenByExchange := latestOfferTimeByExchange(windowed)

	var askPremiumSum float64
	var askPremiumCount int
	var bestAskPremium *float64
	var bidPremiumSum float64
	var bidPremiumCount int
	var bestBidPremium *float64

	for _, offer := range windowed {
		if !isCurrentExchangeOffer(offer, lastSeenByExchange) || offer.PriceDiffPercent == nil {
			continue
		}
		premium := *offer.PriceDiffPercent
		if offer.Direction == "ask" {
			askPremiumSum += premium
			askPremiumCount++
			if bestAskPremium == nil || premium > *bestAskPremium {
				v := premium
				bestAskPremium = &v
			}
		}
		if offer.Direction == "bid" {
			bidPremiumSum += premium
			bidPremiumCount++
			if bestBidPremium == nil || premium > *bestBidPremium {
				v := premium
				bestBidPremium = &v
			}
		}
	}

	var avgAskPremium *float64
	if askPremiumCount > 0 {
		v := askPremiumSum / float64(askPremiumCount)
		avgAskPremium = &v
	}

	var avgBidPremium *float64
	if bidPremiumCount > 0 {
		v := bidPremiumSum / float64(bidPremiumCount)
		avgBidPremium = &v
	}

	return GeneralStatsPremiumSummary{
		BestAskPremiumPct: bestAskPremium,
		AvgAskPremiumPct:  avgAskPremium,
		BestBidPremiumPct: bestBidPremium,
		AvgBidPremiumPct:  avgBidPremium,
	}
}

// NewGeneralStatsResponse creates a general stats response.
func NewGeneralStatsResponse(overview GeneralStatsOverview, premiumSummary GeneralStatsPremiumSummary) GeneralStatsResponse {
	return GeneralStatsResponse{
		TotalOffers:         overview.TotalOffers,
		ActiveOffers:        overview.ActiveOffers,
		ExchangesLive:       overview.ExchangesLive,
		OffersByExchange:    overview.OffersByExchange,
		PaymentMethodCounts: overview.PaymentMethodCounts,
		BestAskPremiumPct:   premiumSummary.BestAskPremiumPct,
		AvgAskPremiumPct:    premiumSummary.AvgAskPremiumPct,
		BestBidPremiumPct:   premiumSummary.BestBidPremiumPct,
		AvgBidPremiumPct:    premiumSummary.AvgBidPremiumPct,
	}
}

// BuildGeneralStats builds a general stats.
func BuildGeneralStats(offers []Offer, now time.Time, hours int, excludedPaymentMethods []string) GeneralStatsResponse {
	return NewGeneralStatsResponse(
		BuildGeneralStatsOverview(offers, now, hours, excludedPaymentMethods),
		GeneralStatsPremiumSummary{},
	)
}

// TODO: write comments and document this function in a new readme file
func buildTimeframeStats(orders []PremiumOrder, now time.Time, tf Timeframe, excluded map[string]struct{}) TimeframeStats {
	cutoff := now.Add(-time.Duration(tf.Hours) * time.Hour)

	var count int
	var totalProfitBTC, totalProfitFiat, totalOrderBTC float64
	var minOrderBTC, maxOrderBTC float64
	var cappedTotalProfitBTC, cappedTotalProfitFiat, cappedTotalOrderBTC float64
	cappedCount := 0

	for _, order := range orders {
		if order.LastSeen.Before(cutoff) {
			continue
		}
		if hasExcludedMethod(order.PaymentMethods, excluded) {
			continue
		}

		count++
		totalProfitBTC += order.NetProfitBTC
		totalProfitFiat += order.NetProfitFiat
		totalOrderBTC += order.BTCAmount

		if minOrderBTC == 0 || order.BTCAmount < minOrderBTC {
			minOrderBTC = order.BTCAmount
		}
		if order.BTCAmount > maxOrderBTC {
			maxOrderBTC = order.BTCAmount
		}

		// accumulate capped sums: orders exceeding the cap use capped values,
		// orders already under the cap contribute their full values unchanged
		if order.HasCap {
			cappedTotalProfitBTC += order.NetProfitBTCCapped
			cappedTotalProfitFiat += order.NetProfitFiatCapped
			cappedTotalOrderBTC += order.BTCAmountCapped
			cappedCount++
		} else {
			cappedTotalProfitBTC += order.NetProfitBTC
			cappedTotalProfitFiat += order.NetProfitFiat
			cappedTotalOrderBTC += order.BTCAmount
		}
	}

	avgOrderBTC := 0.0
	if count > 0 {
		avgOrderBTC = totalOrderBTC / float64(count)
	}

	ts := TimeframeStats{
		Timeframe:         tf.Label,
		Hours:             tf.Hours,
		PremiumOrderCount: count,
		TotalProfitBTC:    round(totalProfitBTC, 8),
		TotalProfitFiat:   round(totalProfitFiat, 2),
		AverageOrderBTC:   round(avgOrderBTC, 8),
		SmallestOrderBTC:  round(minOrderBTC, 8),
		BiggestOrderBTC:   round(maxOrderBTC, 8),
	}

	// only populate capped fields when at least one order was actually reduced
	if cappedCount > 0 {
		cappedAvg := 0.0
		if count > 0 {
			cappedAvg = cappedTotalOrderBTC / float64(count)
		}
		v1 := round(cappedTotalProfitBTC, 8)
		v2 := round(cappedTotalProfitFiat, 2)
		v3 := round(cappedAvg, 8)
		ts.TotalProfitBTCCapped = &v1
		ts.TotalProfitFiatCapped = &v2
		ts.AverageOrderBTCCapped = &v3
	}

	return ts
}

func sortedCounts(counts map[string]int) []Count {
	result := make([]Count, 0, len(counts))
	for name, count := range counts {
		result = append(result, Count{Name: name, Count: count})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Count == result[j].Count {
			return result[i].Name < result[j].Name
		}
		return result[i].Count > result[j].Count
	})
	return result
}

func round(v float64, places int) float64 {
	pow := math.Pow10(places)
	return math.Round(v*pow) / pow
}

func hasExcludedMethod(methods []string, excluded map[string]struct{}) bool {
	for _, m := range methods {
		if _, skip := excluded[m]; skip {
			return true
		}
	}
	return false
}
