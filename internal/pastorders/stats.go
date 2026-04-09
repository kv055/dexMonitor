package pastorders

import (
	"math"
	"sort"
	"time"
)

type Timeframe struct {
	Label string
	Hours int
}

var DefaultTimeframes = []Timeframe{
	{Label: "1h", Hours: 1},
	{Label: "6h", Hours: 6},
	{Label: "24h", Hours: 24},
	{Label: "48h", Hours: 48},
	{Label: "7d", Hours: 168},
}

type PremiumOrder struct {
	PaymentMethod string
	LastSeen      time.Time
	BTCAmount     float64
	NetProfitBTC  float64
	NetProfitFiat float64
}

type StatsResponse struct {
	FiatCurrency           string           `json:"fiat_currency"`
	ExcludedPaymentMethods []string         `json:"excluded_payment_methods"`
	Timeframes             []TimeframeStats `json:"timeframes"`
}

type TimeframeStats struct {
	Timeframe         string  `json:"timeframe"`
	Hours             int     `json:"hours"`
	PremiumOrderCount int     `json:"premium_order_count"`
	TotalProfitBTC    float64 `json:"total_net_profit_btc"`
	TotalProfitFiat   float64 `json:"total_net_profit_fiat"`
	AverageOrderBTC   float64 `json:"average_order_size_btc"`
	SmallestOrderBTC  float64 `json:"smallest_order_size_btc"`
	BiggestOrderBTC   float64 `json:"biggest_order_size_btc"`
}

type Offer struct {
	Exchange         string
	Direction        string
	PaymentMethod    string
	PriceDiffPercent *float64
	FirstSeen        time.Time
	LastSeen         time.Time
	IsLive           bool
}

type GeneralStatsResponse struct {
	TotalOffers                  int                         `json:"total_offers"`
	ActiveOffers                 int                         `json:"active_offers"`
	ExchangesLive                int                         `json:"exchanges_live"`
	OffersByExchange             []Count                     `json:"offers_by_exchange"`
	BestAskPremiumPct            *float64                    `json:"best_ask_premium_pct"`
	AvgAskPremiumPct             *float64                    `json:"avg_ask_premium_pct"`
	BestBidPremiumPct            *float64                    `json:"best_bid_premium_pct"`
	AvgBidPremiumPct             *float64                    `json:"avg_bid_premium_pct"`
	AvgOfferLifetimeMs           *int64                      `json:"avg_offer_lifetime_ms"`
	AvgOfferLifetimeMsByExchange []NamedDuration             `json:"avg_offer_lifetime_ms_by_exchange"`
	PaymentMethodCounts          []Count                     `json:"payment_method_counts"`
	PastPremiums                 []PastPremiumTimeframeStats `json:"past_premiums"`
}

type NamedDuration struct {
	Name string `json:"name"`
	Ms   int64  `json:"ms"`
}

type NamedPremium struct {
	Name          string  `json:"name"`
	AvgPremiumPct float64 `json:"avg_premium_pct"`
}

type PastPremiumTimeframeStats struct {
	Timeframe            string         `json:"timeframe"`
	Hours                int            `json:"hours"`
	AvgPremiumByExchange []NamedPremium `json:"avg_premium_by_exchange"`
}

type Count struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}

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

var PastPremiumTimeframes = []Timeframe{
	{Label: "6h", Hours: 6},
	{Label: "24h", Hours: 24},
	{Label: "48h", Hours: 48},
	{Label: "7d", Hours: 168},
}

