package main

import (
	"commons/tradecost"
	"database/sql"
	"dexmonitor/internal/pastorders"
	"dexmonitor/internal/paymentmethods"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

const legacySQLiteOrdersSchema = `
CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    exchange TEXT NOT NULL,
    fiat_currency TEXT NOT NULL,
    direction TEXT NOT NULL,
    btc_price REAL NOT NULL
);

CREATE TABLE offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exchange TEXT NOT NULL,
    fiat_currency TEXT NOT NULL DEFAULT 'EUR',
    direction TEXT NOT NULL,
    price REAL NOT NULL,
    btc_min REAL,
    btc_max REAL,
    fiat_min INTEGER,
    fiat_max INTEGER,
    payment_method TEXT,
    payment_methods TEXT,
    offer_id TEXT,
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_live BOOLEAN NOT NULL DEFAULT 0,
    duration INTEGER,
    historical_analysis_status TEXT,
    avg_ref_price REAL,
    avg_premium_pct REAL,
    avg_trade_cost_pct REAL,
    avg_trade_cost_btc REAL,
    avg_hedge_fee_sum_btc REAL,
    cex_taker_fee_btc REAL,
    cex_withdraw_fee_btc REAL,
    network_fee_btc REAL,
    hedge_open_fee_btc REAL,
    hedge_close_fee_btc REAL,
    hedge_funding_fee_btc REAL,
    hedge_fee_sum_btc REAL,
    hedge_venue TEXT,
    hedge_instrument TEXT,
    hedge_transfer_minutes INTEGER,
    dex_fee_btc REAL,
    avg_net_premium_pct REAL,
    avg_estimated_profit_btc REAL,
    avg_estimated_profit_fiat REAL,
    avg_btc_amount REAL,
    avg_min_trade_cost_pct REAL,
    avg_min_trade_cost_btc REAL,
    avg_min_net_premium_pct REAL,
    avg_min_estimated_profit_btc REAL,
    avg_min_estimated_profit_fiat REAL,
    avg_min_btc_amount REAL,
    min_volume_analyzed BOOLEAN NOT NULL DEFAULT 0,
    price_type TEXT,
    best_route_cex TEXT,
    best_route_method TEXT,
    security_deposit_pct REAL
);

CREATE TABLE order_lifecycle (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    offer_db_id      INTEGER NOT NULL,
    snapshot_time    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    price            REAL    NOT NULL,
    ref_price        REAL    NOT NULL,
    premium_pct      REAL    NOT NULL,
    trade_cost_pct   REAL,
    trade_cost_btc   REAL,
    net_premium_pct  REAL,
    net_premium_btc  REAL,
    btc_amount       REAL,
    min_trade_cost_pct REAL,
    min_trade_cost_btc REAL,
    min_net_premium_pct REAL,
    min_net_premium_btc REAL,
    min_btc_amount REAL
);

CREATE INDEX idx_snapshots_time ON snapshots(timestamp);
CREATE INDEX idx_snapshots_exchange ON snapshots(exchange);
CREATE INDEX idx_offers_exchange ON offers(exchange);
CREATE INDEX idx_offers_direction ON offers(direction);
CREATE INDEX idx_offers_last_seen ON offers(last_seen);
CREATE INDEX idx_offers_fingerprint ON offers(exchange, direction, price, btc_min, btc_max, payment_method);
CREATE UNIQUE INDEX idx_offers_offer_id ON offers(offer_id) WHERE offer_id IS NOT NULL;

CREATE INDEX idx_lifecycle_offer ON order_lifecycle(offer_db_id);
CREATE INDEX idx_lifecycle_time  ON order_lifecycle(snapshot_time);

CREATE TABLE payment_methods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    merge_regex TEXT,
    category TEXT NOT NULL DEFAULT 'Others',
    bank_account_id INTEGER,
    account_id INTEGER,
    wallet_address_id INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT 0,
    priority INTEGER NOT NULL DEFAULT 0,
    match_order INTEGER NOT NULL DEFAULT 1000,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payment_method_chat_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exchange TEXT NOT NULL,
    payment_method_id INTEGER NOT NULL,
    template TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(exchange, payment_method_id)
);

CREATE TABLE snapshot_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    exchanges TEXT NOT NULL,
    offers_count INTEGER NOT NULL
);

CREATE TABLE ohlc (
    time  DATETIME PRIMARY KEY,
    open  REAL NOT NULL,
    high  REAL NOT NULL,
    low   REAL NOT NULL,
    close REAL NOT NULL
);
`

func fixedCostEstimator(exchange, dexExchange string, takerFeeFrac, withdrawalFeeBTC, dexFeeFrac, networkFeeBTC float64) *tradecost.TradeCostEstimator {
	return tradecost.NewFixedEstimatorForTesting(exchange, dexExchange, takerFeeFrac, withdrawalFeeBTC, dexFeeFrac, networkFeeBTC)
}

func fixedCostEstimatorWithHedge(exchange, dexExchange string, takerFeeFrac, withdrawalFeeBTC, dexFeeFrac, networkFeeBTC, hedgeFeeBTC float64) *tradecost.TradeCostEstimator {
	return tradecost.NewFixedEstimatorWithHedgeForTesting(exchange, dexExchange, takerFeeFrac, withdrawalFeeBTC, dexFeeFrac, networkFeeBTC, hedgeFeeBTC)
}

func assertFloat(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("got %.12f, want %.12f", got, want)
	}
}

func strPtr(v string) *string { return &v }

func storedPastOfferFixture(direction string) map[string]any {
	return map[string]any{
		"id":                        int64(1),
		"exchange":                  "bisq",
		"direction":                 direction,
		"price":                     105.0,
		"btc_min":                   1.0,
		"btc_max":                   1.0,
		"payment_method":            "SEPA",
		"offer_id":                  "stored-policy-test",
		"first_seen":                "2026-04-01 12:00:00",
		"last_seen":                 "2026-04-01 12:05:00",
		"avg_ref_price":             100.0,
		"avg_premium_pct":           5.0,
		"avg_trade_cost_pct":        1.2,
		"avg_trade_cost_btc":        0.012,
		"cex_taker_fee_btc":         0.0025,
		"cex_withdraw_fee_btc":      0.00015,
		"network_fee_btc":           0.0001,
		"dex_fee_btc":               0.001,
		"hedge_open_fee_btc":        0.0001,
		"hedge_close_fee_btc":       0.0001,
		"hedge_funding_fee_btc":     0.0001,
		"hedge_fee_sum_btc":         0.0003,
		"hedge_venue":               "kraken_futures",
		"hedge_instrument":          "PI_XBTUSD",
		"hedge_transfer_minutes":    int64(30),
		"avg_net_premium_pct":       3.8,
		"avg_estimated_profit_btc":  0.038,
		"avg_estimated_profit_fiat": 3.8,
		"avg_btc_amount":            1.0,
		"price_type":                "fixed",
		"best_route_cex":            "kraken",
		"best_route_method":         "onchain",
	}
}

func TestPastOfferAPIIncludesHistoryCountAndActualSecurityDeposit(t *testing.T) {
	offer := storedPastOfferFixture("buy")
	offer["security_deposit_pct"] = 0.15

	api := buildPastOfferAPI(offer, pastLifecycleAggregate{
		Count:             7,
		AvgOfferPrice:     105,
		AvgRefPrice:       100,
		AvgPremiumPercent: 5,
		AvgTradeCostPct:   1.2,
		AvgTradeCostBTC:   0.012,
		AvgNetPercent:     3.8,
		AvgProfitBTC:      0.038,
		AvgProfitFiat:     3.8,
	}, 0, nil, "", 0)

	if api.ObservationCount != 7 {
		t.Fatalf("observation count = %d, want 7", api.ObservationCount)
	}
	if api.Analysis.FullVolume.Capital == nil {
		t.Fatal("expected capital requirement")
	}
	if got := api.Analysis.FullVolume.Capital.SecurityDepositPct; got != 0.15 {
		t.Fatalf("security deposit pct = %v, want 0.15", got)
	}
	if api.Analysis.FullVolume.Capital.DepositEstimated {
		t.Fatal("persisted security deposit must not be marked estimated")
	}
}

func TestServeDistStaticSetsCacheControlHeaders(t *testing.T) {
	oldFrontendDir := frontendDir
	t.Cleanup(func() { frontendDir = oldFrontendDir })

	root := t.TempDir()
	assetsDir := filepath.Join(root, "assets")
	if err := os.MkdirAll(assetsDir, 0o755); err != nil {
		t.Fatalf("mkdir assets: %v", err)
	}
	brandDir := filepath.Join(root, "brand")
	if err := os.MkdirAll(brandDir, 0o755); err != nil {
		t.Fatalf("mkdir brand: %v", err)
	}
	for path, content := range map[string]string{
		filepath.Join(assetsDir, "app.js"):  "console.log('app')",
		filepath.Join(brandDir, "logo.svg"): "<svg/>",
		filepath.Join(root, "favicon.ico"):  "ico",
		filepath.Join(root, "index.html"):   "<!doctype html><html></html>",
	} {
		if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
			t.Fatalf("write %s: %v", path, err)
		}
	}
	frontendDir = root

	for _, tc := range []struct {
		path   string
		wantCC string
	}{
		{"/assets/app.js", "public, max-age=31536000, immutable"},
		{"/brand/logo.svg", "public, max-age=86400"},
		{"/favicon.ico", "no-cache"},
	} {
		t.Run(tc.path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, tc.path, nil)
			rec := httptest.NewRecorder()
			serveDistStatic(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
			}
			if got := rec.Header().Get("Cache-Control"); got != tc.wantCC {
				t.Fatalf("Cache-Control = %q, want %q", got, tc.wantCC)
			}
		})
	}

	indexReq := httptest.NewRequest(http.MethodGet, "/", nil)
	indexRec := httptest.NewRecorder()
	serveFrontend(indexRec, indexReq)
	if indexRec.Header().Get("Cache-Control") != "no-cache" {
		t.Fatalf("index Cache-Control = %q, want no-cache", indexRec.Header().Get("Cache-Control"))
	}
}

