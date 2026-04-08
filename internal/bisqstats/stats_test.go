package bisqstats

import (
	"testing"
	"time"
)

// These tests only cover the aggregation/filtering layer. They do not exercise
// live Bisq persistence files; that parser is intentionally left as dormant
// code for future use.
func TestBuildResponse(t *testing.T) {
	now := time.Date(2026, 4, 8, 12, 0, 0, 0, time.UTC)
	records := []TradeRecord{
		{
			TradeID:            "a",
			PaymentMethodID:    "SEPA",
			FiatCurrency:       "EUR",
			TakeOfferAt:        now.Add(-5 * time.Hour),
			SellerConfirmedAt:  now.Add(-4 * time.Hour),
			SettlementDuration: time.Hour,
		},
		{
			TradeID:            "b",
			PaymentMethodID:    "SEPA",
			FiatCurrency:       "EUR",
			TakeOfferAt:        now.Add(-6 * time.Hour),
			SellerConfirmedAt:  now.Add(-3 * time.Hour),
			SettlementDuration: 3 * time.Hour,
		},
		{
			TradeID:            "c",
			PaymentMethodID:    "REVOLUT",
			FiatCurrency:       "EUR",
			TakeOfferAt:        now.Add(-7 * time.Hour),
			SellerConfirmedAt:  now.Add(-1 * time.Hour),
			SettlementDuration: 6 * time.Hour,
		},
	}

	resp := BuildResponse(records, map[string]int{"missing_take_offer_date": 2}, "/tmp/ClosedTrades", Query{Hours: 24}, now)

	if resp.CompletedTrades != 3 {
		t.Fatalf("completed trades = %d, want 3", resp.CompletedTrades)
	}
	if resp.Duration.MeanSeconds != int64((time.Hour+3*time.Hour+6*time.Hour)/3/time.Second) {
		t.Fatalf("mean seconds = %d", resp.Duration.MeanSeconds)
	}
	if resp.Duration.MedianSeconds != int64(3*time.Hour/time.Second) {
		t.Fatalf("median seconds = %d", resp.Duration.MedianSeconds)
	}
	if len(resp.ByPaymentMethod) != 2 {
		t.Fatalf("payment method groups = %d, want 2", len(resp.ByPaymentMethod))
	}
	if resp.ByPaymentMethod[0].Name != "SEPA" || resp.ByPaymentMethod[0].CompletedTrades != 2 {
		t.Fatalf("first group = %#v", resp.ByPaymentMethod[0])
	}
	if resp.SkippedTrades["missing_take_offer_date"] != 2 {
		t.Fatalf("skipped trades = %#v", resp.SkippedTrades)
	}
}

func TestBuildResponseFilters(t *testing.T) {
	now := time.Date(2026, 4, 8, 12, 0, 0, 0, time.UTC)
	records := []TradeRecord{
		{
			TradeID:            "a",
			PaymentMethodID:    "SEPA",
			FiatCurrency:       "EUR",
			TakeOfferAt:        now.Add(-30 * time.Hour),
			SellerConfirmedAt:  now.Add(-25 * time.Hour),
			SettlementDuration: 5 * time.Hour,
		},
		{
			TradeID:            "b",
			PaymentMethodID:    "REVOLUT",
			FiatCurrency:       "USD",
			TakeOfferAt:        now.Add(-4 * time.Hour),
			SellerConfirmedAt:  now.Add(-2 * time.Hour),
			SettlementDuration: 2 * time.Hour,
		},
	}

	resp := BuildResponse(records, nil, "/tmp/ClosedTrades", Query{
		Hours:         24,
		PaymentMethod: "revolut",
		Currency:      "usd",
	}, now)

	if resp.CompletedTrades != 1 {
		t.Fatalf("completed trades = %d, want 1", resp.CompletedTrades)
	}
	if len(resp.ByCurrency) != 1 || resp.ByCurrency[0].Name != "USD" {
		t.Fatalf("currency groups = %#v", resp.ByCurrency)
	}
}
