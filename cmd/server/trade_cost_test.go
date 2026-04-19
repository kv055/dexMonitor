package main

import (
	"database/sql"
	"dexmonitor/internal/pastorders"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func seededCachedFee(value float64) *cachedFee {
	return &cachedFee{
		value:     value,
		fetchedAt: time.Now(),
		ttl:       feeTTL,
	}
}

func fixedCostEstimator(exchange, dexExchange string, takerFeeFrac, withdrawalFeeBTC, dexFeeFrac, networkFeeBTC float64) *TradeCostEstimator {
	withdrawal := newWithdrawalFeeFetcher(exchange)
	withdrawal.caches[MethodOnchain] = seededCachedFee(withdrawalFeeBTC)
	withdrawal.caches[MethodLightning] = seededCachedFee(withdrawalFeeBTC)

	return &TradeCostEstimator{
		exchange:   exchange,
		taker:      &takerFeeFetcher{exchange: exchange, cache: seededCachedFee(takerFeeFrac)},
		withdrawal: withdrawal,
		dexFees: map[string]*cachedFee{
			dexExchange: seededCachedFee(dexFeeFrac),
		},
		cexProfile: cexProfileFor(exchange),
		networkFeeOverride: func(method WithdrawalMethod, btcAmount float64) networkFeeDetails {
			return networkFeeDetails{
				feeBTC:     networkFeeBTC,
				method:     method,
				tier:       "standard",
				confidence: 0.875,
				detail: &BTCNetworkFeeDetail{
					SelectedFullConfirmationMinutes: 30,
				},
			}
		},
		hedgeCostOverride: func(btcAmount float64, refPriceEUR float64, transferMinutes float64) hedgeCostDetails {
			return hedgeCostDetails{}
		},
	}
}

func fixedCostEstimatorWithHedge(exchange, dexExchange string, takerFeeFrac, withdrawalFeeBTC, dexFeeFrac, networkFeeBTC, hedgeFeeBTC float64) *TradeCostEstimator {
	est := fixedCostEstimator(exchange, dexExchange, takerFeeFrac, withdrawalFeeBTC, dexFeeFrac, networkFeeBTC)
	est.hedgeCostOverride = func(btcAmount float64, refPriceEUR float64, transferMinutes float64) hedgeCostDetails {
		return hedgeCostDetails{
			feeBTC:          hedgeFeeBTC,
			feePct:          hedgeFeeBTC / btcAmount * 100,
			venue:           "coinbase_futures",
			instrument:      "BTC-PERP",
			transferMinutes: transferMinutes,
		}
	}
	return est
}

func assertFloat(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-9 {
		t.Fatalf("got %.12f, want %.12f", got, want)
	}
}

func strPtr(v string) *string { return &v }

func TestTradeCostEstimatorCostPctUsesAllComponents(t *testing.T) {
	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)

	got := est.CostPct(0.1, "bisq")

	assertFloat(t, got, 0.55)
}

func TestTradeCostEstimatorBreakdownMatchesComponentSum(t *testing.T) {
	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)

	bd := est.Breakdown(0.1, "bisq", "buy")

	assertFloat(t, bd.BTCAmount, 0.1)
	assertFloat(t, bd.CexTakerFeeBTC, 0.00025)
	assertFloat(t, bd.CexTakerFeePct, 0.25)
	assertFloat(t, bd.WithdrawalFeeBTC, 0.00015)
	assertFloat(t, bd.WithdrawalFeePct, 0.15)
	assertFloat(t, bd.NetworkFeeBTC, 0.0001) // 2 txs × 0.00005
	assertFloat(t, bd.NetworkFeePct, 0.1)
	assertFloat(t, bd.DexFeeBTC, 0.0001)
	assertFloat(t, bd.DexFeePct, 0.1)
	assertFloat(t, bd.TotalCostBTC, 0.0006)
	assertFloat(t, bd.TotalCostPct, 0.6)
	if bd.NetworkFeeMethod != "onchain" {
		t.Fatalf("network method = %q, want onchain", bd.NetworkFeeMethod)
	}
	if bd.NetworkFeeConfidence != 0.875 {
		t.Fatalf("network confidence = %.12f, want 0.875", bd.NetworkFeeConfidence)
	}
}

