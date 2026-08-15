package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"dexmonitor/internal/pastorders"
)

func resetStatisticsCache() {
	statisticsResultCache.Lock()
	statisticsResultCache.entries = nil
	statisticsResultCache.Unlock()
}

func findStatisticsPastPremiumFrame(t *testing.T, frames []pastorders.PastPremiumTimeframeStats, label string) pastorders.PastPremiumTimeframeStats {
	t.Helper()
	for _, frame := range frames {
		if frame.Timeframe == label {
			return frame
		}
	}
	t.Fatalf("statistics timeframe %q not found", label)
	return pastorders.PastPremiumTimeframeStats{}
}

func TestBuildOfferLifecyclePremiumPointsUsesAgeForLiveAndLifetimeForPast(t *testing.T) {
	now := time.Date(2026, time.July, 14, 12, 0, 0, 0, time.UTC)
	offers := []map[string]any{
		{
			"exchange": "robosats", "direction": "ask", "avg_premium_pct": 2.5,
			"btc_max": 0.15, "first_seen": now.Add(-90 * time.Minute),
			"last_seen": now.Add(-10 * time.Minute), "is_live": true,
		},
		{
			"exchange": "bisq", "direction": "bid", "avg_premium_pct": -1.25,
			"btc_max": 0.4, "first_seen": now.Add(-5 * time.Hour),
			"last_seen": now.Add(-2 * time.Hour), "is_live": false,
		},
		{
			"exchange": "hodlhodl", "direction": "ask", "avg_premium_pct": 4.0,
			"btc_max": 0.2, "payment_methods": []string{"Cash"},
			"first_seen": now.Add(-3 * time.Hour), "last_seen": now.Add(-time.Hour), "is_live": false,
		},
	}

	live, past := buildOfferLifecyclePremiumPoints(offers, now, 24, []string{"Cash"})
	if len(live) != 1 || len(past) != 1 {
		t.Fatalf("point counts live=%d past=%d, want 1 and 1", len(live), len(past))
	}
	if live[0].LifecycleHours != 1.5 {
		t.Fatalf("live lifecycle = %v hours, want current age 1.5", live[0].LifecycleHours)
	}
	if past[0].LifecycleHours != 3 {
		t.Fatalf("past lifecycle = %v hours, want completed lifetime 3", past[0].LifecycleHours)
	}
	if live[0].VolumeBTC != 0.15 || live[0].PremiumRatePct != 2.5 || !live[0].IsLive {
		t.Fatalf("unexpected live point: %#v", live[0])
	}
	if past[0].VolumeBTC != 0.4 || past[0].PremiumRatePct != -1.25 || past[0].IsLive {
		t.Fatalf("unexpected past point: %#v", past[0])
	}
}

