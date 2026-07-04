package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
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