func BuildGeneralStats(offers []Offer, now time.Time, hours int, excludedPaymentMethods []string) GeneralStatsResponse {
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
		if _, skip := excluded[offer.PaymentMethod]; skip {
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

	lastSeenByExchange := make(map[string]time.Time)
	for _, offer := range windowed {
		if offer.Exchange == "" || offer.LastSeen.IsZero() {
			continue
		}
		if offer.LastSeen.After(lastSeenByExchange[offer.Exchange]) {
			lastSeenByExchange[offer.Exchange] = offer.LastSeen
		}
	}

	var activeOffers, closedOfferCount int
	var askPremiumSum float64
	var askPremiumCount int
	var bestAskPremium *float64
	var bidPremiumSum float64
	var bidPremiumCount int
	var bestBidPremium *float64
	var lifetimeSum time.Duration
	var lifetimeCount int
	lifetimeSumByExchange := make(map[string]time.Duration)
	lifetimeCountByExchange := make(map[string]int)
	exchangesLive := make(map[string]struct{})
	paymentMethods := make(map[string]struct{})
	paymentCounts := make(map[string]int)
	offersByExchange := make(map[string]int)

	for _, offer := range windowed {
		isActive := !offer.LastSeen.IsZero() && offer.LastSeen.Equal(lastSeenByExchange[offer.Exchange])
		if isActive {
			activeOffers++
			exchangesLive[offer.Exchange] = struct{}{}
			if offer.Exchange != "" {
				offersByExchange[offer.Exchange]++
			}
			if offer.PaymentMethod != "" {
				paymentMethods[offer.PaymentMethod] = struct{}{}
				paymentCounts[offer.PaymentMethod]++
			}
			if offer.Direction == "sell" && offer.PriceDiffPercent != nil {
				premium := *offer.PriceDiffPercent
				askPremiumSum += premium
				askPremiumCount++
				if bestAskPremium == nil || premium > *bestAskPremium {
					v := premium
					bestAskPremium = &v
				}
			}
			if offer.Direction == "buy" && offer.PriceDiffPercent != nil {
				premium := *offer.PriceDiffPercent
				bidPremiumSum += premium
				bidPremiumCount++
				if bestBidPremium == nil || premium > *bestBidPremium {
					v := premium
					bestBidPremium = &v
				}
			}
			continue
		}

		closedOfferCount++
		if !offer.FirstSeen.IsZero() && !offer.LastSeen.IsZero() {
			lifetime := offer.LastSeen.Sub(offer.FirstSeen)
			if lifetime > 0 {
				lifetimeSum += lifetime
				lifetimeCount++
				if offer.Exchange != "" {
					lifetimeSumByExchange[offer.Exchange] += lifetime
					lifetimeCountByExchange[offer.Exchange]++
				}
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

	var avgLifetimeMs *int64
	if lifetimeCount > 0 {
		v := int64(lifetimeSum / time.Duration(lifetimeCount) / time.Millisecond)
		avgLifetimeMs = &v
	}

	lifetimeByExchange := make([]NamedDuration, 0, len(lifetimeCountByExchange))
	for exchange, count := range lifetimeCountByExchange {
		ms := int64(lifetimeSumByExchange[exchange] / time.Duration(count) / time.Millisecond)
		lifetimeByExchange = append(lifetimeByExchange, NamedDuration{Name: exchange, Ms: ms})
	}
	sort.Slice(lifetimeByExchange, func(i, j int) bool {
		return lifetimeByExchange[i].Name < lifetimeByExchange[j].Name
	})

	return GeneralStatsResponse{
		TotalOffers:                  len(windowed),
		ActiveOffers:                 activeOffers,
		ExchangesLive:                len(exchangesLive),
		OffersByExchange:             sortedCounts(offersByExchange),
		BestAskPremiumPct:            bestAskPremium,
		AvgAskPremiumPct:             avgAskPremium,
		BestBidPremiumPct:            bestBidPremium,
		AvgBidPremiumPct:             avgBidPremium,
		AvgOfferLifetimeMs:           avgLifetimeMs,
		AvgOfferLifetimeMsByExchange: lifetimeByExchange,
		PaymentMethodCounts:          sortedCounts(paymentCounts),
		PastPremiums:                 buildPastPremiumTimeframes(filtered, now),
	}
}

func buildPastPremiumTimeframes(offers []Offer, now time.Time) []PastPremiumTimeframeStats {
	stats := make([]PastPremiumTimeframeStats, 0, len(PastPremiumTimeframes))
	for _, tf := range PastPremiumTimeframes {
		cutoff := now.Add(-time.Duration(tf.Hours) * time.Hour)
		sumByExchange := make(map[string]float64)
		countByExchange := make(map[string]int)

		for _, offer := range offers {
			if offer.IsLive || offer.Exchange == "" || offer.PriceDiffPercent == nil || offer.LastSeen.IsZero() || offer.LastSeen.Before(cutoff) {
				continue
			}
			sumByExchange[offer.Exchange] += *offer.PriceDiffPercent
			countByExchange[offer.Exchange]++
		}

		avgByExchange := make([]NamedPremium, 0, len(countByExchange))
		for exchange, count := range countByExchange {
			avg := math.Round((sumByExchange[exchange]/float64(count))*100) / 100
			avgByExchange = append(avgByExchange, NamedPremium{Name: exchange, AvgPremiumPct: avg})
		}
		sort.Slice(avgByExchange, func(i, j int) bool {
			return avgByExchange[i].Name < avgByExchange[j].Name
		})

		stats = append(stats, PastPremiumTimeframeStats{
			Timeframe:            tf.Label,
			Hours:                tf.Hours,
			AvgPremiumByExchange: avgByExchange,
		})
	}
	return stats
}

func buildTimeframeStats(orders []PremiumOrder, now time.Time, tf Timeframe, excluded map[string]struct{}) TimeframeStats {
	cutoff := now.Add(-time.Duration(tf.Hours) * time.Hour)

	var count int
	var totalProfitBTC, totalProfitFiat, totalOrderBTC float64
	var minOrderBTC, maxOrderBTC float64

	for _, order := range orders {
		if order.LastSeen.Before(cutoff) {
			continue
		}
		if _, skip := excluded[order.PaymentMethod]; skip {
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
	}

	avgOrderBTC := 0.0
	if count > 0 {
		avgOrderBTC = totalOrderBTC / float64(count)
	}

	return TimeframeStats{
		Timeframe:         tf.Label,
		Hours:             tf.Hours,
		PremiumOrderCount: count,
		TotalProfitBTC:    round(totalProfitBTC, 8),
		TotalProfitFiat:   round(totalProfitFiat, 2),
		AverageOrderBTC:   round(avgOrderBTC, 8),
		SmallestOrderBTC:  round(minOrderBTC, 8),
		BiggestOrderBTC:   round(maxOrderBTC, 8),
	}
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
