package main

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func approxEqual(a, b, tol float64) bool { return math.Abs(a-b) <= tol }

// Modelled on Hodl Hodl offer 4813: "buy up to €87,000" while BTC fell from
// ~€66k to ~€50.8k. btc_max is the last snapshot's conversion (87000/50762),
// the whole-life average offer price is €61,304.
func fiatDenominatedPastOffer() map[string]any {
	return map[string]any{
		"id":                  int64(4813),
		"exchange":            "hodlhodl",
		"direction":           "bid",
		"fiat_currency":       "EUR",
		"volume_denomination": "EUR",
		"price":               50762.27,
		"avg_lifecycle_price": 61304.0,
		"avg_ref_price":       63868.0,
		"btc_min":             0.00171387,
		"btc_max":             1.71387149,
		"fiat_min":            int64(87),
		"fiat_max":            int64(87000),
	}
}

func btcDenominatedPastOffer() map[string]any {
	return map[string]any{
		"id":                  int64(7001),
		"exchange":            "peachbitcoin",
		"direction":           "ask",
		"fiat_currency":       "EUR",
		"volume_denomination": "BTC",
		"price":               52000.0,
		"avg_lifecycle_price": 60000.0,
		"avg_ref_price":       58000.0,
		"btc_min":             0.01,
		"btc_max":             0.01,
		"fiat_min":            int64(520),
		"fiat_max":            int64(520),
	}
}

func TestPastOfferBoundsConvertOnlyTheFloatingSide(t *testing.T) {
	fiatOffer := fiatDenominatedPastOffer()
	btcMin, btcMax := pastOfferBTCBounds(fiatOffer, 0)
	if btcMax == nil || !approxEqual(*btcMax, 87000/61304.0, 1e-8) {
		t.Fatalf("fiat-denominated btc_max = %v, want 87000 at the whole-life price", btcMax)
	}
	if btcMin == nil || !approxEqual(*btcMin, 87/61304.0, 1e-8) {
		t.Fatalf("fiat-denominated btc_min = %v, want 87 at the whole-life price", btcMin)
	}
	fiatMin, fiatMax := pastOfferFiatBounds(fiatOffer, 0)
	if fiatMin == nil || *fiatMin != 87 || fiatMax == nil || *fiatMax != 87000 {
		t.Fatalf("fiat-denominated fiat bounds = %v-%v, want the fixed 87-87000", fiatMin, fiatMax)
	}

	btcOffer := btcDenominatedPastOffer()
	btcMin, btcMax = pastOfferBTCBounds(btcOffer, 0)
	if btcMin == nil || *btcMin != 0.01 || btcMax == nil || *btcMax != 0.01 {
		t.Fatalf("BTC-denominated btc bounds = %v-%v, want the fixed 0.01", btcMin, btcMax)
	}
	fiatMin, fiatMax = pastOfferFiatBounds(btcOffer, 0)
	if fiatMax == nil || *fiatMax != 600 || fiatMin == nil || *fiatMin != 600 {
		t.Fatalf("BTC-denominated fiat bounds = %v-%v, want 0.01 BTC at €60,000", fiatMin, fiatMax)
	}

	legacy := fiatDenominatedPastOffer()
	delete(legacy, "volume_denomination")
	if _, max := pastOfferBTCBounds(legacy, 0); max == nil || *max != 1.71387149 {
		t.Fatalf("legacy btc_max = %v, want the stored value", max)
	}
}

func TestCappedTradeIsExecutableComparesOnlyTheFixedSide(t *testing.T) {
	// Fiat-denominated: €1,000 min fits a €1,000 cap even though the last
	// snapshot's BTC conversion (taken at a lower price) exceeds the BTC cap.
	fiatOffer := map[string]any{"volume_denomination": "EUR", "fiat_min": int64(1000), "btc_min": 0.02}
	if !cappedTradeIsExecutable(fiatOffer, 1000/60000.0, 1000) {
		t.Fatal("fiat-denominated min rejected on its drifting BTC conversion")
	}
	// BTC-denominated: 0.01 BTC fits the BTC cap even though the last fiat
	// conversion exceeds the fiat cap.
	btcOffer := map[string]any{"volume_denomination": "BTC", "btc_min": 0.01, "fiat_min": int64(700)}
	if !cappedTradeIsExecutable(btcOffer, 0.0105, 600) {
		t.Fatal("BTC-denominated min rejected on its drifting fiat conversion")
	}
	legacy := map[string]any{"btc_min": 0.01, "fiat_min": int64(700)}
	if cappedTradeIsExecutable(legacy, 0.0105, 600) {
		t.Fatal("legacy offer should still check both sides")
	}
}