func TestTradeCostEstimatorBreakdownIncludesHedgeCostOnBidSide(t *testing.T) {
	est := fixedCostEstimatorWithHedge("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005, 0.0002)

	bd := est.Breakdown(0.1, "bisq", "buy")

	assertFloat(t, bd.Hedge.FeeSumBTC, 0.0002)
	assertFloat(t, bd.Hedge.FeeSumPct, 0.2)
	assertFloat(t, bd.TotalCostBTC, 0.0008)
	assertFloat(t, bd.TotalCostPct, 0.8)
	if bd.Hedge.Venue != "coinbase_futures" {
		t.Fatalf("hedge venue = %q, want coinbase_futures", bd.Hedge.Venue)
	}
	if bd.Hedge.TransferMinutes != 60 {
		t.Fatalf("hedge transfer minutes = %d, want 60", bd.Hedge.TransferMinutes)
	}
}

func TestTradeCostEstimatorDoesNotIncludeHedgeCostOnAskSide(t *testing.T) {
	est := fixedCostEstimatorWithHedge("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005, 0.0002)

	bd := est.Breakdown(0.1, "bisq", "sell")

	assertFloat(t, bd.Hedge.FeeSumBTC, 0)
	assertFloat(t, bd.Hedge.FeeSumPct, 0)
}

func TestTradeCostEstimatorBreakdownRoundsBTCAndPercentFields(t *testing.T) {
	est := fixedCostEstimator("kraken", "bisq", 0.00123456789, 0.000000004, 0.00098765432, 0.000000006)

	bd := est.Breakdown(0.123456789, "bisq", "buy")

	assertFloat(t, bd.BTCAmount, 0.12345679)
	assertFloat(t, bd.CexTakerFeeBTC, 0.00015242)
	assertFloat(t, bd.WithdrawalFeeBTC, 0)
	assertFloat(t, bd.NetworkFeeBTC, 0.00000001)
	assertFloat(t, bd.DexFeeBTC, 0.00012193)
	assertFloat(t, bd.CexTakerFeePct, 0.1235)
	assertFloat(t, bd.DexFeePct, 0.0988)
	assertFloat(t, bd.TotalCostPct, 0.2222)
}

func TestTradeCostEstimatorZeroAmountReturnsEmptyCost(t *testing.T) {
	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)

	assertFloat(t, est.CostPct(0, "bisq"), 0)
	if bd := est.Breakdown(0, "bisq", "buy"); bd != (CostBreakdown{}) {
		t.Fatalf("zero amount breakdown = %#v, want empty breakdown", bd)
	}
}

func TestSelectBTCTradeSizePrefersMaxThenMinThenDefault(t *testing.T) {
	min := 0.02
	max := 0.05

	assertFloat(t, selectBTCTradeSize(&max, &min), 0.05)
	assertFloat(t, selectBTCTradeSize(nil, &min), 0.02)
	assertFloat(t, selectBTCTradeSize(nil, nil), defaultBTCTradeSize)
}

func TestDirectionalPremiumPct(t *testing.T) {
	assertFloat(t, computeDirectionalPremiumPct("buy", 105, 100), 5)
	assertFloat(t, computeDirectionalPremiumPct("sell", 95, 100), 5)
	assertFloat(t, computeDirectionalPremiumPct("buy", 100, 0), 0)
}

func TestComputeNetPremiumFields(t *testing.T) {
	oldOptimizer := tradeRouteOptimizer
	oldEstimators := tradeCostEstimators
	defer func() {
		tradeRouteOptimizer = oldOptimizer
		tradeCostEstimators = oldEstimators
	}()

	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)
	tradeCostEstimators = map[string]*TradeCostEstimator{"kraken": est}
	tradeRouteOptimizer = NewTradeRouteOptimizer(tradeCostEstimators)

	tradeCostPct, netPremium, bd := computeNetPremiumFields(2.5, 0.1, "bisq", "buy")

	assertFloat(t, tradeCostPct, 0.6)
	assertFloat(t, netPremium, 1.9)
	assertFloat(t, bd.EstimatedProfitPct, 1.9)
	assertFloat(t, bd.EstimatedProfitBTC, 0.0019)

	tradeCostPct, netPremium, bd = computeNetPremiumFields(-1, 0.1, "bisq", "buy")
	assertFloat(t, tradeCostPct, 0)
	assertFloat(t, netPremium, 0)
	if bd != (CostBreakdown{}) {
		t.Fatalf("negative premium breakdown = %#v, want empty breakdown", bd)
	}
}

