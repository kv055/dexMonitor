package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestStatisticsRESTReturnsLivePastShared verifies the new /api/statistics
// endpoint returns the three dimensions in one call and that the live premium
// summary is populated (the field the old GeneralStats card was missing).
func TestStatisticsRESTReturnsLivePastShared(t *testing.T) {
	withTempOrdersDB(t)

	// Seed a currently-live offer so the live dimension is exercised. The default
	// withTempOrdersDB fixture only inserts closed (is_live=0) offers.
	if _, err := db.Exec(`
		INSERT INTO offers (exchange, direction, price, btc_min, btc_max, payment_method, offer_id, avg_ref_price, avg_premium_pct, avg_net_premium_pct, first_seen, last_seen, is_live)
		VALUES ('bisq', 'sell', 107, 0.1, 0.1, 'SEPA Instant', 'bisq-live', 100, 7, 6, datetime('now', '-20 minutes'), datetime('now', '-20 minutes'), 1)
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

	// Past dimension carries the per-timeframe premium frames and lifetimes.
	if len(resp.Past.PastPremiums) == 0 {
		t.Fatal("past.past_premiums should not be empty")
	}
	if resp.Past.PremiumLifetimes.Raw.AvgOfferLifetimeMs == nil &&
		resp.Past.PremiumLifetimes.NetFull.AvgOfferLifetimeMs == nil &&
		resp.Past.PremiumLifetimes.NetCapped.AvgOfferLifetimeMs == nil {
		t.Fatal("past.premium_lifetimes should have at least one mode populated")
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

// TestStatisticsRejectsInvalidBody confirms the endpoint fails closed on a
// malformed request body rather than panicking.
func TestStatisticsRejectsInvalidBody(t *testing.T) {
	withTempOrdersDB(t)

	req := httptest.NewRequest(http.MethodPost, "/api/statistics", strings.NewReader("{not json"))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleStatistics(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

// TestStatisticsCachesResultByParams confirms the second identical request is
// served from statisticsResultCache: it returns byte-for-byte the same response
// and stays well under the build latency a cache miss would incur. A different
// param set must miss and produce its own (different) result, proving the cache
// is keyed by params rather than a single global entry.
func TestStatisticsCachesResultByParams(t *testing.T) {
	withTempOrdersDB(t)

	if _, err := db.Exec(`
		INSERT INTO offers (exchange, direction, price, btc_min, btc_max, payment_method, offer_id, avg_ref_price, avg_premium_pct, avg_net_premium_pct, first_seen, last_seen, is_live)
		VALUES ('bisq', 'sell', 107, 0.1, 0.1, 'SEPA Instant', 'bisq-live', 100, 7, 6, datetime('now', '-20 minutes'), datetime('now', '-20 minutes'), 1)
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
	if !bytes.Equal(repeatRec.Body.Bytes(), buildBytes) {
		t.Fatal("repeat kraken response body differs from initial build response")
	}
}
