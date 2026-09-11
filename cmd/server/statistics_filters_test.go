package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOfferMatchesStatisticsFiltersDirectionExchangeAndPayment(t *testing.T) {
	offer := map[string]any{
		"exchange": "robosats", "direction": "ask",
		"avg_premium_pct": 2.5, "avg_net_premium_pct": 1.5,
		"avg_estimated_profit_fiat": 4.2,
		"payment_methods":           []string{"SEPA Instant", "Revolut"},
		"btc_max":                   0.1,
	}
	metrics := computeStatisticsOfferMetrics(offer, nil, 0)
	premiumOnly := true

	if !offerMatchesStatisticsFilters(offer, dashboardAnalyticsParams{}, metrics) {
		t.Fatal("empty filters should keep the offer")
	}
	if offerMatchesStatisticsFilters(offer, dashboardAnalyticsParams{Direction: "bid"}, metrics) {
		t.Fatal("bid filter should drop an ask")
	}
	if !offerMatchesStatisticsFilters(offer, dashboardAnalyticsParams{Direction: "ask"}, metrics) {
		t.Fatal("ask filter should keep an ask")
	}
	if offerMatchesStatisticsFilters(offer, dashboardAnalyticsParams{ExcludedExchanges: []string{"robosats"}}, metrics) {
		t.Fatal("excluded exchange should drop the offer")
	}
	if offerMatchesStatisticsFilters(offer, dashboardAnalyticsParams{IncludePaymentMethods: []string{"Wise"}}, metrics) {
		t.Fatal("linked methods that do not match should drop the offer")
	}
	if !offerMatchesStatisticsFilters(offer, dashboardAnalyticsParams{IncludePaymentMethods: []string{"Revolut"}}, metrics) {
		t.Fatal("matching linked method should keep the offer")
	}
	if offerMatchesStatisticsFilters(offer, dashboardAnalyticsParams{PremiumOnly: &premiumOnly, PremiumMode: "net_full", RangeMetric: "profit", ProfitMin: floatPtr(10)}, metrics) {
		t.Fatal("profit min above the offer should drop it")
	}
	if !offerMatchesStatisticsFilters(offer, dashboardAnalyticsParams{PremiumOnly: &premiumOnly, PremiumMode: "net_full", RangeMetric: "premium", PremiumMin: floatPtr(1), PremiumMax: floatPtr(2)}, metrics) {
		t.Fatal("net premium 1.5 should stay inside 1–2")
	}
}

func TestBuildOfferLifecyclePremiumPointsUsesSelectedPremiumMode(t *testing.T) {
	now := time.Date(2026, time.July, 14, 12, 0, 0, 0, time.UTC)
	offers := []map[string]any{
		{
			"exchange": "robosats", "direction": "ask",
			"avg_premium_pct": 2.5, "avg_net_premium_pct": 1.25,
			"btc_max":    0.15,
			"first_seen": now.Add(-90 * time.Minute),
			"last_seen":  now.Add(-10 * time.Minute),
			"is_live":    true,
		},
	}
	live, _ := buildOfferLifecyclePremiumPoints(offers, now, 24, nil, nil, "net_full", 0)
	if len(live) != 1 {
		t.Fatalf("live points = %d, want 1", len(live))
	}
	if live[0].PremiumRatePct != 1.25 {
		t.Fatalf("net_full premium = %v, want 1.25", live[0].PremiumRatePct)
	}
}

func TestStatisticsRESTAppliesOfferFiltersWithoutBustingContextCache(t *testing.T) {
	withTempOrdersDB(t)
	resetStatisticsCache()

	if _, err := db.Exec(`
		INSERT INTO offers (exchange, direction, price, btc_min, btc_max, payment_method, payment_methods, offer_id, avg_ref_price, avg_premium_pct, avg_net_premium_pct, avg_estimated_profit_fiat, first_seen, last_seen, is_live)
		VALUES
		('robosats', 'ask', 103, 0.1, 0.2, 'SEPA Instant', json('["SEPA Instant"]'), 'rs-ask', 100, 3, 2.2, 5, datetime('now', '-20 minutes'), datetime('now', '-20 minutes'), 1),
		('hodlhodl', 'bid', 97, 0.1, 0.2, 'Revolut', json('["Revolut"]'), 'hh-bid', 100, 1.5, 0.8, 1, datetime('now', '-20 minutes'), datetime('now', '-20 minutes'), 1)
	`); err != nil {
		t.Fatalf("insert offers: %v", err)
	}

	unfilteredReq := httptest.NewRequest(http.MethodPost, "/api/statistics", strings.NewReader(`{"hours":48,"cex":"kraken","fiat":"EUR"}`))
	unfilteredReq.Header.Set("Content-Type", "application/json")
	unfilteredRec := httptest.NewRecorder()
	handleStatistics(unfilteredRec, unfilteredReq)
	if unfilteredRec.Code != http.StatusOK {
		t.Fatalf("unfiltered status = %d body=%s", unfilteredRec.Code, unfilteredRec.Body.String())
	}

	filteredBody := `{"hours":48,"cex":"kraken","fiat":"EUR","direction":"ask","excluded_exchanges":["hodlhodl"],"premium_mode":"net_full","premium_only":true}`
	filteredReq := httptest.NewRequest(http.MethodPost, "/api/statistics", strings.NewReader(filteredBody))
	filteredReq.Header.Set("Content-Type", "application/json")
	filteredRec := httptest.NewRecorder()
	handleStatistics(filteredRec, filteredReq)
	if filteredRec.Code != http.StatusOK {
		t.Fatalf("filtered status = %d body=%s", filteredRec.Code, filteredRec.Body.String())
	}
	if got := filteredRec.Header().Get(statisticsCacheHeader); got != string(statisticsCacheStatusHit) {
		t.Fatalf("filtered %s = %q, want hit of the unfiltered context", statisticsCacheHeader, got)
	}

	var resp statisticsResponse
	if err := json.Unmarshal(filteredRec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode filtered response: %v", err)
	}
	if resp.Live.ActiveOffers != 1 {
		t.Fatalf("live active = %d, want 1 ask after filters", resp.Live.ActiveOffers)
	}
	if len(resp.Live.OfferLifecyclePoints) != 1 || resp.Live.OfferLifecyclePoints[0].Exchange != "robosats" {
		t.Fatalf("live points = %#v, want robosats only", resp.Live.OfferLifecyclePoints)
	}
	if resp.Live.OfferLifecyclePoints[0].PremiumRatePct != 2.2 {
		t.Fatalf("scatter Y = %v, want net_full 2.2", resp.Live.OfferLifecyclePoints[0].PremiumRatePct)
	}
}

func floatPtr(v float64) *float64 { return &v }

func TestStatisticsOfferMetricsFallsBackToRawWhenLiveNetIsNull(t *testing.T) {
	now := time.Now()
	offer := map[string]any{
		"id": int64(9), "exchange": "robosats", "direction": "ask", "price": 103.0,
		"btc_max": 0.2, "is_live": true,
		"first_seen": now.Add(-time.Hour), "last_seen": now,
	}
	metrics := computeStatisticsOfferMetrics(offer, map[int64]offerLifecycleSnapshot{
		9: {RefPrice: 100},
	}, 0)
	if !metrics.hasRaw || metrics.rawPremium != -3 {
		t.Fatalf("raw = %+v, want directional -3", metrics)
	}
	if !metrics.hasNetFull || metrics.netFull != -3 {
		t.Fatalf("net fallback = %+v, want raw when live net is null", metrics)
	}
}