func TestCachedFeeUsesFallbackThenKeepsCachedValueOnFailure(t *testing.T) {
	cache := newCachedFee(time.Hour)
	refreshErr := errors.New("boom")

	got := cache.get(0.123, func() (float64, error) {
		return 0, refreshErr
	}, "test fee")
	assertFloat(t, got, 0.123)

	cache.fetchedAt = time.Now().Add(-2 * time.Hour)
	got = cache.get(0.123, func() (float64, error) {
		return 0.456, nil
	}, "test fee")
	assertFloat(t, got, 0.456)

	cache.fetchedAt = time.Now().Add(-2 * time.Hour)
	got = cache.get(0.123, func() (float64, error) {
		return 0, refreshErr
	}, "test fee")
	assertFloat(t, got, 0.456)
}

func TestLiveOffersRESTReturnsComputedCostFields(t *testing.T) {
	oldHub := hub
	oldPrices := cexPrices
	oldOptimizer := tradeRouteOptimizer
	oldEstimators := tradeCostEstimators
	defer func() {
		hub = oldHub
		cexPrices = oldPrices
		tradeRouteOptimizer = oldOptimizer
		tradeCostEstimators = oldEstimators
	}()

	hub = &LiveHub{subscribers: map[chan []byte]liveSubscription{}}
	cexPrices = map[string]float64{"kraken": 100}

	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)
	tradeCostEstimators = map[string]*TradeCostEstimator{"kraken": est}
	tradeRouteOptimizer = NewTradeRouteOptimizer(tradeCostEstimators)

	btcMin := 0.01
	btcMax := 0.1
	hub.offers = []LiveOffer{{
		ID:        1,
		Exchange:  "bisq",
		Direction: "buy",
		Price:     102.5,
		BTCMin:    &btcMin,
		BTCMax:    &btcMax,
		FirstSeen: "2026-04-01 12:00:00",
		LastSeen:  "2026-04-01 12:00:00",
	}}

	req := httptest.NewRequest(http.MethodGet, "/api/live_offers?cex=kraken", nil)
	rec := httptest.NewRecorder()

	handleLiveOffersREST(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var offers []liveOutOffer
	if err := json.Unmarshal(rec.Body.Bytes(), &offers); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(offers) != 1 {
		t.Fatalf("offer count = %d, want 1", len(offers))
	}

	offer := offers[0]
	assertFloat(t, offer.RawPremiumPct, 2.5)
	assertFloat(t, offer.PriceDiffPct, 2.5)
	assertFloat(t, offer.TradeCostPct, 0.6)
	assertFloat(t, offer.NetPremiumPct, 1.9)
	assertFloat(t, offer.EstimatedProfitBTC, 0.0019)
	assertFloat(t, offer.EstimatedProfitFiat, 0.19)
	assertFloat(t, offer.CostBreakdown.BTCAmount, 0.1)
	assertFloat(t, offer.CostBreakdown.TotalCostPct, 0.6)
	assertFloat(t, offer.CostBreakdown.TotalCostBTC, 0.0006)
	assertFloat(t, offer.CostBreakdown.EstimatedProfitBTC, 0.0019)
}