func TestPastOrderStatsRESTAggregatesPremiumOrdersByTimeframe(t *testing.T) {
	withTempOrdersDB(t)

	req := httptest.NewRequest(http.MethodGet, "/api/past_order_stats?fiat=eur&premium_mode=net_full", nil)
	rec := httptest.NewRecorder()

	handlePastOrderStats(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var stats pastOrderStatsTestResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if stats.FiatCurrency != "EUR" {
		t.Fatalf("fiat_currency = %q, want EUR", stats.FiatCurrency)
	}

	oneHour := findStatsTimeframe(t, stats.Timeframes, "1h")
	if oneHour.PremiumOrderCount != 2 {
		t.Fatalf("1h premium count = %d, want 2", oneHour.PremiumOrderCount)
	}
	assertFloat(t, oneHour.TotalProfitBTC, 0.02296)
	assertFloat(t, oneHour.TotalProfitFiat, 2.3)
	assertFloat(t, oneHour.AverageOrderBTC, 0.25)
	assertFloat(t, oneHour.SmallestOrderBTC, 0.1)
	assertFloat(t, oneHour.BiggestOrderBTC, 0.4)

	sixHour := findStatsTimeframe(t, stats.Timeframes, "6h")
	if sixHour.PremiumOrderCount != 3 {
		t.Fatalf("6h premium count = %d, want 3", sixHour.PremiumOrderCount)
	}
	assertFloat(t, sixHour.TotalProfitBTC, 0.03222)
	assertFloat(t, sixHour.TotalProfitFiat, 3.22)
	assertFloat(t, sixHour.AverageOrderBTC, 0.23333333)
	assertFloat(t, sixHour.SmallestOrderBTC, 0.1)
	assertFloat(t, sixHour.BiggestOrderBTC, 0.4)
}

func TestPastOrderStatsExcludesNonAnalyzedClosedOffers(t *testing.T) {
	withTempOrdersDB(t)

	for _, fixture := range []struct {
		offerID string
		status  any
	}{
		{offerID: "pending-analysis", status: nil},
		{offerID: "non-premium-closed", status: "non_premium"},
		{offerID: "ignored-no-lifecycle", status: "ignored_no_lifecycle"},
	} {
		if _, err := db.Exec(`
			INSERT INTO offers (
				exchange, direction, price, btc_min, btc_max, payment_method, offer_id,
				avg_ref_price, avg_net_premium_pct, avg_estimated_profit_btc, avg_estimated_profit_fiat,
				historical_analysis_status, first_seen, last_seen, is_live
			)
			VALUES ('bisq', 'buy', 105, 0.1, 0.1, 'SEPA', ?, 100, 4.00, 0.00400, 0.40, ?, datetime('now', '-20 minutes'), datetime('now', '-20 minutes'), 0)
		`, fixture.offerID, fixture.status); err != nil {
			t.Fatalf("insert %s offer: %v", fixture.offerID, err)
		}
	}

	statsReq := httptest.NewRequest(http.MethodGet, "/api/past_order_stats?fiat=eur&premium_mode=net_full", nil)
	statsRec := httptest.NewRecorder()
	handlePastOrderStats(statsRec, statsReq)
	if statsRec.Code != http.StatusOK {
		t.Fatalf("stats status = %d, want %d; body=%s", statsRec.Code, http.StatusOK, statsRec.Body.String())
	}

	var stats pastOrderStatsTestResponse
	if err := json.Unmarshal(statsRec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode stats response: %v", err)
	}
	oneHour := findStatsTimeframe(t, stats.Timeframes, "1h")
	if oneHour.PremiumOrderCount != 2 {
		t.Fatalf("1h premium count = %d, want 2 (non-analyzed offers must be excluded)", oneHour.PremiumOrderCount)
	}

	ordersReq := httptest.NewRequest(http.MethodGet, "/api/past_profitable_orders?premium_mode=net_full", nil)
	ordersRec := httptest.NewRecorder()
	handlePastProfitableOrders(ordersRec, ordersReq)
	if ordersRec.Code != http.StatusOK {
		t.Fatalf("orders status = %d, want %d; body=%s", ordersRec.Code, http.StatusOK, ordersRec.Body.String())
	}

	var orders []map[string]any
	if err := json.Unmarshal(ordersRec.Body.Bytes(), &orders); err != nil {
		t.Fatalf("decode orders response: %v", err)
	}
	for _, order := range orders {
		offerID, _ := order["offer_id"].(string)
		switch offerID {
		case "pending-analysis", "non-premium-closed", "ignored-no-lifecycle":
			t.Fatalf("unexpected non-analyzed offer %q in profitable orders", offerID)
		}
	}
}

func TestPastOffersRESTIncludesCappedAnalysisWhenRequested(t *testing.T) {
	withTempOrdersDB(t)

	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)
	est.SetFixedDexFeeForTesting("hodlhodl", 0.001)
	est.SetFixedDexFeeForTesting("robosats", 0.001)
	tradeCostEstimators = map[string]*tradecost.TradeCostEstimator{"kraken": est}
	tradeRouteOptimizer = tradecost.NewTradeRouteOptimizer(tradeCostEstimators)

	req := httptest.NewRequest(http.MethodGet, "/api/past_offers?hours=100000&limit=1000&max_fiat_limit=5", nil)
	rec := httptest.NewRecorder()

	handlePastOffers(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var offers []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &offers); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	foundCapped := false
	for _, offer := range offers {
		analysis, ok := offer["analysis"].(map[string]any)
		if !ok {
			continue
		}
		if capped, ok := analysis["capped_volume"].(map[string]any); ok {
			if _, ok := capped["trade_size_btc"].(float64); !ok {
				t.Fatalf("capped_volume missing trade_size_btc: %#v", capped)
			}
			foundCapped = true
			break
		}
	}
	if !foundCapped {
		t.Fatal("expected at least one past offer with capped_volume")
	}
}

func TestPastOfferAnalysisUsesStoredUncappedCosts(t *testing.T) {
	oldEstimators := tradeCostEstimators
	t.Cleanup(func() { tradeCostEstimators = oldEstimators })
	tradeCostEstimators = map[string]*tradecost.TradeCostEstimator{
		"kraken": fixedCostEstimator("kraken", "bisq", 0.50, 0.50, 0.50, 0.50),
	}

	offer := storedPastOfferFixture("buy")
	offer["best_route_cex"] = "coinbase"
	offer["best_route_method"] = "lightning"
	offer["avg_trade_cost_pct"] = 1.2345
	offer["avg_trade_cost_btc"] = 0.0012345
	offer["avg_net_premium_pct"] = 3.7655
	offer["avg_estimated_profit_btc"] = 0.0037655
	offer["network_fee_btc"] = 0.00001234

	got := buildPastOfferAPI(offer, pastLifecycleAggregate{}, 0, nil, "", 10_000)

	full := got.Analysis.FullVolume
	assertFloat(t, full.Premium.AvgTradeCostPercent, 1.2345)
	assertFloat(t, full.Premium.AvgNetPercent, 3.7655)
	assertFloat(t, full.Profit.AvgBTC, 0.0037655)
	assertFloat(t, full.Costs.Total.AvgBTC, 0.0012345)
	assertFloat(t, full.Costs.Network.BTC, 0.00001234)
	if full.Route.CEX != "coinbase" || full.Route.Settlement != "lightning" {
		t.Fatalf("route = %#v, want stored coinbase/lightning", full.Route)
	}
	if full.CostPolicy != "historical_persisted" {
		t.Fatalf("cost policy = %q", full.CostPolicy)
	}
}

func TestPastOfferNetMinUsesCloseTimeMinimumAnalysis(t *testing.T) {
	offer := storedPastOfferFixture("buy")
	offer["btc_min"] = 0.02
	offer["btc_max"] = 1.0
	offer["min_volume_analyzed"] = true
	offer["avg_min_trade_cost_pct"] = 2.25
	offer["avg_min_trade_cost_btc"] = 0.00045
	offer["avg_min_net_premium_pct"] = 2.75
	offer["avg_min_estimated_profit_btc"] = 0.00055
	offer["avg_min_estimated_profit_fiat"] = 0.055
	offer["avg_min_btc_amount"] = 0.02

	analysis := addPastOfferCostFieldsFull(offer, pastLifecycleAggregate{}, 0, nil, "", 0)
	if !analysis.profitableInMode(takerOpportunityModeNetMin) {
		t.Fatal("persisted minimum-volume scenario should be profitable")
	}
	btcSize, profitBTC := analysis.valuesForMode(takerOpportunityModeNetMin)
	assertFloat(t, btcSize, 0.02)
	assertFloat(t, profitBTC, 0.00055)

	minScenario := buildPastOfferAPI(offer, pastLifecycleAggregate{}, 0, nil, "", 0).Analysis.MinVolume
	if minScenario == nil {
		t.Fatal("expected minimum-volume scenario")
	}
	assertFloat(t, minScenario.TradeSizeBTC, 0.02)
	assertFloat(t, minScenario.Premium.AvgTradeCostPercent, 2.25)
	assertFloat(t, minScenario.Premium.AvgNetPercent, 2.75)
	assertFloat(t, minScenario.Profit.AvgBTC, 0.00055)

	offer["avg_min_estimated_profit_btc"] = nil
	analysis = addPastOfferCostFieldsFull(offer, pastLifecycleAggregate{}, 0, nil, "", 0)
	if analysis.profitableInMode(takerOpportunityModeNetMin) {
		t.Fatal("minimum-volume mode must exclude an offer with no profitable minimum snapshots")
	}
}

func TestPastOfferNetCappedExcludesMinimumVolumeAboveCap(t *testing.T) {
	offer := storedPastOfferFixture("buy")
	offer["btc_min"] = 0.5
	offer["btc_max"] = 1.0
	offer["avg_ref_price"] = 1000.0

	analysis := addPastOfferCostFieldsFull(offer, pastLifecycleAggregate{}, 0, nil, "", 300)
	if analysis.profitableInMode(takerOpportunityModeNetCapped) {
		t.Fatal("net capped mode must exclude an offer whose minimum volume exceeds the cap")
	}

	apiAnalysis := buildPastOfferAPI(offer, pastLifecycleAggregate{}, 0, nil, "", 300).Analysis
	if apiAnalysis.CappedVolumeExecutable {
		t.Fatal("capped API analysis must mark an offer above the cap's executable minimum as unavailable")
	}
	cappedScenario := apiAnalysis.CappedVolume
	if cappedScenario != nil {
		t.Fatalf("capped scenario = %#v, want nil for an unexecutable capped trade", cappedScenario)
	}
}

