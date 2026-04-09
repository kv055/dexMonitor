package pastorders

import (
	"math"
	"testing"
	"time"
)

func TestBuildStatsAggregatesTimeframesAndExcludesPaymentMethods(t *testing.T) {
	now := time.Date(2026, 4, 7, 12, 0, 0, 0, time.UTC)
	stats := BuildStats([]PremiumOrder{
		{PaymentMethod: "Revolut", LastSeen: now.Add(-30 * time.Minute), BTCAmount: 0.1, NetProfitBTC: 0.001, NetProfitFiat: 60},
		{PaymentMethod: "Wise", LastSeen: now.Add(-5 * time.Hour), BTCAmount: 0.2, NetProfitBTC: 0.002, NetProfitFiat: 120},
		{PaymentMethod: "SEPA", LastSeen: now.Add(-30 * time.Hour), BTCAmount: 0.3, NetProfitBTC: 0.003, NetProfitFiat: 180},
	}, now, "EUR", []string{"Revolut"})

	if stats.FiatCurrency != "EUR" {
		t.Fatalf("fiat currency = %q, want EUR", stats.FiatCurrency)
	}

	oneHour := findTimeframe(t, stats.Timeframes, "1h")
	if oneHour.PremiumOrderCount != 0 {
		t.Fatalf("1h count = %d, want 0", oneHour.PremiumOrderCount)
	}

	sixHour := findTimeframe(t, stats.Timeframes, "6h")
	if sixHour.PremiumOrderCount != 1 {
		t.Fatalf("6h count = %d, want 1", sixHour.PremiumOrderCount)
	}
	assertStatFloat(t, sixHour.TotalProfitBTC, 0.002)
	assertStatFloat(t, sixHour.TotalProfitFiat, 120)
	assertStatFloat(t, sixHour.AverageOrderBTC, 0.2)
	assertStatFloat(t, sixHour.SmallestOrderBTC, 0.2)
	assertStatFloat(t, sixHour.BiggestOrderBTC, 0.2)

	sevenDay := findTimeframe(t, stats.Timeframes, "7d")
	if sevenDay.PremiumOrderCount != 2 {
		t.Fatalf("7d count = %d, want 2", sevenDay.PremiumOrderCount)
	}
	assertStatFloat(t, sevenDay.TotalProfitBTC, 0.005)
	assertStatFloat(t, sevenDay.TotalProfitFiat, 300)
	assertStatFloat(t, sevenDay.AverageOrderBTC, 0.25)
	assertStatFloat(t, sevenDay.SmallestOrderBTC, 0.2)
	assertStatFloat(t, sevenDay.BiggestOrderBTC, 0.3)
}

func TestBuildGeneralStatsMirrorsFrontendCalculations(t *testing.T) {
	now := time.Date(2026, 4, 7, 12, 0, 0, 0, time.UTC)
	premium3 := 3.0
	premium2 := 2.0
	premium5 := 5.0

	stats := BuildGeneralStats([]Offer{
		{
			Exchange: "bisq", Direction: "sell", PaymentMethod: "SEPA",
			PriceDiffPercent: &premium3, FirstSeen: now.Add(-3 * time.Hour), LastSeen: now,
		},
		{
			Exchange: "bisq", Direction: "buy", PaymentMethod: "Wise",
			PriceDiffPercent: &premium2, FirstSeen: now.Add(-5 * time.Hour), LastSeen: now.Add(-2 * time.Hour),
		},
		{
			Exchange: "robosats", Direction: "sell", PaymentMethod: "Revolut",
			PriceDiffPercent: &premium5, FirstSeen: now.Add(-30 * time.Minute), LastSeen: now,
		},
		{
			Exchange: "robosats", Direction: "sell", PaymentMethod: "Revolut",
			PriceDiffPercent: &premium2, FirstSeen: now.Add(-3 * time.Hour), LastSeen: now.Add(-1 * time.Hour),
		},
	}, now, 48, []string{"Wise"})

	if stats.TotalOffers != 3 {
		t.Fatalf("total offers = %d, want 3", stats.TotalOffers)
	}
	if stats.ActiveOffers != 2 {
		t.Fatalf("active offers = %d, want 2", stats.ActiveOffers)
	}
	if stats.ExchangesLive != 2 {
		t.Fatalf("exchanges live = %d, want 2", stats.ExchangesLive)
	}
	if len(stats.OffersByExchange) != 2 {
		t.Fatalf("offers by exchange len = %d, want 2", len(stats.OffersByExchange))
	}
	if stats.OffersByExchange[0].Name != "bisq" || stats.OffersByExchange[0].Count != 1 {
		t.Fatalf("first offers_by_exchange = %#v, want bisq=1", stats.OffersByExchange[0])
	}
	if stats.OffersByExchange[1].Name != "robosats" || stats.OffersByExchange[1].Count != 1 {
		t.Fatalf("second offers_by_exchange = %#v, want robosats=1", stats.OffersByExchange[1])
	}
	if stats.BestAskPremiumPct == nil {
		t.Fatal("best ask premium is nil")
	}
	assertStatFloat(t, *stats.BestAskPremiumPct, 5.0)
	if stats.AvgAskPremiumPct == nil {
		t.Fatal("avg ask premium is nil")
	}
	assertStatFloat(t, *stats.AvgAskPremiumPct, 4.0)
	if stats.AvgOfferLifetimeMs == nil {
		t.Fatal("avg lifetime is nil")
	}
	if *stats.AvgOfferLifetimeMs != int64(2*time.Hour/time.Millisecond) {
		t.Fatalf("avg lifetime ms = %d, want %d", *stats.AvgOfferLifetimeMs, int64(2*time.Hour/time.Millisecond))
	}
}