func TestHandleLiveOffersRESTIncludesCappedProfitFields(t *testing.T) {
	oldOptimizer := tradeRouteOptimizer
	oldEstimators := tradeCostEstimators
	oldHubOffers := hub.getOffers()
	oldKrakenPrice := getCexPrice("kraken")
	defer func() {
		tradeRouteOptimizer = oldOptimizer
		tradeCostEstimators = oldEstimators
		setCexPrice("kraken", oldKrakenPrice)
		hub.setOffers(oldHubOffers)
	}()

	setCexPrice("kraken", 100)

	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)
	tradeCostEstimators = map[string]*TradeCostEstimator{"kraken": est}
	tradeRouteOptimizer = NewTradeRouteOptimizer(tradeCostEstimators)

	btcMin := 0.02
	btcMax := 0.1
	hub.setOffers([]LiveOffer{{
		ID:        1,
		Exchange:  "bisq",
		Direction: "buy",
		Price:     102.5,
		BTCMin:    &btcMin,
		BTCMax:    &btcMax,
		FirstSeen: "2026-04-01 12:00:00",
		LastSeen:  "2026-04-01 12:00:00",
	}})

	req := httptest.NewRequest(http.MethodGet, "/api/live_offers?cex=kraken&max_fiat_limit=5", nil)
	rec := httptest.NewRecorder()

	handleLiveOffersREST(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	var offers []liveOutOffer
	if err := json.Unmarshal(rec.Body.Bytes(), &offers); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(offers) != 1 {
		t.Fatalf("offer count = %d, want 1", len(offers))
	}

	offer := offers[0]
	if offer.CostBreakdownCapped == nil {
		t.Fatal("expected capped cost breakdown")
	}
	if offer.TradeCostPctCapped == nil || offer.NetPremiumPctCapped == nil {
		t.Fatal("expected capped percentage fields")
	}
	if offer.EstimatedProfitBTCCapped == nil || offer.EstimatedProfitFiatCapped == nil {
		t.Fatal("expected capped profit fields")
	}
	assertFloat(t, *offer.TradeCostPctCapped, 0.85)
	assertFloat(t, *offer.NetPremiumPctCapped, 1.65)
	assertFloat(t, *offer.EstimatedProfitBTCCapped, 0.000825)
	assertFloat(t, *offer.EstimatedProfitFiatCapped, 0.08)
	assertFloat(t, offer.CostBreakdownCapped.BTCAmount, 0.05)
	assertFloat(t, offer.CostBreakdownCapped.EstimatedProfitBTC, 0.000825)
}

func TestPastOffersRESTComputesCostsForClosedOrdersDump(t *testing.T) {
	const closedOrdersPath = "/home/kili/closed_orders.sql"

	closedOrdersSQL, err := os.ReadFile(closedOrdersPath)
	if err != nil {
		t.Skipf("closed orders fixture not available at %s: %v", closedOrdersPath, err)
	}
	schemaSQL, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}

	oldDB := db
	oldOptimizer := tradeRouteOptimizer
	oldEstimators := tradeCostEstimators
	defer func() {
		db = oldDB
		tradeRouteOptimizer = oldOptimizer
		tradeCostEstimators = oldEstimators
	}()

	testDB, err := sql.Open("sqlite", t.TempDir()+"/orders.db")
	if err != nil {
		t.Fatalf("open temp db: %v", err)
	}
	t.Cleanup(func() {
		testDB.Close()
	})
	db = testDB

	if _, err := db.Exec(string(schemaSQL)); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	if _, err := db.Exec(`ALTER TABLE offers ADD COLUMN ref_price REAL`); err != nil {
		t.Fatalf("add legacy ref_price column for fixture import: %v", err)
	}
	if _, err := db.Exec(string(closedOrdersSQL)); err != nil {
		t.Fatalf("load closed orders dump: %v", err)
	}

	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)
	est.dexFees["hodlhodl"] = seededCachedFee(0.001)
	est.dexFees["robosats"] = seededCachedFee(0.001)
	tradeCostEstimators = map[string]*TradeCostEstimator{"kraken": est}
	tradeRouteOptimizer = NewTradeRouteOptimizer(tradeCostEstimators)

	req := httptest.NewRequest(http.MethodGet, "/api/past_offers?hours=100000&limit=1000", nil)
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
		t.Fatal("expected closed order rows from fixture, got none")
	}

	computedCosts := 0
	for i, offer := range offers {
		status, ok := offer["status"].(map[string]any)
		if !ok {
			t.Fatalf("offer %d missing status object: %#v", i, offer["status"])
		}
		if status["is_live"] != false {
			t.Fatalf("offer %d status.is_live = %#v, want false", i, status["is_live"])
		}
		pricing, ok := offer["pricing"].(map[string]any)
		if !ok {
			t.Fatalf("offer %d missing pricing object: %#v", i, offer["pricing"])
		}
		if _, ok := pricing["avg_offer_price"].(float64); !ok {
			t.Fatalf("offer %d missing numeric pricing.avg_offer_price: %#v", i, pricing["avg_offer_price"])
		}
		if _, ok := pricing["avg_ref_price"].(float64); !ok {
			t.Fatalf("offer %d missing numeric pricing.avg_ref_price: %#v", i, pricing["avg_ref_price"])
		}
		if _, ok := pricing["avg_premium_percent"].(float64); !ok {
			t.Fatalf("offer %d missing numeric pricing.avg_premium_percent: %#v", i, pricing["avg_premium_percent"])
		}
		analysis, ok := offer["analysis"].(map[string]any)
		if !ok {
			t.Fatalf("offer %d missing analysis object: %#v", i, offer["analysis"])
		}
		full, ok := analysis["full_volume"].(map[string]any)
		if !ok {
			t.Fatalf("offer %d missing analysis.full_volume: %#v", i, analysis["full_volume"])
		}
		premium, ok := full["premium"].(map[string]any)
		if !ok {
			t.Fatalf("offer %d missing analysis.full_volume.premium: %#v", i, full["premium"])
		}
		if _, ok := premium["avg_trade_cost_percent"].(float64); !ok {
			t.Fatalf("offer %d missing avg_trade_cost_percent: %#v", i, premium["avg_trade_cost_percent"])
		}
		if _, ok := premium["avg_net_percent"].(float64); !ok {
			t.Fatalf("offer %d missing avg_net_percent: %#v", i, premium["avg_net_percent"])
		}
		if _, ok := offer["lifecycle"]; ok {
			t.Fatalf("offer %d unexpectedly included inline lifecycle after route split", i)
		}

		if premium["avg_trade_cost_percent"].(float64) > 0 {
			computedCosts++
			break
		}
	}
	if computedCosts == 0 {
		t.Fatal("expected at least one closed order to have computed positive trade cost")
	}
}