func TestPastOfferFullVolumeRecomputesHedgeWhenStoredAbsent(t *testing.T) {
	oldEstimators := tradeCostEstimators
	t.Cleanup(func() { tradeCostEstimators = oldEstimators })
	// Estimator carries a live hedge estimate; route is kraken (matches the fixture).
	tradeCostEstimators = map[string]*tradecost.TradeCostEstimator{
		"kraken": fixedCostEstimatorWithHedge("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.0001, 0.0009),
	}

	// Simulate an offer snapshotted before the hedge_* columns were populated: stored hedge is
	// empty, but avg_trade_cost_btc still reflects the hedge. The full-volume breakdown must
	// recompute the hedge so the "Hedge cost" row reappears (regression guard).
	offer := storedPastOfferFixture("buy")
	offer["hedge_open_fee_btc"] = 0.0
	offer["hedge_close_fee_btc"] = 0.0
	offer["hedge_funding_fee_btc"] = 0.0
	offer["hedge_fee_sum_btc"] = 0.0
	offer["hedge_venue"] = ""
	offer["hedge_instrument"] = ""

	full := buildPastOfferAPI(offer, pastLifecycleAggregate{}, 0, nil, "", 10_000).Analysis.FullVolume

	if full.Costs.Hedge.FeeSumBTC <= 0 {
		t.Fatalf("full-volume hedge fee_sum_btc = %v, want > 0 (recomputed from estimator)", full.Costs.Hedge.FeeSumBTC)
	}
	assertFloat(t, full.Costs.Hedge.FeeSumBTC, 0.0009)
	if full.Costs.Hedge.Venue != "coinbase_futures" {
		t.Fatalf("hedge venue = %q, want coinbase_futures (recomputed)", full.Costs.Hedge.Venue)
	}
}

func TestPastOfferFullVolumeUsesHistoricalHedgePositionWhenPersisted(t *testing.T) {
	oldEstimators := tradeCostEstimators
	t.Cleanup(func() { tradeCostEstimators = oldEstimators })
	// Even with a live estimator available, the real persisted averages should
	// win over a live-recomputed-at-today's-price guess.
	tradeCostEstimators = map[string]*tradecost.TradeCostEstimator{
		"kraken": fixedCostEstimatorWithHedge("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.0001, 0.0009),
	}

	offer := storedPastOfferFixture("buy")
	agg := pastLifecycleAggregate{
		AvgHedgeNotionalEUR:         50,
		AvgLeverageUsed:             5,
		AvgRecommendedCollateral: 15,
	}

	full := buildPastOfferAPI(offer, agg, 0, nil, "", 10_000).Analysis.FullVolume

	pos := full.Costs.Hedge.Position
	if pos == nil {
		t.Fatal("expected hedge position to be populated from persisted averages")
	}
	if !pos.Historical {
		t.Fatal("expected position.Historical = true for a past offer")
	}
	assertFloat(t, pos.HedgeNotionalEUR, 50)
	assertFloat(t, pos.LeverageUsed, 5)
	assertFloat(t, pos.RecommendedCollateral, 15)
	assertFloat(t, pos.BTCPrice, 100) // avg_ref_price from the fixture
}

func TestPastOfferCappedHedgePositionScalesWithTradeSize(t *testing.T) {
	oldEstimators := tradeCostEstimators
	t.Cleanup(func() { tradeCostEstimators = oldEstimators })
	tradeCostEstimators = map[string]*tradecost.TradeCostEstimator{
		"kraken": fixedCostEstimatorWithHedge("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.0001, 0.0009),
	}

	offer := storedPastOfferFixture("buy")
	offer["btc_min"] = 0.01
	offer["btc_max"] = 1.0
	agg := pastLifecycleAggregate{
		AvgHedgeNotionalEUR:         50,
		AvgLeverageUsed:             5,
		AvgRecommendedCollateral: 15,
	}

	// maxFiatLimitEUR=5 with avg_ref_price=100 caps the trade at 0.05 BTC —
	// 1/20th of the full 1.0 BTC size.
	got := buildPastOfferAPI(offer, agg, 0, nil, "", 5)
	if got.Analysis.CappedVolume == nil {
		t.Fatal("expected capped volume scenario")
	}

	pos := got.Analysis.CappedVolume.Costs.Hedge.Position
	if pos == nil {
		t.Fatal("expected capped hedge position to be populated from persisted averages")
	}
	if !pos.Historical {
		t.Fatal("expected position.Historical = true for a past offer")
	}
	assertFloat(t, pos.HedgeNotionalEUR, 2.5)          // 50 * (0.05/1.0)
	assertFloat(t, pos.RecommendedCollateral, 0.75) // 15 * (0.05/1.0)
	assertFloat(t, pos.LeverageUsed, 5)                // leverage doesn't scale with size
}

func TestPastOfferCappedAnalysisKeepsStoredRouteAndFixedTransferCosts(t *testing.T) {
	oldEstimators := tradeCostEstimators
	t.Cleanup(func() { tradeCostEstimators = oldEstimators })
	est := fixedCostEstimator("kraken", "bisq", 0.01, 0.99, 0.002, 0.99)
	est = tradecost.NewFixedEstimatorWithHedgeRatesForTesting("kraken", "bisq", 0.01, 0.99, 0.002, 0.99, 0.001, 0.002, 0.003)
	tradeCostEstimators = map[string]*tradecost.TradeCostEstimator{"kraken": est}

	offer := storedPastOfferFixture("buy")
	offer["btc_min"] = 0.01
	offer["btc_max"] = 1.0
	offer["avg_ref_price"] = 100.0
	offer["network_fee_btc"] = 0.0003
	offer["cex_withdraw_fee_btc"] = 0.0007
	offer["hedge_transfer_minutes"] = int64(42)
	got := buildPastOfferAPI(offer, pastLifecycleAggregate{}, 0, nil, "", 5)
	if got.Analysis.CappedVolume == nil {
		t.Fatal("expected capped volume scenario")
	}

	capped := got.Analysis.CappedVolume
	if capped.Route.CEX != "kraken" || capped.Route.Settlement != "onchain" {
		t.Fatalf("capped route = %#v, want stored kraken/onchain", capped.Route)
	}
	assertFloat(t, capped.TradeSizeBTC, 0.05)
	assertFloat(t, capped.Costs.Network.BTC, 0.0003)
	assertFloat(t, capped.Costs.Withdrawal.BTC, 0.0007)
	assertFloat(t, capped.Costs.CexTaker.BTC, 0.0005)
	assertFloat(t, capped.Costs.DexFee.BTC, 0.0001)
	assertFloat(t, capped.Costs.Hedge.OpenFeeBTC, 0.00005)
	assertFloat(t, capped.Costs.Hedge.CloseFeeBTC, 0.0001)
	assertFloat(t, capped.Costs.Hedge.FundingFeeBTC, 0.00015)
	if capped.Costs.Hedge.TransferMinutes != 42 {
		t.Fatalf("hedge transfer minutes = %d, want 42", capped.Costs.Hedge.TransferMinutes)
	}
	if capped.CostPolicy != "historical_route_fixed_transfer_recomputed_size_proportional" {
		t.Fatalf("cost policy = %q", capped.CostPolicy)
	}
}

func TestPastOfferCappedAskOmitsWithdrawalAndIncludesLongHedgeCosts(t *testing.T) {
	oldEstimators := tradeCostEstimators
	t.Cleanup(func() { tradeCostEstimators = oldEstimators })
	tradeCostEstimators = map[string]*tradecost.TradeCostEstimator{
		"kraken": fixedCostEstimatorWithHedge("kraken", "bisq", 0.01, 0.99, 0.002, 0.99, 0.25),
	}

	offer := storedPastOfferFixture("sell")
	offer["btc_min"] = 0.01
	offer["btc_max"] = 1.0
	offer["avg_ref_price"] = 100.0
	offer["cex_withdraw_fee_btc"] = 0.0007
	offer["network_fee_btc"] = 0.0003
	got := buildPastOfferAPI(offer, pastLifecycleAggregate{}, 0, nil, "", 5)
	if got.Analysis.CappedVolume == nil {
		t.Fatal("expected capped volume scenario")
	}
	capped := got.Analysis.CappedVolume
	assertFloat(t, capped.Costs.Withdrawal.BTC, 0)
	assertFloat(t, capped.Costs.Hedge.FeeSumBTC, 0.25)
	if capped.Costs.Hedge.Side != "long" {
		t.Fatalf("hedge side = %q, want long", capped.Costs.Hedge.Side)
	}
	assertFloat(t, capped.Costs.Network.BTC, 0.0003)
}

func TestPastCappedCostVariesBySizeThroughProportionalAndFixedComponents(t *testing.T) {
	oldEstimators := tradeCostEstimators
	t.Cleanup(func() { tradeCostEstimators = oldEstimators })
	tradeCostEstimators = map[string]*tradecost.TradeCostEstimator{
		"kraken": fixedCostEstimator("kraken", "bisq", 0.01, 0.99, 0.002, 0.99),
	}

	offer := storedPastOfferFixture("buy")
	offer["network_fee_btc"] = 0.0003
	offer["cex_withdraw_fee_btc"] = 0.0007
	offer["hedge_fee_sum_btc"] = 0.0
	offer["hedge_open_fee_btc"] = 0.0
	offer["hedge_close_fee_btc"] = 0.0
	offer["hedge_funding_fee_btc"] = 0.0
	larger := buildCappedPastBreakdown(offer, 1, 0.10, 100, 5, 0, 0, 0)
	smaller := buildCappedPastBreakdown(offer, 1, 0.05, 100, 5, 0, 0, 0)

	assertFloat(t, larger.TotalCostBTC, 0.0022)
	assertFloat(t, smaller.TotalCostBTC, 0.0016)
	if smaller.TotalCostPct <= larger.TotalCostPct {
		t.Fatalf("smaller cap total pct = %.4f, larger = %.4f; fixed costs should weigh more at smaller size", smaller.TotalCostPct, larger.TotalCostPct)
	}
}

func TestPastOffersCompactOmitsHeavyAnalysis(t *testing.T) {
	withTempOrdersDB(t)

	req := httptest.NewRequest(http.MethodGet, "/api/past_offers?hours=100000&limit=100&compact=true", nil)
	rec := httptest.NewRecorder()

	handlePastOffers(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var offers []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &offers); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(offers) == 0 {
		t.Fatal("compact past_offers returned no offers")
	}
	if _, ok := offers[0]["analysis"]; ok {
		t.Fatalf("compact offer unexpectedly included analysis: %#v", offers[0])
	}
	if _, ok := offers[0]["pricing"]; !ok {
		t.Fatalf("compact offer missing pricing: %#v", offers[0])
	}
	if _, ok := offers[0]["volume_limits"]; !ok {
		t.Fatalf("compact offer missing volume_limits: %#v", offers[0])
	}
}

func TestPastOffersFiltersFiatBeforeLimitAndSerializesStoredCurrency(t *testing.T) {
	withTempOrdersDB(t)

	tx, err := db.Begin()
	if err != nil {
		t.Fatalf("begin insert: %v", err)
	}
	for i := 0; i < 1001; i++ {
		if _, err := tx.Exec(`
			INSERT INTO offers (
				exchange, fiat_currency, direction, price, offer_id,
				avg_ref_price, first_seen, last_seen, is_live
			) VALUES ('bisq', 'USD', 'buy', 101, ?, 100, datetime('now', '-2 minutes'), datetime('now', '-1 minute'), 0)
		`, "newer-usd-"+strconv.Itoa(i)); err != nil {
			_ = tx.Rollback()
			t.Fatalf("insert USD offer %d: %v", i, err)
		}
	}
	if _, err := tx.Exec(`
		INSERT INTO offers (
			exchange, fiat_currency, direction, price, offer_id,
			avg_ref_price, first_seen, last_seen, is_live
		) VALUES ('bisq', 'GBP', 'buy', 81, 'target-gbp', 80, datetime('now', '-20 minutes'), datetime('now', '-10 minutes'), 0)
	`); err != nil {
		_ = tx.Rollback()
		t.Fatalf("insert GBP offer: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit inserts: %v", err)
	}

	for _, compact := range []bool{true, false} {
		path := "/api/past_offers?hours=24&limit=1&fiat=gbp"
		if compact {
			path += "&compact=true"
		}
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		handlePastOffers(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("compact=%v status=%d body=%s", compact, rec.Code, rec.Body.String())
		}
		var offers []map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &offers); err != nil {
			t.Fatalf("compact=%v decode: %v", compact, err)
		}
		if len(offers) != 1 || offers[0]["offer_id"] != "target-gbp" {
			t.Fatalf("compact=%v offers=%#v, want target-gbp", compact, offers)
		}
		pricing, _ := offers[0]["pricing"].(map[string]any)
		if pricing["fiat_currency"] != "GBP" {
			t.Fatalf("compact=%v fiat=%v, want GBP", compact, pricing["fiat_currency"])
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/api/past_offers?fiat=XYZ", nil)
	rec := httptest.NewRecorder()
	handlePastOffers(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid fiat status=%d, want %d", rec.Code, http.StatusBadRequest)
	}
}

func TestPastOrderStatsAndPastOffersRespectExcludedPaymentMethods(t *testing.T) {
	withTempOrdersDB(t)

	statsReq := httptest.NewRequest(http.MethodGet, "/api/past_order_stats?exclude_payment_methods=Revolut&premium_mode=net_full", nil)
	statsRec := httptest.NewRecorder()
	handlePastOrderStats(statsRec, statsReq)

	if statsRec.Code != http.StatusOK {
		t.Fatalf("stats status = %d, want %d; body=%s", statsRec.Code, http.StatusOK, statsRec.Body.String())
	}

	var stats pastOrderStatsTestResponse
	if err := json.Unmarshal(statsRec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode stats response: %v", err)
	}
	if len(stats.ExcludedPaymentMethods) != 1 || stats.ExcludedPaymentMethods[0] != "Revolut" {
		t.Fatalf("excluded methods = %#v, want [Revolut]", stats.ExcludedPaymentMethods)
	}
	if oneHour := findStatsTimeframe(t, stats.Timeframes, "1h"); oneHour.PremiumOrderCount != 0 {
		t.Fatalf("excluded 1h premium count = %d, want 0", oneHour.PremiumOrderCount)
	}
	if sixHour := findStatsTimeframe(t, stats.Timeframes, "6h"); sixHour.PremiumOrderCount != 1 {
		t.Fatalf("excluded 6h premium count = %d, want 1", sixHour.PremiumOrderCount)
	}

	offersReq := httptest.NewRequest(http.MethodGet, "/api/past_offers?hours=6&limit=100&exclude_payment_methods=Revolut", nil)
	offersRec := httptest.NewRecorder()
	handlePastOffers(offersRec, offersReq)

	if offersRec.Code != http.StatusOK {
		t.Fatalf("offers status = %d, want %d; body=%s", offersRec.Code, http.StatusOK, offersRec.Body.String())
	}

	var offers []map[string]any
	if err := json.Unmarshal(offersRec.Body.Bytes(), &offers); err != nil {
		t.Fatalf("decode offers response: %v", err)
	}
	for _, offer := range offers {
		if offer["payment_method"] == "Revolut" {
			t.Fatalf("past_offers response included excluded Revolut offer: %#v", offer)
		}
		if status, ok := offer["status"].(map[string]any); ok {
			if status["is_live"] != false {
				t.Fatalf("past_offers response returned non-closed offer: %#v", offer)
			}
		}
	}
}

func TestOfferHasExcludedPaymentMethodMatchesAnyArrayElement(t *testing.T) {
	// After migration 20260629 offers carry payment_methods as a Postgres TEXT[]
	// literal; exclusion must match ANY element. The pre-fix code read the dropped
	// scalar payment_method column, so every exclusion silently no-op'd.
	multi := map[string]any{"payment_methods": `{SEPA,"SEPA Instant",Revolut}`}
	if !offerHasExcludedPaymentMethod(multi, []string{"Revolut"}) {
		t.Fatal("expected an offer whose array contains Revolut to be excluded")
	}
	if offerHasExcludedPaymentMethod(multi, []string{"Wise"}) {
		t.Fatal("did not expect exclusion when no array element matches")
	}
	if offerHasExcludedPaymentMethod(multi, nil) {
		t.Fatal("empty exclusion set must never exclude")
	}
	// The removed scalar column must not drive the filter anymore.
	scalarOnly := map[string]any{"payment_method": "Revolut"}
	if offerHasExcludedPaymentMethod(scalarOnly, []string{"Revolut"}) {
		t.Fatal("must read payment_methods (TEXT[]), not the removed scalar payment_method")
	}
}

func TestPastProfitableOrdersReturnsClosedNetPositiveOrders(t *testing.T) {
	withTempOrdersDB(t)

	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)
	est.SetFixedDexFeeForTesting("hodlhodl", 0.001)
	est.SetFixedDexFeeForTesting("robosats", 0.001)
	tradeCostEstimators = map[string]*tradecost.TradeCostEstimator{"kraken": est}
	tradeRouteOptimizer = tradecost.NewTradeRouteOptimizer(tradeCostEstimators)

	req := httptest.NewRequest(http.MethodGet, "/api/past_profitable_orders?premium_mode=net_capped&max_fiat_limit=5&exclude_payment_methods=Revolut", nil)
	rec := httptest.NewRecorder()

	handlePastProfitableOrders(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var orders []struct {
		ID            int64   `json:"id"`
		PaymentMethod *string `json:"payment_method"`
		Status        struct {
			IsLive bool `json:"is_live"`
		} `json:"status"`
		Summary struct {
			NetProfitBTC  float64  `json:"net_profit_btc"`
			NetProfitFiat float64  `json:"net_profit_fiat"`
			TradeSizeBTC  float64  `json:"trade_size_btc"`
			CapFiat       *float64 `json:"cap_fiat"`
		} `json:"summary"`
		Offer map[string]any `json:"offer"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &orders); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(orders) == 0 {
		t.Fatal("expected profitable past orders, got none")
	}

	for _, order := range orders {
		if order.Status.IsLive {
			t.Fatalf("expected closed order, got live order %#v", order)
		}
		if order.PaymentMethod != nil && *order.PaymentMethod == "Revolut" {
			t.Fatalf("response included excluded payment method: %#v", order)
		}
		if order.Summary.NetProfitBTC <= 0 || order.Summary.NetProfitFiat <= 0 {
			t.Fatalf("expected positive profit summary, got %#v", order.Summary)
		}
		if order.Summary.TradeSizeBTC <= 0 {
			t.Fatalf("expected positive trade size, got %#v", order.Summary)
		}
		if _, ok := order.Offer["avg_estimated_profit_btc"]; !ok {
			t.Fatalf("offer payload missing avg_estimated_profit_btc: %#v", order.Offer)
		}
		if _, ok := order.Offer["is_live"]; !ok {
			t.Fatalf("offer payload missing is_live: %#v", order.Offer)
		}
		if order.Summary.CapFiat == nil {
			t.Fatalf("expected capped summary when max_fiat_limit is set, got %#v", order.Summary)
		}
	}
}

func TestPastOrderStatsNetCappedModeUsesCappedProfitableSet(t *testing.T) {
	withTempOrdersDB(t)

	req := httptest.NewRequest(http.MethodGet, "/api/past_order_stats?fiat=eur&premium_mode=net_capped&max_fiat_limit=5", nil)
	rec := httptest.NewRecorder()

	handlePastOrderStats(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var stats pastOrderStatsTestResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	oneHour := findStatsTimeframe(t, stats.Timeframes, "1h")
	if oneHour.PremiumOrderCount != 2 {
		t.Fatalf("1h premium count = %d, want 2", oneHour.PremiumOrderCount)
	}
	if oneHour.TotalProfitBTC <= 0 || oneHour.TotalProfitFiat <= 0 {
		t.Fatalf("expected positive capped profits, got %#v", oneHour)
	}
}

func TestHandlePastOfferLifecycleReturnsLifecyclePoints(t *testing.T) {
	withTempOrdersDB(t)

	if _, err := db.Exec(`
		INSERT INTO order_lifecycle (offer_db_id, snapshot_time, price, ref_price, premium_pct, net_premium_pct)
		VALUES (1, CURRENT_TIMESTAMP, 64000, 63200, 1.27, 1.25)
	`); err != nil {
		t.Fatalf("insert lifecycle row: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/past_offers/1/lifecycle", nil)
	req.SetPathValue("id", "1")
	rec := httptest.NewRecorder()

	handlePastOfferLifecycle(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var points []LifecyclePoint
	if err := json.Unmarshal(rec.Body.Bytes(), &points); err != nil {
		t.Fatalf("decode lifecycle response: %v", err)
	}
	if len(points) == 0 {
		t.Fatal("expected lifecycle points, got none")
	}
	if points[0].Time == "" {
		t.Fatalf("expected lifecycle time, got %#v", points[0])
	}
}

func TestSnapshotLogCompactAndDetail(t *testing.T) {
	withTempOrdersDB(t)

	if _, err := db.Exec(`
		INSERT INTO snapshot_log (timestamp, exchanges, offers_count)
		VALUES (datetime('now'), '{"bisq":{"count":2,"ids":["a","b"]},"robosats":{"count":1,"ids":["c"]}}', 3)
	`); err != nil {
		t.Fatalf("insert snapshot log: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/snapshot-log?limit=1&compact=true", nil)
	rec := httptest.NewRecorder()
	handleSnapshotLog(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("compact status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var compact []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &compact); err != nil {
		t.Fatalf("decode compact response: %v", err)
	}
	bisq := compact[0]["exchanges"].(map[string]any)["bisq"].(map[string]any)
	if bisq["count"].(float64) != 2 {
		t.Fatalf("compact bisq count = %#v, want 2", bisq["count"])
	}
	if _, ok := bisq["ids"]; ok {
		t.Fatalf("compact response included ids: %#v", bisq)
	}

	id := int64(compact[0]["id"].(float64))
	detailReq := httptest.NewRequest(http.MethodGet, "/api/snapshot-log/1", nil)
	detailReq.SetPathValue("id", strconv.FormatInt(id, 10))
	detailRec := httptest.NewRecorder()
	handleSnapshotLogDetail(detailRec, detailReq)

	if detailRec.Code != http.StatusOK {
		t.Fatalf("detail status = %d, want %d; body=%s", detailRec.Code, http.StatusOK, detailRec.Body.String())
	}
	var detail map[string]any
	if err := json.Unmarshal(detailRec.Body.Bytes(), &detail); err != nil {
		t.Fatalf("decode detail response: %v", err)
	}
	detailBisq := detail["exchanges"].(map[string]any)["bisq"].(map[string]any)
	if ids, ok := detailBisq["ids"].([]any); !ok || len(ids) != 2 {
		t.Fatalf("detail bisq ids = %#v, want 2 ids", detailBisq["ids"])
	}
}

func TestGeneralStatsOverviewRESTRespectsExcludedPaymentMethods(t *testing.T) {
	withTempOrdersDB(t)

	req := httptest.NewRequest(http.MethodGet, "/api/general_stats/overview?hours=48&exclude_payment_methods=Revolut", nil)
	rec := httptest.NewRecorder()

	handleGeneralStatsOverview(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var stats struct {
		TotalOffers      int `json:"total_offers"`
		ActiveOffers     int `json:"active_offers"`
		OffersByExchange []struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		} `json:"offers_by_exchange"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if stats.TotalOffers != 2 {
		t.Fatalf("total offers = %d, want 2", stats.TotalOffers)
	}
	if stats.ActiveOffers != 1 {
		t.Fatalf("active offers = %d, want 1", stats.ActiveOffers)
	}
	if len(stats.OffersByExchange) != 1 || stats.OffersByExchange[0].Name != "bisq" || stats.OffersByExchange[0].Count != 1 {
		t.Fatalf("offers_by_exchange = %#v, want [{bisq 1}]", stats.OffersByExchange)
	}
}

func TestDashboardAnalyticsRESTBundlesPayload(t *testing.T) {
	withTempOrdersDB(t)

	body := `{"hours":48,"cex":"kraken","exclude_payment_methods":["Revolut"],"fiat":"EUR"}`
	req := httptest.NewRequest(http.MethodPost, "/api/dashboard/analytics", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleDashboardAnalytics(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp dashboardAnalyticsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.GeneralStatsOverview.TotalOffers != 2 {
		t.Fatalf("total offers = %d, want 2", resp.GeneralStatsOverview.TotalOffers)
	}
	if len(resp.PastPremiums) == 0 {
		t.Fatal("expected past premium frames in bundled response")
	}
	if resp.PremiumLifetimes.Raw.AvgOfferLifetimeMs == nil && resp.PremiumLifetimes.NetFull.AvgOfferLifetimeMs == nil {
		t.Fatal("expected premium lifetimes in bundled response")
	}
	if resp.PastProfitableOrders == nil {
		t.Fatal("expected past_profitable_orders in bundled response")
	}
}

func TestDashboardAnalyticsSectionsFiltersPayload(t *testing.T) {
	withTempOrdersDB(t)

	body := `{"hours":48,"cex":"kraken","sections":["taker_orders"],"fiat":"EUR"}`
	req := httptest.NewRequest(http.MethodPost, "/api/dashboard/analytics", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleDashboardAnalytics(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp dashboardAnalyticsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.GeneralStatsOverview.TotalOffers != 0 {
		t.Fatalf("overview should be omitted, got total offers = %d", resp.GeneralStatsOverview.TotalOffers)
	}
	if len(resp.PastOrderStats.Timeframes) != 0 {
		t.Fatal("taker stats should be omitted for taker_orders-only request")
	}
	if resp.PastProfitableOrders == nil {
		t.Fatal("expected past_profitable_orders for taker_orders section")
	}
}

func TestDashboardAnalyticsOrdersFullSectionReturnsCompactRows(t *testing.T) {
	withTempOrdersDB(t)

	body := `{"hours":48,"cex":"kraken","sections":["taker_orders_full"],"fiat":"EUR"}`
	req := httptest.NewRequest(http.MethodPost, "/api/dashboard/analytics", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleDashboardAnalytics(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp dashboardAnalyticsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.PastProfitableOrdersCompact) == 0 {
		t.Fatal("expected compact profitable orders for taker_orders_full section")
	}
	if resp.PastProfitableOrders != nil {
		t.Fatalf("expected detailed past_profitable_orders omitted, got %d orders", len(resp.PastProfitableOrders))
	}
	if resp.PastProfitableOrdersCompact[0].Summary.TradeSizeBTC <= 0 {
		t.Fatalf("expected compact summary trade size, got %+v", resp.PastProfitableOrdersCompact[0].Summary)
	}
}

func TestDashboardAnalyticsOverviewSectionOmitsOrders(t *testing.T) {
	withTempOrdersDB(t)

	body := `{"hours":48,"cex":"kraken","sections":["overview","taker_stats"],"fiat":"EUR"}`
	req := httptest.NewRequest(http.MethodPost, "/api/dashboard/analytics", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleDashboardAnalytics(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if got := rec.Header().Get("Server-Timing"); got == "" {
		t.Fatal("expected Server-Timing header on analytics response")
	}

	var resp dashboardAnalyticsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.GeneralStatsOverview.TotalOffers == 0 {
		t.Fatal("expected overview stats in overview section response")
	}
	if len(resp.PastOrderStatsAll.Timeframes) == 0 {
		t.Fatal("expected taker stats in overview+taker_stats response")
	}
	if resp.PastProfitableOrders != nil {
		t.Fatalf("expected orders omitted, got %d orders", len(resp.PastProfitableOrders))
	}
}

func TestDashboardAnalyticsStatsFullSectionOmitsCappedAndOrders(t *testing.T) {
	withTempOrdersDB(t)

	body := `{"hours":48,"cex":"kraken","sections":["overview","taker_stats_full"],"fiat":"EUR"}`
	req := httptest.NewRequest(http.MethodPost, "/api/dashboard/analytics", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	handleDashboardAnalytics(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp dashboardAnalyticsResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.GeneralStatsOverview.TotalOffers == 0 {
		t.Fatal("expected overview stats in overview+taker_stats_full response")
	}
	if len(resp.PastOrderStatsAll.Timeframes) == 0 {
		t.Fatal("expected full taker stats in taker_stats_full response")
	}
	if len(resp.PastOrderStatsAllNetCapped.Timeframes) != 0 || len(resp.PastOrderStatsNetCapped.Timeframes) != 0 {
		t.Fatal("expected capped taker stats omitted for taker_stats_full response")
	}
	if resp.PastProfitableOrders != nil {
		t.Fatalf("expected orders omitted, got %d orders", len(resp.PastProfitableOrders))
	}
}

func TestDashboardAnalyticsOrdersSectionReusesCache(t *testing.T) {
	withTempOrdersDB(t)

	warmBody := `{"hours":48,"cex":"kraken","sections":["overview","taker_stats"],"fiat":"EUR"}`
	warmReq := httptest.NewRequest(http.MethodPost, "/api/dashboard/analytics", strings.NewReader(warmBody))
	warmReq.Header.Set("Content-Type", "application/json")
	warmRec := httptest.NewRecorder()
	handleDashboardAnalytics(warmRec, warmReq)
	if warmRec.Code != http.StatusOK {
		t.Fatalf("warm status = %d, want %d; body=%s", warmRec.Code, http.StatusOK, warmRec.Body.String())
	}

	ordersBody := `{"hours":48,"cex":"kraken","sections":["taker_orders"],"fiat":"EUR"}`
	buildStart := time.Now()
	buildReq := httptest.NewRequest(http.MethodPost, "/api/dashboard/analytics", strings.NewReader(ordersBody))
	buildReq.Header.Set("Content-Type", "application/json")
	buildRec := httptest.NewRecorder()
	handleDashboardAnalytics(buildRec, buildReq)
	buildElapsed := time.Since(buildStart)
	if buildRec.Code != http.StatusOK {
		t.Fatalf("orders build status = %d, want %d; body=%s", buildRec.Code, http.StatusOK, buildRec.Body.String())
	}
	var built dashboardAnalyticsResponse
	if err := json.Unmarshal(buildRec.Body.Bytes(), &built); err != nil {
		t.Fatalf("decode orders build response: %v", err)
	}
	if built.PastProfitableOrders == nil {
		t.Fatal("expected past_profitable_orders after orders section build")
	}

	cacheStart := time.Now()
	cacheReq := httptest.NewRequest(http.MethodPost, "/api/dashboard/analytics", strings.NewReader(ordersBody))
	cacheReq.Header.Set("Content-Type", "application/json")
	cacheRec := httptest.NewRecorder()
	handleDashboardAnalytics(cacheRec, cacheReq)
	cacheElapsed := time.Since(cacheStart)
	if cacheRec.Code != http.StatusOK {
		t.Fatalf("orders cache status = %d, want %d; body=%s", cacheRec.Code, http.StatusOK, cacheRec.Body.String())
	}
	if cacheElapsed > 200*time.Millisecond {
		t.Fatalf("cached taker_orders request took %v, want <= 200ms", cacheElapsed)
	}
	if buildElapsed > 2*time.Second {
		t.Fatalf("initial taker_orders build took %v, want <= 2s on temp DB", buildElapsed)
	}
}

// TestDashboardAnalyticsFastSectionsDoNotWaitOnCappedBuild guards against the
// offers table queueing behind the slow capped build: when the three page
// requests race and the capped one registers its in-flight build first, the
// taker_orders_full request must self-build (milliseconds) instead of waiting
// for the capped build's order_lifecycle aggregate (seconds).
func TestDashboardAnalyticsFastSectionsDoNotWaitOnCappedBuild(t *testing.T) {
	withTempOrdersDB(t)

	p := dashboardAnalyticsParams{
		Hours:    48,
		Cex:      "kraken",
		Fiat:     "EUR",
		Sections: []string{analyticsSectionTakerOrdersFull},
	}
	key := p.analyticsResultCacheKey()

	// A capped-sections build that never completes.
	stuck := &analyticsInFlightEntry{
		plan: analyticsBuildPlan{stats: true, orders: true},
		done: make(chan struct{}),
	}
	analyticsResultCache.Lock()
	if analyticsResultCache.inFlight == nil {
		analyticsResultCache.inFlight = make(map[string][]*analyticsInFlightEntry)
	}
	analyticsResultCache.inFlight[key] = append(analyticsResultCache.inFlight[key], stuck)
	analyticsResultCache.Unlock()
	t.Cleanup(func() { resetAnalyticsCaches() })

	type buildResult struct {
		resp    dashboardAnalyticsResponse
		timings analyticsBuildTimings
		err     error
	}
	results := make(chan buildResult, 1)
	go func() {
		resp, timings, err := buildDashboardAnalyticsResponse(p)
		results <- buildResult{resp, timings, err}
	}()

	select {
	case got := <-results:
		if got.err != nil {
			t.Fatalf("fast build failed: %v", got.err)
		}
		if got.timings.waitedOnInFlight {
			t.Fatal("fast section waited on the in-flight capped build")
		}
		if len(got.resp.PastProfitableOrdersCompact) == 0 {
			t.Fatal("expected compact profitable orders from self-built fast section")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("taker_orders_full request blocked behind the stuck capped build")
	}
}

// TestDashboardAnalyticsCappedBuildDoesNotSatisfyOrdersFull guards against a
// capped-only build being cached as if it also produced the compact orders
// list: the capped orders build fills past_profitable_orders only, so a
// following taker_orders_full request must build (and get) real compact rows
// rather than an empty list served from the capped entry.
func TestDashboardAnalyticsCappedBuildDoesNotSatisfyOrdersFull(t *testing.T) {
	withTempOrdersDB(t)

	cappedBody := `{"hours":48,"cex":"kraken","sections":["taker_stats","taker_orders"],"fiat":"EUR"}`
	cappedReq := httptest.NewRequest(http.MethodPost, "/api/dashboard/analytics", strings.NewReader(cappedBody))
	cappedReq.Header.Set("Content-Type", "application/json")
	cappedRec := httptest.NewRecorder()
	handleDashboardAnalytics(cappedRec, cappedReq)
	if cappedRec.Code != http.StatusOK {
		t.Fatalf("capped status = %d; body=%s", cappedRec.Code, cappedRec.Body.String())
	}

	fastBody := `{"hours":48,"cex":"kraken","sections":["taker_orders_full"],"fiat":"EUR"}`
	fastReq := httptest.NewRequest(http.MethodPost, "/api/dashboard/analytics", strings.NewReader(fastBody))
	fastReq.Header.Set("Content-Type", "application/json")
	fastRec := httptest.NewRecorder()
	handleDashboardAnalytics(fastRec, fastReq)
	if fastRec.Code != http.StatusOK {
		t.Fatalf("fast status = %d; body=%s", fastRec.Code, fastRec.Body.String())
	}

	var resp dashboardAnalyticsResponse
	if err := json.Unmarshal(fastRec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.PastProfitableOrdersCompact) == 0 {
		t.Fatal("expected compact profitable orders after a capped-only build was cached")
	}
}

// TestDashboardAnalyticsConcurrentOrdersSectionsDoNotRaceOnSharedOfferMaps
// guards against a regression where addPastOfferCostFieldsFull mutated
// offer maps that came straight out of generalStatsCache (shared across
// requests for the same params). The frontend now fires taker_orders_full
// and taker_orders in parallel for the same params, so two goroutines could
// end up mutating and reading the exact same cached map concurrently — a
// fatal "concurrent map read and map write" crash in production, caught
// here via -race plus a plain status/data assertion.
func TestDashboardAnalyticsConcurrentOrdersSectionsDoNotRaceOnSharedOfferMaps(t *testing.T) {
	withTempOrdersDB(t)

	// Warm the general-stats cache so every request below resolves to the
	// exact same cached offer maps instead of each doing its own DB scan.
	warmBody := `{"hours":48,"cex":"kraken","sections":["overview","taker_stats"],"fiat":"EUR"}`
	warmReq := httptest.NewRequest(http.MethodPost, "/api/dashboard/analytics", strings.NewReader(warmBody))
	warmReq.Header.Set("Content-Type", "application/json")
	handleDashboardAnalytics(httptest.NewRecorder(), warmReq)

	const pairs = 15
	fullBody := `{"hours":48,"cex":"kraken","sections":["taker_orders_full"],"fiat":"EUR"}`
	cappedBody := `{"hours":48,"cex":"kraken","sections":["taker_orders"],"fiat":"EUR"}`

	statuses := make([]int, pairs*2)
	var wg sync.WaitGroup
	fire := func(idx int, body string) {
		defer wg.Done()
		req := httptest.NewRequest(http.MethodPost, "/api/dashboard/analytics", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handleDashboardAnalytics(rec, req)
		statuses[idx] = rec.Code
	}
	for i := 0; i < pairs; i++ {
		wg.Add(2)
		go fire(i*2, fullBody)
		go fire(i*2+1, cappedBody)
	}
	wg.Wait()

	for i, code := range statuses {
		if code != http.StatusOK {
			t.Fatalf("request %d status = %d, want %d", i, code, http.StatusOK)
		}
	}
}

func TestDashboardAnalyticsBuildPerformanceBudget(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping analytics performance budget in short mode")
	}
	withTempOrdersDB(t)

	body := `{"hours":48,"cex":"kraken","max_fiat_limit":300,"fiat":"EUR"}`
	start := time.Now()
	req := httptest.NewRequest(http.MethodPost, "/api/dashboard/analytics", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handleDashboardAnalytics(rec, req)
	elapsed := time.Since(start)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if elapsed > 2*time.Second {
		t.Fatalf("analytics build took %v, want <= 2s on temp DB", elapsed)
	}
}

func TestGeneralStatsPastPremiumsRESTIncludesFixedWindows(t *testing.T) {
	withTempOrdersDB(t)

	if _, err := db.Exec(`
		INSERT INTO offers (exchange, direction, price, btc_min, btc_max, payment_method, offer_id, avg_ref_price, avg_premium_pct, avg_net_premium_pct, first_seen, last_seen, is_live)
		VALUES
			('robosats', 'buy', 104, 0.1, 0.1, 'SEPA', 'robo-10h', 100, 4, 3, datetime('now', '-10 hours'), datetime('now', '-10 hours'), 0),
			('robosats', 'sell', 94, 0.1, 0.1, 'SEPA', 'robo-5d', 100, 6, 4, datetime('now', '-5 days'), datetime('now', '-5 days'), 0),
			('robosats', 'buy', 96, 0.1, 0.1, 'SEPA', 'robo-negative', 100, -4, -3, datetime('now', '-8 hours'), datetime('now', '-8 hours'), 0),
			('bisq', 'buy', 107, 0.1, 0.1, 'SEPA Instant', 'bisq-live', 100, 7, 6, datetime('now', '-20 minutes'), datetime('now', '-20 minutes'), 1)
	`); err != nil {
		t.Fatalf("insert extra offers: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/general_stats/past_premiums?hours=24", nil)
	rec := httptest.NewRecorder()

	handleGeneralStatsPastPremiums(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var pastPremiums []struct {
		Timeframe string `json:"timeframe"`
		Modes     struct {
			Raw []struct {
				Name          string  `json:"name"`
				AvgPremiumPct float64 `json:"avg_premium_pct"`
			} `json:"raw"`
			NetFull []struct {
				Name          string  `json:"name"`
				AvgPremiumPct float64 `json:"avg_premium_pct"`
			} `json:"net_full"`
			NetCapped []struct {
				Name          string  `json:"name"`
				AvgPremiumPct float64 `json:"avg_premium_pct"`
			} `json:"net_capped"`
		} `json:"modes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &pastPremiums); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	twentyFourHour := findPastPremiumFrame(t, pastPremiums, "24h")
	if len(twentyFourHour.Modes.Raw) == 0 {
		t.Fatal("24h raw past premiums unexpectedly empty")
	}
	if got := findNamedPremiumValue(t, twentyFourHour.Modes.Raw, "robosats"); got <= 0 {
		t.Fatalf("24h raw robosats avg = %v, want > 0", got)
	}
	if got := findNamedPremiumValue(t, twentyFourHour.Modes.NetFull, "robosats"); got <= 0 {
		t.Fatalf("24h net full robosats avg = %v, want > 0", got)
	}
	if got := findNamedPremiumValue(t, twentyFourHour.Modes.NetCapped, "robosats"); got <= 0 {
		t.Fatalf("24h net capped robosats avg = %v, want > 0", got)
	}

	sevenDay := findPastPremiumFrame(t, pastPremiums, "7d")
	if len(sevenDay.Modes.Raw) == 0 {
		t.Fatal("7d raw past premiums unexpectedly empty")
	}
	if got := findNamedPremiumValue(t, sevenDay.Modes.Raw, "robosats"); got <= 0 {
		t.Fatalf("7d raw robosats avg = %v, want > 0", got)
	}
	if got := findNamedPremiumValue(t, sevenDay.Modes.NetFull, "robosats"); got <= 0 {
		t.Fatalf("7d net full robosats avg = %v, want > 0", got)
	}
	if got := findNamedPremiumValue(t, sevenDay.Modes.NetCapped, "robosats"); got <= 0 {
		t.Fatalf("7d net capped robosats avg = %v, want > 0", got)
	}
}

func TestGeneralStatsDedicatedRESTEndpoints(t *testing.T) {
	withTempOrdersDB(t)

	overviewReq := httptest.NewRequest(http.MethodGet, "/api/general_stats/overview?hours=48&exclude_payment_methods=Revolut", nil)
	overviewRec := httptest.NewRecorder()
	handleGeneralStatsOverview(overviewRec, overviewReq)
	if overviewRec.Code != http.StatusOK {
		t.Fatalf("overview status = %d, want %d; body=%s", overviewRec.Code, http.StatusOK, overviewRec.Body.String())
	}
	var overview struct {
		TotalOffers         int `json:"total_offers"`
		ActiveOffers        int `json:"active_offers"`
		PaymentMethodCounts []struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		} `json:"payment_method_counts"`
	}
	if err := json.Unmarshal(overviewRec.Body.Bytes(), &overview); err != nil {
		t.Fatalf("decode overview response: %v", err)
	}
	if overview.TotalOffers != 2 || overview.ActiveOffers != 1 {
		t.Fatalf("overview totals = %d/%d, want 2/1", overview.TotalOffers, overview.ActiveOffers)
	}

	methodsReq := httptest.NewRequest(http.MethodGet, "/api/general_stats/payment_methods?hours=48", nil)
	methodsRec := httptest.NewRecorder()
	handleGeneralStatsPaymentMethods(methodsRec, methodsReq)
	if methodsRec.Code != http.StatusOK {
		t.Fatalf("payment methods status = %d, want %d; body=%s", methodsRec.Code, http.StatusOK, methodsRec.Body.String())
	}
	var paymentMethods []struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}
	if err := json.Unmarshal(methodsRec.Body.Bytes(), &paymentMethods); err != nil {
		t.Fatalf("decode payment methods response: %v", err)
	}
	if len(paymentMethods) == 0 {
		t.Fatal("payment methods response unexpectedly empty")
	}

	pastReq := httptest.NewRequest(http.MethodGet, "/api/general_stats/past_premiums?hours=24", nil)
	pastRec := httptest.NewRecorder()
	handleGeneralStatsPastPremiums(pastRec, pastReq)
	if pastRec.Code != http.StatusOK {
		t.Fatalf("past premiums status = %d, want %d; body=%s", pastRec.Code, http.StatusOK, pastRec.Body.String())
	}
	var pastPremiums []struct {
		Timeframe string `json:"timeframe"`
		Modes     struct {
			Raw []struct {
				Name          string  `json:"name"`
				AvgPremiumPct float64 `json:"avg_premium_pct"`
			} `json:"raw"`
			NetFull []struct {
				Name          string  `json:"name"`
				AvgPremiumPct float64 `json:"avg_premium_pct"`
			} `json:"net_full"`
			NetCapped []struct {
				Name          string  `json:"name"`
				AvgPremiumPct float64 `json:"avg_premium_pct"`
			} `json:"net_capped"`
		} `json:"modes"`
	}
	if err := json.Unmarshal(pastRec.Body.Bytes(), &pastPremiums); err != nil {
		t.Fatalf("decode past premiums response: %v", err)
	}
	twentyFourHour := findPastPremiumFrame(t, pastPremiums, "24h")
	if len(twentyFourHour.Modes.Raw) == 0 || len(twentyFourHour.Modes.NetFull) == 0 || len(twentyFourHour.Modes.NetCapped) == 0 {
		t.Fatalf("24h past premium modes unexpectedly empty: %#v", twentyFourHour.Modes)
	}

	lifetimesReq := httptest.NewRequest(http.MethodGet, "/api/general_stats/lifetimes?hours=24", nil)
	lifetimesRec := httptest.NewRecorder()
	handleGeneralStatsLifetimes(lifetimesRec, lifetimesReq)
	if lifetimesRec.Code != http.StatusOK {
		t.Fatalf("lifetimes status = %d, want %d; body=%s", lifetimesRec.Code, http.StatusOK, lifetimesRec.Body.String())
	}
	var lifetimes pastorders.PremiumLifetimeModes
	if err := json.Unmarshal(lifetimesRec.Body.Bytes(), &lifetimes); err != nil {
		t.Fatalf("decode lifetimes response: %v", err)
	}
	if lifetimes.Raw.AvgOfferLifetimeMs == nil {
		t.Fatal("raw lifetime avg is nil")
	}
}

func TestBuildPastPremiumStatsIgnoresNonPremiumOffers(t *testing.T) {
	now := time.Now().UTC()
	offers := []map[string]any{
		{
			"id":                  1.0,
			"exchange":            "robosats",
			"payment_method":      "SEPA",
			"direction":           "buy",
			"last_seen":           now.Add(-2 * time.Hour).Format("2006-01-02 15:04:05"),
			"is_live":             false,
			"avg_premium_pct":     4.0,
			"avg_net_premium_pct": 3.0,
			"avg_ref_price":       100.0,
			"btc_max":             0.1,
		},
		{
			"id":                  2.0,
			"exchange":            "robosats",
			"payment_method":      "SEPA",
			"direction":           "buy",
			"last_seen":           now.Add(-3 * time.Hour).Format("2006-01-02 15:04:05"),
			"is_live":             false,
			"avg_premium_pct":     -4.0,
			"avg_net_premium_pct": -3.0,
			"avg_ref_price":       100.0,
			"btc_max":             0.1,
		},
		{
			"id":                  3.0,
			"exchange":            "bisq",
			"payment_method":      "SEPA",
			"direction":           "sell",
			"last_seen":           now.Add(-4 * time.Hour).Format("2006-01-02 15:04:05"),
			"is_live":             false,
			"avg_premium_pct":     6.0,
			"avg_net_premium_pct": 5.0,
			"avg_ref_price":       100.0,
			"btc_max":             0.1,
		},
	}

	stats := buildPastPremiumStats(offers, map[int64]pastLifecycleAggregate{}, now, nil, 0, 0, nil, "")
	frame := stats[0] // 6h
	if len(frame.Modes.Raw) != 2 {
		t.Fatalf("6h raw len = %d, want 2", len(frame.Modes.Raw))
	}
	assertFloat(t, findNamedPremiumValueTyped(t, frame.Modes.Raw, "robosats"), 4)
	assertFloat(t, findNamedPremiumValueTyped(t, frame.Modes.Raw, "bisq"), 6)
	assertFloat(t, findNamedPremiumValueTyped(t, frame.Modes.NetFull, "robosats"), 3)
	assertFloat(t, findNamedPremiumValueTyped(t, frame.Modes.NetFull, "bisq"), 5)
	assertFloat(t, findNamedPremiumValueTyped(t, frame.Modes.NetCapped, "robosats"), 3)
	assertFloat(t, findNamedPremiumValueTyped(t, frame.Modes.NetCapped, "bisq"), 5)
}

func TestBuildPremiumLifetimeStatsIgnoresNonPremiumOffers(t *testing.T) {
	now := time.Now().UTC()
	offers := []map[string]any{
		{
			"id":                  1.0,
			"exchange":            "robosats",
			"payment_method":      "SEPA",
			"direction":           "buy",
			"first_seen":          now.Add(-3 * time.Hour).Format("2006-01-02 15:04:05"),
			"last_seen":           now.Format("2006-01-02 15:04:05"),
			"is_live":             false,
			"avg_premium_pct":     4.0,
			"avg_net_premium_pct": 3.0,
			"avg_ref_price":       100.0,
			"btc_max":             0.1,
		},
		{
			"id":                  2.0,
			"exchange":            "robosats",
			"payment_method":      "SEPA",
			"direction":           "buy",
			"first_seen":          now.Add(-6 * time.Hour).Format("2006-01-02 15:04:05"),
			"last_seen":           now.Add(-4 * time.Hour).Format("2006-01-02 15:04:05"),
			"is_live":             false,
			"avg_premium_pct":     -4.0,
			"avg_net_premium_pct": -3.0,
			"avg_ref_price":       100.0,
			"btc_max":             0.1,
		},
		{
			"id":                  3.0,
			"exchange":            "bisq",
			"payment_method":      "SEPA",
			"direction":           "sell",
			"first_seen":          now.Add(-7 * time.Hour).Format("2006-01-02 15:04:05"),
			"last_seen":           now.Add(-3 * time.Hour).Format("2006-01-02 15:04:05"),
			"is_live":             false,
			"avg_premium_pct":     6.0,
			"avg_net_premium_pct": 5.0,
			"avg_ref_price":       100.0,
			"btc_max":             0.1,
		},
	}

	stats := buildPremiumLifetimeStats(offers, map[int64]pastLifecycleAggregate{}, now, nil, 0, 0, nil, "")
	if stats.Raw.AvgOfferLifetimeMs == nil {
		t.Fatal("raw lifetime avg is nil")
	}
	if stats.NetFull.AvgOfferLifetimeMs == nil {
		t.Fatal("net full lifetime avg is nil")
	}
	if stats.NetCapped.AvgOfferLifetimeMs == nil {
		t.Fatal("net capped lifetime avg is nil")
	}
	assertFloat(t, float64(*stats.Raw.AvgOfferLifetimeMs), float64(int64((3*time.Hour+4*time.Hour)/2/time.Millisecond)))
	assertFloat(t, float64(*stats.NetFull.AvgOfferLifetimeMs), float64(int64((3*time.Hour+4*time.Hour)/2/time.Millisecond)))
	assertFloat(t, float64(*stats.NetCapped.AvgOfferLifetimeMs), float64(int64((3*time.Hour+4*time.Hour)/2/time.Millisecond)))
	if len(stats.Raw.AvgOfferLifetimeMsByExchange) != 2 {
		t.Fatalf("raw lifetime exchanges = %d, want 2", len(stats.Raw.AvgOfferLifetimeMsByExchange))
	}
}

// TestOfferStringSliceParsesPostgresTextArrayLiteral guards against a
// regression where payment_methods (a Postgres text[] column) rendered as
// e.g. `Payment{"Instant SEPA",Revolut}` in the frontend. The pgx stdlib
// driver hands scanOffers the raw array literal as a plain string (verified
// against a live DB — it does not parse it into a []string), and
// offerStringSlice used to wrap that whole literal as a single element
// instead of splitting it.
func TestOfferStringSliceParsesPostgresTextArrayLiteral(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want []string
	}{
		{"two plain elements", `{SEPA,Wise}`, []string{"SEPA", "Wise"}},
		{"quoted element with space", `{SEPA,"SEPA Instant",Wise}`, []string{"SEPA", "SEPA Instant", "Wise"}},
		{"multiple quoted elements", `{Monero,"Other coins","SOL XRP XLM","USDT LTC"}`, []string{"Monero", "Other coins", "SOL XRP XLM", "USDT LTC"}},
		{"single quoted element", `{"Cash by Mail"}`, []string{"Cash by Mail"}},
		{"empty array", `{}`, nil},
		{"plain non-array string (test fixtures)", `Revolut`, []string{"Revolut"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := offerStringSlice(map[string]any{"payment_methods": c.raw}, "payment_methods")
			if len(got) != len(c.want) {
				t.Fatalf("offerStringSlice(%q) = %#v, want %#v", c.raw, got, c.want)
			}
			for i := range got {
				if got[i] != c.want[i] {
					t.Fatalf("offerStringSlice(%q) = %#v, want %#v", c.raw, got, c.want)
				}
			}
		})
	}
}

func TestPaymentMethodChatTemplatesCRUD(t *testing.T) {
	withTempOrdersDB(t)

	oldPmRepo := pmRepo
	pmRepo = &paymentmethods.Repo{DB: db}
	t.Cleanup(func() {
		pmRepo = oldPmRepo
	})

	if _, err := db.Exec(`
		INSERT INTO payment_methods (id, name, category, is_active, priority)
		VALUES (1001, 'Revolut', 'Fiat Transmitter', 1, 5)
	`); err != nil {
		t.Fatalf("insert payment method: %v", err)
	}

	// GET returns an empty list initially.
	getRec := httptest.NewRecorder()
	getReq := httptest.NewRequest(http.MethodGet, "/api/trading/payment_methods/1001/chat_templates", nil)
	getReq.SetPathValue("id", "1001")
	handleTradingPaymentMethodChatTemplates(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("GET chat_templates status = %d, want %d", getRec.Code, http.StatusOK)
	}
	var emptyResp struct {
		ChatTemplates []paymentmethods.ChatTemplateRow `json:"chat_templates"`
	}
	if err := json.Unmarshal(getRec.Body.Bytes(), &emptyResp); err != nil {
		t.Fatalf("decode empty GET response: %v", err)
	}
	if len(emptyResp.ChatTemplates) != 0 {
		t.Fatalf("expected no chat templates initially, got %d", len(emptyResp.ChatTemplates))
	}

	// PUT creates a template.
	putRec := httptest.NewRecorder()
	putBody := `{"template":"Please send {{amount}} {{currency}} via Revolut.","is_active":true}`
	putReq := httptest.NewRequest(http.MethodPut, "/api/trading/payment_methods/1001/chat_templates/RoboSats", strings.NewReader(putBody))
	putReq.SetPathValue("id", "1001")
	putReq.SetPathValue("exchange", "RoboSats")
	handleTradingPaymentMethodChatTemplateByExchange(putRec, putReq)
	if putRec.Code != http.StatusOK {
		t.Fatalf("PUT chat_template status = %d, body = %s", putRec.Code, putRec.Body.String())
	}
	var putResp struct {
		ChatTemplates []paymentmethods.ChatTemplateRow `json:"chat_templates"`
	}
	if err := json.Unmarshal(putRec.Body.Bytes(), &putResp); err != nil {
		t.Fatalf("decode PUT response: %v", err)
	}
	if len(putResp.ChatTemplates) != 1 {
		t.Fatalf("expected 1 chat template after PUT, got %d", len(putResp.ChatTemplates))
	}
	if putResp.ChatTemplates[0].Exchange != "RoboSats" || putResp.ChatTemplates[0].Template != "Please send {{amount}} {{currency}} via Revolut." {
		t.Fatalf("unexpected chat template: %+v", putResp.ChatTemplates[0])
	}

	// Reject an invalid exchange.
	badRec := httptest.NewRecorder()
	badReq := httptest.NewRequest(http.MethodPut, "/api/trading/payment_methods/1001/chat_templates/Bisq", strings.NewReader(putBody))
	badReq.SetPathValue("id", "1001")
	badReq.SetPathValue("exchange", "Bisq")
	handleTradingPaymentMethodChatTemplateByExchange(badRec, badReq)
	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("invalid exchange status = %d, want %d", badRec.Code, http.StatusBadRequest)
	}

	// DELETE removes the template.
	delRec := httptest.NewRecorder()
	delReq := httptest.NewRequest(http.MethodDelete, "/api/trading/payment_methods/1001/chat_templates/RoboSats", nil)
	delReq.SetPathValue("id", "1001")
	delReq.SetPathValue("exchange", "RoboSats")
	handleTradingPaymentMethodChatTemplateByExchange(delRec, delReq)
	if delRec.Code != http.StatusOK {
		t.Fatalf("DELETE chat_template status = %d", delRec.Code)
	}
}

func resetAnalyticsCaches() {
	analyticsResultCache.Lock()
	analyticsResultCache.entries = nil
	analyticsResultCache.inFlight = nil
	analyticsResultCache.Unlock()

	statisticsResultCache.Lock()
	statisticsResultCache.entries = nil
	statisticsResultCache.Unlock()

	generalStatsCache.Lock()
	generalStatsCache.entries = nil
	generalStatsCache.inFlight = nil
	generalStatsCache.Unlock()

	lifecycleAggCache.Lock()
	lifecycleAggCache.key = ""
	lifecycleAggCache.result = nil
	lifecycleAggCache.expiry = time.Time{}
	lifecycleAggCache.Unlock()
}

func withTempOrdersDB(t *testing.T) {
	t.Helper()

	oldDB := db
	oldOptimizer := tradeRouteOptimizer
	oldEstimators := tradeCostEstimators
	t.Cleanup(func() {
		db = oldDB
		tradeRouteOptimizer = oldOptimizer
		tradeCostEstimators = oldEstimators
		resetAnalyticsCaches()
	})

	resetAnalyticsCaches()

	testDB, err := sql.Open("sqlite", t.TempDir()+"/orders.db")
	if err != nil {
		t.Fatalf("open temp db: %v", err)
	}
	t.Cleanup(func() {
		testDB.Close()
	})
	db = testDB

	if _, err := db.Exec(legacySQLiteOrdersSchema); err != nil {
		t.Fatalf("create schema: %v", err)
	}

	if _, err := db.Exec(`
		INSERT INTO offers (
			exchange, direction, price, btc_min, btc_max, payment_method, payment_methods, offer_id,
			avg_ref_price, avg_premium_pct, avg_trade_cost_pct, avg_trade_cost_btc,
			cex_taker_fee_btc, cex_withdraw_fee_btc, network_fee_btc, dex_fee_btc,
			avg_net_premium_pct, avg_estimated_profit_btc, avg_estimated_profit_fiat,
			best_route_cex, best_route_method, historical_analysis_status,
			first_seen, last_seen, is_live
		)
		VALUES
			('bisq', 'buy', 105, 0.01, 0.1, 'Revolut', 'Revolut', 'premium-30m', 100, 5, 1.00, 0.00100, 0.00025, 0.00015, 0.00010, 0.00010, 4.00, 0.00400, 0.40, 'kraken', 'onchain', 'analyzed', datetime('now', '-30 minutes'), datetime('now', '-30 minutes'), 0),
			('bisq', 'sell', 95, 0.02, 0.2, 'Wise', 'Wise', 'premium-5h', 100, 5, 0.37, 0.00074, 0.00050, NULL, 0.00004, 0.00020, 4.63, 0.00926, 0.93, 'kraken', 'onchain', 'analyzed', datetime('now', '-7 hours'), datetime('now', '-5 hours'), 0),
			('bisq', 'buy', 105, 0.03, 0.3, 'SEPA', 'SEPA', 'premium-30h', 100, 5, 1.00, 0.00300, 0.00075, 0.00015, 0.00010, 0.00030, 4.00, 0.01200, 1.20, 'kraken', 'onchain', 'analyzed', datetime('now', '-30 hours'), datetime('now', '-30 hours'), 0),
			('bisq', 'sell', 95, 0.04, 0.4, 'Revolut', 'Revolut', 'active-ask-30m', 100, 5, 0.26, 0.00104, 0.00100, NULL, 0.00004, 0.00040, 4.74, 0.01896, 1.90, 'kraken', 'onchain', 'analyzed', datetime('now', '-30 minutes'), datetime('now', '-30 minutes'), 0),
			('bisq', 'buy', 105, 0.05, 0.5, 'SEPA', 'SEPA', 'old-premium', 100, 5, 1.00, 0.00500, 0.00125, 0.00015, 0.00010, 0.00050, 4.00, 0.02000, 2.00, 'kraken', 'onchain', 'analyzed', datetime('now', '-200 hours'), datetime('now', '-200 hours'), 0)
	`); err != nil {
		t.Fatalf("insert offers: %v", err)
	}

	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)
	tradeCostEstimators = map[string]*tradecost.TradeCostEstimator{"kraken": est}
	tradeRouteOptimizer = tradecost.NewTradeRouteOptimizer(tradeCostEstimators)

	pmRepo = &paymentmethods.Repo{DB: db}
}

type pastOrderStatsTestResponse struct {
	FiatCurrency           string                        `json:"fiat_currency"`
	ExcludedPaymentMethods []string                      `json:"excluded_payment_methods"`
	Timeframes             []pastOrderStatsTestTimeframe `json:"timeframes"`
}

type pastOrderStatsTestTimeframe struct {
	Timeframe         string  `json:"timeframe"`
	PremiumOrderCount int     `json:"premium_order_count"`
	TotalProfitBTC    float64 `json:"total_net_profit_btc"`
	TotalProfitFiat   float64 `json:"total_net_profit_fiat"`
	AverageOrderBTC   float64 `json:"average_order_size_btc"`
	SmallestOrderBTC  float64 `json:"smallest_order_size_btc"`
	BiggestOrderBTC   float64 `json:"biggest_order_size_btc"`
}

func findStatsTimeframe(t *testing.T, timeframes []pastOrderStatsTestTimeframe, label string) pastOrderStatsTestTimeframe {
	t.Helper()
	for _, timeframe := range timeframes {
		if timeframe.Timeframe == label {
			return timeframe
		}
	}
	t.Fatalf("timeframe %q not found in %#v", label, timeframes)
	return pastOrderStatsTestTimeframe{}
}

func findPastPremiumFrame(t *testing.T, timeframes []struct {
	Timeframe string `json:"timeframe"`
	Modes     struct {
		Raw []struct {
			Name          string  `json:"name"`
			AvgPremiumPct float64 `json:"avg_premium_pct"`
		} `json:"raw"`
		NetFull []struct {
			Name          string  `json:"name"`
			AvgPremiumPct float64 `json:"avg_premium_pct"`
		} `json:"net_full"`
		NetCapped []struct {
			Name          string  `json:"name"`
			AvgPremiumPct float64 `json:"avg_premium_pct"`
		} `json:"net_capped"`
	} `json:"modes"`
}, label string) struct {
	Timeframe string `json:"timeframe"`
	Modes     struct {
		Raw []struct {
			Name          string  `json:"name"`
			AvgPremiumPct float64 `json:"avg_premium_pct"`
		} `json:"raw"`
		NetFull []struct {
			Name          string  `json:"name"`
			AvgPremiumPct float64 `json:"avg_premium_pct"`
		} `json:"net_full"`
		NetCapped []struct {
			Name          string  `json:"name"`
			AvgPremiumPct float64 `json:"avg_premium_pct"`
		} `json:"net_capped"`
	} `json:"modes"`
} {
	t.Helper()
	for _, timeframe := range timeframes {
		if timeframe.Timeframe == label {
			return timeframe
		}
	}
	t.Fatalf("past premiums timeframe %q not found in %#v", label, timeframes)
	return struct {
		Timeframe string `json:"timeframe"`
		Modes     struct {
			Raw []struct {
				Name          string  `json:"name"`
				AvgPremiumPct float64 `json:"avg_premium_pct"`
			} `json:"raw"`
			NetFull []struct {
				Name          string  `json:"name"`
				AvgPremiumPct float64 `json:"avg_premium_pct"`
			} `json:"net_full"`
			NetCapped []struct {
				Name          string  `json:"name"`
				AvgPremiumPct float64 `json:"avg_premium_pct"`
			} `json:"net_capped"`
		} `json:"modes"`
	}{}
}

func findNamedPremiumValue(t *testing.T, entries []struct {
	Name          string  `json:"name"`
	AvgPremiumPct float64 `json:"avg_premium_pct"`
}, name string) float64 {
	t.Helper()
	for _, entry := range entries {
		if entry.Name == name {
			return entry.AvgPremiumPct
		}
	}
	t.Fatalf("premium entry %q not found in %#v", name, entries)
	return 0
}

func findNamedPremiumValueTyped(t *testing.T, entries []pastorders.NamedPremium, name string) float64 {
	t.Helper()
	for _, entry := range entries {
		if entry.Name == name {
			return entry.AvgPremiumPct
		}
	}
	t.Fatalf("premium entry %q not found in %#v", name, entries)
	return 0
}