// TestStatisticsRESTReturnsLivePastShared verifies the new /api/statistics
// endpoint returns the three dimensions in one call and that the live premium
// summary is populated (the field the old GeneralStats card was missing).
func TestStatisticsRESTReturnsLivePastShared(t *testing.T) {
	withTempOrdersDB(t)
	resetStatisticsCache()

	// Seed a currently-live offer so the live dimension is exercised. The default
	// withTempOrdersDB fixture only inserts closed (is_live=0) offers.
	if _, err := db.Exec(`
		INSERT INTO offers (exchange, direction, price, btc_min, btc_max, payment_method, offer_id, avg_ref_price, avg_premium_pct, avg_net_premium_pct, first_seen, last_seen, is_live)
		VALUES ('bisq', 'ask', 107, 0.1, 0.1, 'SEPA Instant', 'bisq-live', 100, 7, 6, datetime('now', '-20 minutes'), datetime('now', '-20 minutes'), 1)
	`); err != nil {
		t.Fatalf("insert live offer: %v", err)
	}

	body := `{"hours":48,"cex":"kraken","fiat":"EUR"}`
	req := httptest.NewRequest(http.MethodPost, "/api/statistics", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleStatistics(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if got := rec.Header().Get(statisticsCacheHeader); got != string(statisticsCacheStatusMiss) {
		t.Fatalf("%s = %q, want %q", statisticsCacheHeader, got, statisticsCacheStatusMiss)
	}
	if rec.Header().Get(statisticsBuiltAtHeader) == "" {
		t.Fatalf("expected %s header to be set", statisticsBuiltAtHeader)
	}
	if rec.Header().Get("Server-Timing") == "" {
		t.Fatal("expected Server-Timing header to be set")
	}

	var resp statisticsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	// Shared dimension aggregates live + past across the window.
	if resp.Shared.TotalOffers == 0 {
		t.Fatal("shared.total_offers should be > 0 for the seeded window")
	}
	if resp.Shared.Hours != 48 {
		t.Fatalf("shared.hours = %d, want 48", resp.Shared.Hours)
	}

	// Live dimension carries the exchange distribution. The premium summary
	// object must be present even when no live ask/bid premiums exist, so the
	// frontend can distinguish "no data" from "endpoint broken".
	if resp.Live.TotalOffers == 0 {
		t.Fatal("live.total_offers should be > 0; the seeded window has live offers")
	}
	if len(resp.Live.OffersByExchange) == 0 {
		t.Fatal("live.offers_by_exchange should not be empty")
	}
	if len(resp.Live.OfferLifecyclePoints) == 0 {
		t.Fatal("live.offer_lifecycle_points should contain the seeded live offer")
	}

	// Past dimension carries the per-timeframe premium frames and lifetimes.
	if len(resp.Past.PastPremiums) == 0 {
		t.Fatal("past.past_premiums should not be empty")
	}
	if resp.Past.PremiumLifetimes.Raw.AvgOfferLifetimeMs == nil &&
		resp.Past.PremiumLifetimes.NetFull.AvgOfferLifetimeMs == nil &&
		resp.Past.PremiumLifetimes.NetCapped.AvgOfferLifetimeMs == nil {
		t.Fatal("past.premium_lifetimes should have at least one mode populated")
	}
	if len(resp.Past.OfferLifecyclePoints) == 0 {
		t.Fatal("past.offer_lifecycle_points should contain closed offers")
	}

	// Live + past totals should sum to the shared total.
	if resp.Live.TotalOffers+resp.Past.TotalOffers != resp.Shared.TotalOffers {
		t.Fatalf(
			"live(%d) + past(%d) totals = %d, want shared total %d",
			resp.Live.TotalOffers, resp.Past.TotalOffers,
			resp.Live.TotalOffers+resp.Past.TotalOffers,
			resp.Shared.TotalOffers,
		)
	}
}

func TestStatisticsUsesPersistedOfferSummariesWithoutLifecycleTable(t *testing.T) {
	withTempOrdersDB(t)
	resetStatisticsCache()

	if _, err := db.Exec(`DROP TABLE order_lifecycle`); err != nil {
		t.Fatalf("drop order_lifecycle: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO offers (exchange, direction, price, btc_min, btc_max, payment_method, offer_id, avg_ref_price, avg_premium_pct, avg_net_premium_pct, first_seen, last_seen, is_live)
		VALUES ('bisq', 'ask', 107, 0.1, 0.1, 'SEPA Instant', 'bisq-live', 100, 7, 6, datetime('now', '-20 minutes'), datetime('now', '-20 minutes'), 1)
	`); err != nil {
		t.Fatalf("insert live offer: %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/statistics", strings.NewReader(`{"hours":48,"cex":"kraken","fiat":"EUR"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleStatistics(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp statisticsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Past.PastPremiums) == 0 {
		t.Fatal("expected past premiums without lifecycle table")
	}
}

func TestStatisticsPastPremiumsAndLifetimesUsePersistedOfferFields(t *testing.T) {
	withTempOrdersDB(t)
	resetStatisticsCache()

	resp, _, err := buildStatisticsResponse(dashboardAnalyticsParams{Hours: 48, Cex: "kraken", Fiat: "EUR"})
	if err != nil {
		t.Fatalf("buildStatisticsResponse: %v", err)
	}

	frame := findStatisticsPastPremiumFrame(t, resp.Past.PastPremiums, "6h")
	if len(frame.Modes.Raw) != 1 || frame.Modes.Raw[0].AvgPremiumPct != 5 {
		t.Fatalf("6h raw premiums = %#v, want bisq=5", frame.Modes.Raw)
	}
	if len(frame.Modes.NetFull) != 1 || frame.Modes.NetFull[0].AvgPremiumPct != 4.4567 {
		t.Fatalf("6h net_full premiums = %#v, want bisq=4.4567", frame.Modes.NetFull)
	}
	if resp.Past.PremiumLifetimes.NetFull.AvgOfferLifetimeMs == nil || *resp.Past.PremiumLifetimes.NetFull.AvgOfferLifetimeMs != 7200000 {
		t.Fatalf("net_full lifetime = %#v, want 7200000ms", resp.Past.PremiumLifetimes.NetFull.AvgOfferLifetimeMs)
	}
}

func TestStatisticsCappedModeUsesPersistedOfferFields(t *testing.T) {
	withTempOrdersDB(t)
	resetStatisticsCache()

	if _, err := db.Exec(`DROP TABLE order_lifecycle`); err != nil {
		t.Fatalf("drop order_lifecycle: %v", err)
	}

	resp, _, err := buildStatisticsResponse(dashboardAnalyticsParams{
		Hours:           48,
		Cex:             "kraken",
		Fiat:            "EUR",
		MaxFiatLimitEUR: 10,
	})
	if err != nil {
		t.Fatalf("buildStatisticsResponse: %v", err)
	}

	frame := findStatisticsPastPremiumFrame(t, resp.Past.PastPremiums, "48h")
	if len(frame.Modes.NetCapped) != 1 {
		t.Fatalf("48h net_capped premiums = %#v, want one bisq entry", frame.Modes.NetCapped)
	}
	if frame.Modes.NetFull[0].AvgPremiumPct != 4.3425 {
		t.Fatalf("48h net_full premiums = %#v, want bisq=4.3425", frame.Modes.NetFull)
	}
	if frame.Modes.NetCapped[0].AvgPremiumPct != 4.405 {
		t.Fatalf("48h net_capped premiums = %#v, want bisq=4.405", frame.Modes.NetCapped)
	}
}

// TestStatisticsRejectsInvalidBody confirms the endpoint fails closed on a
// malformed request body rather than panicking.
func TestStatisticsRejectsInvalidBody(t *testing.T) {
	withTempOrdersDB(t)
	resetStatisticsCache()

	req := httptest.NewRequest(http.MethodPost, "/api/statistics", strings.NewReader("{not json"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleStatistics(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

// TestStatisticsCachesResultByParams confirms the second identical request is
// served from statisticsResultCache with cache headers intact, and a different
// param set is cached independently.
func TestStatisticsCachesResultByParams(t *testing.T) {
	withTempOrdersDB(t)
	resetStatisticsCache()

	if _, err := db.Exec(`
		INSERT INTO offers (exchange, direction, price, btc_min, btc_max, payment_method, offer_id, avg_ref_price, avg_premium_pct, avg_net_premium_pct, first_seen, last_seen, is_live)
		VALUES ('bisq', 'ask', 107, 0.1, 0.1, 'SEPA Instant', 'bisq-live', 100, 7, 6, datetime('now', '-20 minutes'), datetime('now', '-20 minutes'), 1)
	`); err != nil {
		t.Fatalf("insert live offer: %v", err)
	}

	body := `{"hours":48,"cex":"kraken","fiat":"EUR"}`

	buildReq := httptest.NewRequest(http.MethodPost, "/api/statistics", strings.NewReader(body))
	buildReq.Header.Set("Content-Type", "application/json")
	buildRec := httptest.NewRecorder()
	handleStatistics(buildRec, buildReq)
	if buildRec.Code != http.StatusOK {
		t.Fatalf("build status = %d, want %d; body=%s", buildRec.Code, http.StatusOK, buildRec.Body.String())
	}
	if got := buildRec.Header().Get(statisticsCacheHeader); got != string(statisticsCacheStatusMiss) {
		t.Fatalf("build %s = %q, want %q", statisticsCacheHeader, got, statisticsCacheStatusMiss)
	}
	buildBytes := buildRec.Body.Bytes()

	cacheStart := time.Now()
	cacheReq := httptest.NewRequest(http.MethodPost, "/api/statistics", strings.NewReader(body))
	cacheReq.Header.Set("Content-Type", "application/json")
	cacheRec := httptest.NewRecorder()
	handleStatistics(cacheRec, cacheReq)
	cacheElapsed := time.Since(cacheStart)
	if cacheRec.Code != http.StatusOK {
		t.Fatalf("cache status = %d, want %d; body=%s", cacheRec.Code, http.StatusOK, cacheRec.Body.String())
	}
	if got := cacheRec.Header().Get(statisticsCacheHeader); got != string(statisticsCacheStatusHit) {
		t.Fatalf("cache %s = %q, want %q", statisticsCacheHeader, got, statisticsCacheStatusHit)
	}
	if !bytes.Equal(cacheRec.Body.Bytes(), buildBytes) {
		t.Fatal("cached response body differs from initial build response")
	}
	if cacheElapsed > 50*time.Millisecond {
		t.Fatalf("cached request took %v, want <= 50ms", cacheElapsed)
	}

	// A different cex param misses the cache (separate key) but may produce
	// an identical body on this fixture, which only seeds bisq offers. What
	// matters is that the cache now holds both param keys independently, so
	// each subsequent identical request is served without rebuilding.
	otherBody := `{"hours":48,"cex":"bitstamp","fiat":"EUR"}`
	otherReq := httptest.NewRequest(http.MethodPost, "/api/statistics", strings.NewReader(otherBody))
	otherReq.Header.Set("Content-Type", "application/json")
	otherRec := httptest.NewRecorder()
	handleStatistics(otherRec, otherReq)
	if otherRec.Code != http.StatusOK {
		t.Fatalf("other status = %d, want %d; body=%s", otherRec.Code, http.StatusOK, otherRec.Body.String())
	}
	if got := otherRec.Header().Get(statisticsCacheHeader); got != string(statisticsCacheStatusMiss) {
		t.Fatalf("other %s = %q, want %q", statisticsCacheHeader, got, statisticsCacheStatusMiss)
	}

	statisticsResultCache.Lock()
	entryCount := len(statisticsResultCache.entries)
	statisticsResultCache.Unlock()
	if entryCount != 2 {
		t.Fatalf("expected 2 cached param entries, got %d", entryCount)
	}

	// The original kraken entry must still be live and serve the cached body.
	repeatReq := httptest.NewRequest(http.MethodPost, "/api/statistics", strings.NewReader(body))
	repeatReq.Header.Set("Content-Type", "application/json")
	repeatRec := httptest.NewRecorder()
	handleStatistics(repeatRec, repeatReq)
	if repeatRec.Code != http.StatusOK {
		t.Fatalf("repeat status = %d, want %d", repeatRec.Code, http.StatusOK)
	}
	if got := repeatRec.Header().Get(statisticsCacheHeader); got != string(statisticsCacheStatusHit) {
		t.Fatalf("repeat %s = %q, want %q", statisticsCacheHeader, got, statisticsCacheStatusHit)
	}
	if !bytes.Equal(repeatRec.Body.Bytes(), buildBytes) {
		t.Fatal("repeat kraken response body differs from initial build response")
	}
}

func TestStatisticsServesStaleWhileRefreshing(t *testing.T) {
	withTempOrdersDB(t)
	resetStatisticsCache()

	if _, err := db.Exec(`
		INSERT INTO offers (exchange, direction, price, btc_min, btc_max, payment_method, offer_id, avg_ref_price, avg_premium_pct, avg_net_premium_pct, first_seen, last_seen, is_live)
		VALUES ('bisq', 'ask', 107, 0.1, 0.1, 'SEPA Instant', 'bisq-live', 100, 7, 6, datetime('now', '-20 minutes'), datetime('now', '-20 minutes'), 1)
	`); err != nil {
		t.Fatalf("insert live offer: %v", err)
	}

	body := `{"hours":48,"cex":"kraken","fiat":"EUR"}`
	buildReq := httptest.NewRequest(http.MethodPost, "/api/statistics", strings.NewReader(body))
	buildReq.Header.Set("Content-Type", "application/json")
	buildRec := httptest.NewRecorder()
	handleStatistics(buildRec, buildReq)
	if buildRec.Code != http.StatusOK {
		t.Fatalf("build status = %d, want %d", buildRec.Code, http.StatusOK)
	}

	cacheKey := dashboardAnalyticsParams{Hours: 48, Cex: "kraken", Fiat: "EUR"}.cacheKey()
	statisticsResultCache.Lock()
	entry := statisticsResultCache.entries[cacheKey]
	if entry == nil {
		statisticsResultCache.Unlock()
		t.Fatal("expected cache entry to exist")
	}
	entry.expiry = time.Now().Add(-time.Minute)
	statisticsResultCache.Unlock()

	staleReq := httptest.NewRequest(http.MethodPost, "/api/statistics", strings.NewReader(body))
	staleReq.Header.Set("Content-Type", "application/json")
	staleRec := httptest.NewRecorder()
	handleStatistics(staleRec, staleReq)
	if staleRec.Code != http.StatusOK {
		t.Fatalf("stale status = %d, want %d", staleRec.Code, http.StatusOK)
	}
	if got := staleRec.Header().Get(statisticsCacheHeader); got != string(statisticsCacheStatusStale) {
		t.Fatalf("stale %s = %q, want %q", statisticsCacheHeader, got, statisticsCacheStatusStale)
	}

	deadline := time.Now().Add(2 * time.Second)
	for {
		hitReq := httptest.NewRequest(http.MethodPost, "/api/statistics", strings.NewReader(body))
		hitReq.Header.Set("Content-Type", "application/json")
		hitRec := httptest.NewRecorder()
		handleStatistics(hitRec, hitReq)
		if hitRec.Code == http.StatusOK && hitRec.Header().Get(statisticsCacheHeader) == string(statisticsCacheStatusHit) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected stale refresh to complete and return %q within deadline", statisticsCacheStatusHit)
		}
		time.Sleep(25 * time.Millisecond)
	}
}