func TestPastOrderStatsRESTAggregatesPremiumOrdersByTimeframe(t *testing.T) {
	withTempOrdersDB(t)

	req := httptest.NewRequest(http.MethodGet, "/api/past_order_stats?fiat=eur", nil)
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

func TestPastOffersRESTIncludesCappedAnalysisWhenRequested(t *testing.T) {
	withTempOrdersDB(t)

	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)
	est.dexFees["hodlhodl"] = seededCachedFee(0.001)
	est.dexFees["robosats"] = seededCachedFee(0.001)
	tradeCostEstimators = map[string]*TradeCostEstimator{"kraken": est}
	tradeRouteOptimizer = NewTradeRouteOptimizer(tradeCostEstimators)

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

func TestPastOrderStatsAndPastOffersRespectExcludedPaymentMethods(t *testing.T) {
	withTempOrdersDB(t)

	statsReq := httptest.NewRequest(http.MethodGet, "/api/past_order_stats?exclude_payment_methods=Revolut", nil)
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

func TestPastProfitableOrdersReturnsClosedNetPositiveOrders(t *testing.T) {
	withTempOrdersDB(t)

	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)
	est.dexFees["hodlhodl"] = seededCachedFee(0.001)
	est.dexFees["robosats"] = seededCachedFee(0.001)
	tradeCostEstimators = map[string]*TradeCostEstimator{"kraken": est}
	tradeRouteOptimizer = NewTradeRouteOptimizer(tradeCostEstimators)

	req := httptest.NewRequest(http.MethodGet, "/api/past_profitable_orders?max_fiat_limit=5&exclude_payment_methods=Revolut", nil)
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

func TestGeneralStatsRESTComputesFrontendEquivalentStats(t *testing.T) {
	withTempOrdersDB(t)

	req := httptest.NewRequest(http.MethodGet, "/api/general_stats?hours=48", nil)
	rec := httptest.NewRecorder()

	handleGeneralStats(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var stats struct {
		TotalOffers      int `json:"total_offers"`
		ActiveOffers     int `json:"active_offers"`
		ExchangesLive    int `json:"exchanges_live"`
		OffersByExchange []struct {
			Name  string `json:"name"`
			Count int    `json:"count"`
		} `json:"offers_by_exchange"`
		BestAskPremiumPct  *float64 `json:"best_ask_premium_pct"`
		AvgAskPremiumPct   *float64 `json:"avg_ask_premium_pct"`
		AvgOfferLifetimeMs *int64   `json:"avg_offer_lifetime_ms"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if stats.TotalOffers != 4 {
		t.Fatalf("total offers = %d, want 4", stats.TotalOffers)
	}
	if stats.ActiveOffers != 2 {
		t.Fatalf("active offers = %d, want 2", stats.ActiveOffers)
	}
	if stats.ExchangesLive != 1 {
		t.Fatalf("exchanges live = %d, want 1", stats.ExchangesLive)
	}
	if len(stats.OffersByExchange) != 1 || stats.OffersByExchange[0].Name != "bisq" || stats.OffersByExchange[0].Count != 2 {
		t.Fatalf("offers_by_exchange = %#v, want [{bisq 2}]", stats.OffersByExchange)
	}
	if stats.BestAskPremiumPct == nil || *stats.BestAskPremiumPct != 5 {
		t.Fatalf("best ask premium = %#v, want 5", stats.BestAskPremiumPct)
	}
	if stats.AvgAskPremiumPct == nil || *stats.AvgAskPremiumPct != 5 {
		t.Fatalf("avg ask premium = %#v, want 5", stats.AvgAskPremiumPct)
	}
	if stats.AvgOfferLifetimeMs == nil || *stats.AvgOfferLifetimeMs != int64(2*time.Hour/time.Millisecond) {
		t.Fatalf("avg lifetime = %#v, want %d", stats.AvgOfferLifetimeMs, int64(2*time.Hour/time.Millisecond))
	}
}

func TestGeneralStatsRESTRespectsExcludedPaymentMethods(t *testing.T) {
	withTempOrdersDB(t)

	req := httptest.NewRequest(http.MethodGet, "/api/general_stats?hours=48&exclude_payment_methods=Revolut", nil)
	rec := httptest.NewRecorder()

	handleGeneralStats(rec, req)

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

func TestGeneralStatsRESTIncludesPastPremiumsForFixedWindows(t *testing.T) {
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

	req := httptest.NewRequest(http.MethodGet, "/api/general_stats?hours=24", nil)
	rec := httptest.NewRecorder()

	handleGeneralStats(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var stats struct {
		TotalOffers  int `json:"total_offers"`
		PastPremiums []struct {
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
		} `json:"past_premiums"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if stats.TotalOffers != 6 {
		t.Fatalf("total offers = %d, want 6", stats.TotalOffers)
	}

	twentyFourHour := findPastPremiumFrame(t, stats.PastPremiums, "24h")
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

	sevenDay := findPastPremiumFrame(t, stats.PastPremiums, "7d")
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

func TestGeneralStatsRESTIncludesOpenPremiumModesFromLiveEngine(t *testing.T) {
	withTempOrdersDB(t)

	oldHub := hub
	oldPrices := cexPrices
	oldOptimizer := tradeRouteOptimizer
	oldEstimators := tradeCostEstimators
	defer func() {
		hub = oldHub
		cexPrices = oldPrices
		tradeRouteOptimizer = oldOptimizer
		tradeCostEstimators = oldEstimators
	}()

	hub = &LiveHub{subscribers: map[chan []byte]liveSubscription{}}
	cexPrices = map[string]float64{"kraken": 100}
	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)
	tradeCostEstimators = map[string]*TradeCostEstimator{"kraken": est}
	tradeRouteOptimizer = NewTradeRouteOptimizer(tradeCostEstimators)

	btcMin := 0.02
	btcMax := 0.1
	hub.offers = []LiveOffer{
		{
			ID:            101,
			Exchange:      "bisq",
			Direction:     "buy",
			Price:         102.5,
			BTCMin:        &btcMin,
			BTCMax:        &btcMax,
			PaymentMethod: strPtr("SEPA"),
			FirstSeen:     "2026-04-01 12:00:00",
			LastSeen:      "2026-04-01 12:00:00",
		},
		{
			ID:            102,
			Exchange:      "bisq",
			Direction:     "sell",
			Price:         97.5,
			BTCMin:        &btcMin,
			BTCMax:        &btcMax,
			PaymentMethod: strPtr("SEPA"),
			FirstSeen:     "2026-04-01 12:00:00",
			LastSeen:      "2026-04-01 12:00:00",
		},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/general_stats?hours=48&cex=kraken&max_fiat_limit=5", nil)
	rec := httptest.NewRecorder()

	handleGeneralStats(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var stats struct {
		OpenPremiums struct {
			Raw struct {
				AvgAskPremiumPct *float64 `json:"avg_ask_premium_pct"`
				AvgBidPremiumPct *float64 `json:"avg_bid_premium_pct"`
			} `json:"raw"`
			NetFull struct {
				AvgAskPremiumPct *float64 `json:"avg_ask_premium_pct"`
				AvgBidPremiumPct *float64 `json:"avg_bid_premium_pct"`
			} `json:"net_full"`
			NetCapped struct {
				AvgAskPremiumPct *float64 `json:"avg_ask_premium_pct"`
				AvgBidPremiumPct *float64 `json:"avg_bid_premium_pct"`
			} `json:"net_capped"`
		} `json:"open_premiums"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if stats.OpenPremiums.Raw.AvgBidPremiumPct == nil || *stats.OpenPremiums.Raw.AvgBidPremiumPct != 2.5 {
		t.Fatalf("raw bid avg = %#v, want 2.5", stats.OpenPremiums.Raw.AvgBidPremiumPct)
	}
	if stats.OpenPremiums.Raw.AvgAskPremiumPct == nil || *stats.OpenPremiums.Raw.AvgAskPremiumPct != 2.5 {
		t.Fatalf("raw ask avg = %#v, want 2.5", stats.OpenPremiums.Raw.AvgAskPremiumPct)
	}
	if stats.OpenPremiums.NetFull.AvgBidPremiumPct == nil || *stats.OpenPremiums.NetFull.AvgBidPremiumPct != 1.9 {
		t.Fatalf("net full bid avg = %#v, want 1.9", stats.OpenPremiums.NetFull.AvgBidPremiumPct)
	}
	if stats.OpenPremiums.NetCapped.AvgBidPremiumPct == nil || *stats.OpenPremiums.NetCapped.AvgBidPremiumPct != 1.65 {
		t.Fatalf("net capped bid avg = %#v, want 1.65", stats.OpenPremiums.NetCapped.AvgBidPremiumPct)
	}
}

func TestBuildOpenPremiumStatsIgnoresNonPremiumOffers(t *testing.T) {
	oldHub := hub
	oldPrices := cexPrices
	oldOptimizer := tradeRouteOptimizer
	oldEstimators := tradeCostEstimators
	defer func() {
		hub = oldHub
		cexPrices = oldPrices
		tradeRouteOptimizer = oldOptimizer
		tradeCostEstimators = oldEstimators
	}()

	hub = &LiveHub{subscribers: map[chan []byte]liveSubscription{}}
	cexPrices = map[string]float64{"kraken": 100}
	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)
	tradeCostEstimators = map[string]*TradeCostEstimator{"kraken": est}
	tradeRouteOptimizer = NewTradeRouteOptimizer(tradeCostEstimators)

	btcMin := 0.02
	btcMax := 0.1
	hub.offers = []LiveOffer{
		{
			ID:            201,
			Exchange:      "bisq",
			Direction:     "buy",
			Price:         102.5,
			BTCMin:        &btcMin,
			BTCMax:        &btcMax,
			PaymentMethod: strPtr("SEPA"),
			FirstSeen:     "2026-04-01 12:00:00",
			LastSeen:      "2026-04-01 12:00:00",
		},
		{
			ID:            202,
			Exchange:      "bisq",
			Direction:     "buy",
			Price:         90,
			BTCMin:        &btcMin,
			BTCMax:        &btcMax,
			PaymentMethod: strPtr("SEPA"),
			FirstSeen:     "2026-04-01 12:00:00",
			LastSeen:      "2026-04-01 12:00:00",
		},
		{
			ID:            203,
			Exchange:      "bisq",
			Direction:     "sell",
			Price:         97.5,
			BTCMin:        &btcMin,
			BTCMax:        &btcMax,
			PaymentMethod: strPtr("SEPA"),
			FirstSeen:     "2026-04-01 12:00:00",
			LastSeen:      "2026-04-01 12:00:00",
		},
		{
			ID:            204,
			Exchange:      "bisq",
			Direction:     "sell",
			Price:         110,
			BTCMin:        &btcMin,
			BTCMax:        &btcMax,
			PaymentMethod: strPtr("SEPA"),
			FirstSeen:     "2026-04-01 12:00:00",
			LastSeen:      "2026-04-01 12:00:00",
		},
	}

	sub := liveSubscription{cex: "kraken", maxFiatLimitEUR: 5}
	enriched := hub.computeOutOffers(getCexPrice("kraken"), sub)
	var expectedRawBid, expectedRawAsk float64
	var expectedNetFullBid, expectedNetFullAsk float64
	var expectedNetCappedBid, expectedNetCappedAsk float64
	for _, offer := range enriched {
		switch offer.ID {
		case 201:
			expectedRawBid = offer.PriceDiffPct
			expectedNetFullBid = offer.NetPremiumPct
			if offer.NetPremiumPctCapped == nil {
				t.Fatal("expected capped bid premium")
			}
			expectedNetCappedBid = *offer.NetPremiumPctCapped
		case 203:
			expectedRawAsk = offer.PriceDiffPct
			expectedNetFullAsk = offer.NetPremiumPct
			if offer.NetPremiumPctCapped == nil {
				t.Fatal("expected capped ask premium")
			}
			expectedNetCappedAsk = *offer.NetPremiumPctCapped
		}
	}

	stats := buildOpenPremiumStats(sub, nil)

	if stats.Raw.AvgBidPremiumPct == nil || *stats.Raw.AvgBidPremiumPct != expectedRawBid {
		t.Fatalf("raw bid avg = %#v, want %v", stats.Raw.AvgBidPremiumPct, expectedRawBid)
	}
	if stats.Raw.AvgAskPremiumPct == nil || *stats.Raw.AvgAskPremiumPct != expectedRawAsk {
		t.Fatalf("raw ask avg = %#v, want %v", stats.Raw.AvgAskPremiumPct, expectedRawAsk)
	}
	if stats.NetFull.AvgBidPremiumPct == nil || *stats.NetFull.AvgBidPremiumPct != expectedNetFullBid {
		t.Fatalf("net full bid avg = %#v, want %v", stats.NetFull.AvgBidPremiumPct, expectedNetFullBid)
	}
	if stats.NetFull.AvgAskPremiumPct == nil || *stats.NetFull.AvgAskPremiumPct != expectedNetFullAsk {
		t.Fatalf("net full ask avg = %#v, want %v", stats.NetFull.AvgAskPremiumPct, expectedNetFullAsk)
	}
	if stats.NetCapped.AvgBidPremiumPct == nil || *stats.NetCapped.AvgBidPremiumPct != expectedNetCappedBid {
		t.Fatalf("net capped bid avg = %#v, want %v", stats.NetCapped.AvgBidPremiumPct, expectedNetCappedBid)
	}
	if stats.NetCapped.AvgAskPremiumPct == nil || *stats.NetCapped.AvgAskPremiumPct != expectedNetCappedAsk {
		t.Fatalf("net capped ask avg = %#v, want %v", stats.NetCapped.AvgAskPremiumPct, expectedNetCappedAsk)
	}
}

func withTempOrdersDB(t *testing.T) {
	t.Helper()

	schemaSQL, err := os.ReadFile("../../db/schema.sql")
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}

	oldDB := db
	oldOptimizer := tradeRouteOptimizer
	oldEstimators := tradeCostEstimators
	t.Cleanup(func() {
		db = oldDB
		tradeRouteOptimizer = oldOptimizer
		tradeCostEstimators = oldEstimators
	})

	testDB, err := sql.Open("sqlite", t.TempDir()+"/orders.db")
	if err != nil {
		t.Fatalf("open temp db: %v", err)
	}
	t.Cleanup(func() {
		testDB.Close()
	})
	db = testDB

	if _, err := db.Exec(string(schemaSQL)); err != nil {
		t.Fatalf("create schema: %v", err)
	}

	if _, err := db.Exec(`
		INSERT INTO offers (exchange, direction, price, btc_min, btc_max, payment_method, offer_id, avg_ref_price, first_seen, last_seen, is_live)
		VALUES
			('bisq', 'buy', 105, 0.1, 0.1, 'Revolut', 'premium-30m', 100, datetime('now', '-30 minutes'), datetime('now', '-30 minutes'), 0),
			('bisq', 'sell', 95, 0.2, 0.2, 'Wise', 'premium-5h', 100, datetime('now', '-7 hours'), datetime('now', '-5 hours'), 0),
			('bisq', 'buy', 105, 0.3, 0.3, 'SEPA', 'premium-30h', 100, datetime('now', '-30 hours'), datetime('now', '-30 hours'), 0),
			('bisq', 'sell', 95, 0.4, 0.4, 'Revolut', 'active-ask-30m', 100, datetime('now', '-30 minutes'), datetime('now', '-30 minutes'), 0),
			('bisq', 'buy', 105, 0.5, 0.5, 'SEPA', 'old-premium', 100, datetime('now', '-200 hours'), datetime('now', '-200 hours'), 0)
	`); err != nil {
		t.Fatalf("insert offers: %v", err)
	}

	est := fixedCostEstimator("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005)
	tradeCostEstimators = map[string]*TradeCostEstimator{"kraken": est}
	tradeRouteOptimizer = NewTradeRouteOptimizer(tradeCostEstimators)
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