func TestBuildGeneralStatsIncludesPastPremiumsByFixedTimeframe(t *testing.T) {
	now := time.Date(2026, 4, 7, 12, 0, 0, 0, time.UTC)
	bisq6h := 3.0
	bisq24h := 5.0
	robo24h := 4.0
	robo7d := 6.0
	active := 7.0

	stats := BuildGeneralStats([]Offer{
		{
			Exchange: "bisq", Direction: "buy", PaymentMethod: "SEPA", PriceDiffPercent: &bisq6h,
			FirstSeen: now.Add(-5 * time.Hour), LastSeen: now.Add(-5 * time.Hour), IsLive: false,
		},
		{
			Exchange: "bisq", Direction: "sell", PaymentMethod: "Wise", PriceDiffPercent: &bisq24h,
			FirstSeen: now.Add(-20 * time.Hour), LastSeen: now.Add(-20 * time.Hour), IsLive: false,
		},
		{
			Exchange: "robosats", Direction: "buy", PaymentMethod: "Revolut", PriceDiffPercent: &robo24h,
			FirstSeen: now.Add(-10 * time.Hour), LastSeen: now.Add(-10 * time.Hour), IsLive: false,
		},
		{
			Exchange: "robosats", Direction: "sell", PaymentMethod: "Revolut", PriceDiffPercent: &robo7d,
			FirstSeen: now.Add(-5 * 24 * time.Hour), LastSeen: now.Add(-5 * 24 * time.Hour), IsLive: false,
		},
		{
			Exchange: "bisq", Direction: "buy", PaymentMethod: "SEPA", PriceDiffPercent: &active,
			FirstSeen: now.Add(-30 * time.Minute), LastSeen: now.Add(-30 * time.Minute), IsLive: true,
		},
	}, now, 24, nil)

	sixHour := findPastPremiumTimeframe(t, stats.PastPremiums, "6h")
	if len(sixHour.AvgPremiumByExchange) != 1 || sixHour.AvgPremiumByExchange[0].Name != "bisq" {
		t.Fatalf("6h avg premium exchanges = %#v, want [bisq]", sixHour.AvgPremiumByExchange)
	}
	assertStatFloat(t, sixHour.AvgPremiumByExchange[0].AvgPremiumPct, 3.0)

	twentyFourHour := findPastPremiumTimeframe(t, stats.PastPremiums, "24h")
	if len(twentyFourHour.AvgPremiumByExchange) != 2 {
		t.Fatalf("24h avg premium exchanges len = %d, want 2", len(twentyFourHour.AvgPremiumByExchange))
	}
	assertStatFloat(t, twentyFourHour.AvgPremiumByExchange[0].AvgPremiumPct, 4.0)
	assertStatFloat(t, twentyFourHour.AvgPremiumByExchange[1].AvgPremiumPct, 4.0)

	sevenDay := findPastPremiumTimeframe(t, stats.PastPremiums, "7d")
	if len(sevenDay.AvgPremiumByExchange) != 2 {
		t.Fatalf("7d avg premium exchanges len = %d, want 2", len(sevenDay.AvgPremiumByExchange))
	}
	assertStatFloat(t, sevenDay.AvgPremiumByExchange[0].AvgPremiumPct, 4.0)
	assertStatFloat(t, sevenDay.AvgPremiumByExchange[1].AvgPremiumPct, 5.0)
}

func findTimeframe(t *testing.T, timeframes []TimeframeStats, label string) TimeframeStats {
	t.Helper()
	for _, timeframe := range timeframes {
		if timeframe.Timeframe == label {
			return timeframe
		}
	}
	t.Fatalf("timeframe %q not found in %#v", label, timeframes)
	return TimeframeStats{}
}

func findPastPremiumTimeframe(t *testing.T, timeframes []PastPremiumTimeframeStats, label string) PastPremiumTimeframeStats {
	t.Helper()
	for _, timeframe := range timeframes {
		if timeframe.Timeframe == label {
			return timeframe
		}
	}
	t.Fatalf("past premium timeframe %q not found in %#v", label, timeframes)
	return PastPremiumTimeframeStats{}
}

func assertStatFloat(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("got %.12f, want %.12f", got, want)
	}
}