func TestBuildPastOfferAPIUsesFixedVolume(t *testing.T) {
	agg := pastLifecycleAggregate{AvgOfferPrice: 61304, AvgRefPrice: 63868}

	fiatAPI := buildPastOfferAPI(fiatDenominatedPastOffer(), agg, 1, nil, "", 0)
	full := fiatAPI.Analysis.FullVolume
	if full.TradeSizeFiat != 87000 {
		t.Fatalf("full trade_size_fiat = %v, want the fixed €87,000 (not last-tick BTC × average ref)", full.TradeSizeFiat)
	}
	if !approxEqual(full.TradeSizeBTC, 87000/61304.0, 1e-8) {
		t.Fatalf("full trade_size_btc = %v, want €87,000 at the whole-life price", full.TradeSizeBTC)
	}
	if full.VolumeDenomination != "EUR" || fiatAPI.VolumeLimits.VolumeDenomination != "EUR" {
		t.Fatalf("denomination = %q / %q, want EUR", full.VolumeDenomination, fiatAPI.VolumeLimits.VolumeDenomination)
	}
	if fiatAPI.Analysis.MinVolume == nil || fiatAPI.Analysis.MinVolume.TradeSizeFiat != 87 {
		t.Fatalf("min scenario = %+v, want the fixed €87", fiatAPI.Analysis.MinVolume)
	}

	capped := buildPastOfferAPI(fiatDenominatedPastOffer(), agg, 1, nil, "", 5000)
	if capped.Analysis.CappedVolume == nil || capped.Analysis.CappedVolume.TradeSizeFiat != 5000 || capped.Analysis.CappedVolume.VolumeDenomination != "EUR" {
		t.Fatalf("capped scenario = %+v, want exactly the €5,000 cap", capped.Analysis.CappedVolume)
	}

	btcAPI := buildPastOfferAPI(btcDenominatedPastOffer(), pastLifecycleAggregate{AvgOfferPrice: 60000, AvgRefPrice: 58000}, 1, nil, "", 0)
	if btcAPI.Analysis.FullVolume.TradeSizeBTC != 0.01 || btcAPI.Analysis.FullVolume.VolumeDenomination != "BTC" {
		t.Fatalf("BTC full scenario = %+v, want the fixed 0.01 BTC", btcAPI.Analysis.FullVolume)
	}
	if !approxEqual(btcAPI.Analysis.FullVolume.TradeSizeFiat, 580, 1e-6) {
		t.Fatalf("BTC full trade_size_fiat = %v, want 0.01 BTC at the €58,000 average reference", btcAPI.Analysis.FullVolume.TradeSizeFiat)
	}
}

func TestDashboardAnalyticsServesFixedFiatVolume(t *testing.T) {
	withTempOrdersDB(t)

	if _, err := db.Exec(`
		INSERT INTO offers (exchange, fiat_currency, volume_denomination, direction, price, btc_min, btc_max, fiat_min, fiat_max, payment_method, offer_id, avg_ref_price, avg_lifecycle_price, avg_premium_pct, avg_net_premium_pct, historical_analysis_status, first_seen, last_seen, is_live)
		VALUES ('hodlhodl', 'EUR', 'EUR', 'bid', 50762.27, 0.00171387, 1.71387149, 87, 87000, 'SEPA', 'volume-eur', 63868, 61304, 5, 3, 'analyzed', datetime('now', '-3 hours'), datetime('now', '-1 hour'), 0)
	`); err != nil {
		t.Fatalf("insert fiat-denominated offer: %v", err)
	}

	body := `{"hours":24,"cex":"kraken","fiat":"EUR","sections":["taker_orders_full"]}`
	req := httptest.NewRequest(http.MethodPost, "/api/dashboard/analytics", strings.NewReader(body))
	rec := httptest.NewRecorder()
	handleDashboardAnalytics(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var resp dashboardAnalyticsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, order := range resp.PastProfitableOrdersCompact {
		if order.OfferID == nil || *order.OfferID != "volume-eur" {
			continue
		}
		if order.Summary.TradeSizeFiat != 87000 || order.Summary.VolumeDenomination != "EUR" {
			t.Fatalf("summary = %+v, want the fixed €87,000 in EUR", order.Summary)
		}
		if !approxEqual(order.Summary.TradeSizeBTC, 87000/61304.0, 1e-8) {
			t.Fatalf("summary trade_size_btc = %v, want €87,000 at the whole-life price", order.Summary.TradeSizeBTC)
		}
		return
	}
	t.Fatalf("volume-eur offer missing from %d compact orders", len(resp.PastProfitableOrdersCompact))
}
