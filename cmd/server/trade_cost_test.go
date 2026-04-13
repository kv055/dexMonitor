package main

import (
	"database/sql"
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
		hedgeCostOverride: func(btcAmount float64, transferMinutes float64) hedgeCostDetails {
			return hedgeCostDetails{}
		},
	}
}

func fixedCostEstimatorWithHedge(exchange, dexExchange string, takerFeeFrac, withdrawalFeeBTC, dexFeeFrac, networkFeeBTC, hedgeFeeBTC float64) *TradeCostEstimator {
	est := fixedCostEstimator(exchange, dexExchange, takerFeeFrac, withdrawalFeeBTC, dexFeeFrac, networkFeeBTC)
	est.hedgeCostOverride = func(btcAmount float64, transferMinutes float64) hedgeCostDetails {
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

	assertFloat(t, bd.HedgeFeeBTC, 0.0002)
	assertFloat(t, bd.HedgeFeePct, 0.2)
	assertFloat(t, bd.TotalCostBTC, 0.0008)
	assertFloat(t, bd.TotalCostPct, 0.8)
	if bd.HedgeVenue != "coinbase_futures" {
		t.Fatalf("hedge venue = %q, want coinbase_futures", bd.HedgeVenue)
	}
	if bd.HedgeTransferMinutes != 60 {
		t.Fatalf("hedge transfer minutes = %d, want 60", bd.HedgeTransferMinutes)
	}
}

func TestTradeCostEstimatorDoesNotIncludeHedgeCostOnAskSide(t *testing.T) {
	est := fixedCostEstimatorWithHedge("kraken", "bisq", 0.0025, 0.00015, 0.001, 0.00005, 0.0002)

	bd := est.Breakdown(0.1, "bisq", "sell")

	assertFloat(t, bd.HedgeFeeBTC, 0)
	assertFloat(t, bd.HedgeFeePct, 0)
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
	assertFloat(t, offer.PriceDiffPct, 2.5)
	assertFloat(t, offer.TradeCostPct, 0.6)
	assertFloat(t, offer.NetPremiumPct, 1.9)
	assertFloat(t, offer.CostBreakdown.BTCAmount, 0.1)
	assertFloat(t, offer.CostBreakdown.TotalCostPct, 0.6)
	assertFloat(t, offer.CostBreakdown.TotalCostBTC, 0.0006)
	assertFloat(t, offer.CostBreakdown.EstimatedProfitBTC, 0.0019)
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
		if _, ok := offer["price_diff_percent"].(float64); !ok {
			t.Fatalf("offer %d missing numeric price_diff_percent: %#v", i, offer["price_diff_percent"])
		}
		if _, ok := offer["trade_cost_percent"].(float64); !ok {
			t.Fatalf("offer %d missing numeric trade_cost_percent: %#v", i, offer["trade_cost_percent"])
		}
		if _, ok := offer["net_premium_percent"].(float64); !ok {
			t.Fatalf("offer %d missing numeric net_premium_percent: %#v", i, offer["net_premium_percent"])
		}
		if _, ok := offer["cost_breakdown"].(map[string]any); !ok {
			t.Fatalf("offer %d missing cost_breakdown object: %#v", i, offer["cost_breakdown"])
		}

		if offer["trade_cost_percent"].(float64) > 0 {
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
		INSERT INTO offers (exchange, direction, price, btc_min, btc_max, payment_method, offer_id, avg_ref_price, first_seen, last_seen, is_live)
		VALUES
			('robosats', 'buy', 104, 0.1, 0.1, 'SEPA', 'robo-10h', 100, datetime('now', '-10 hours'), datetime('now', '-10 hours'), 0),
			('robosats', 'sell', 94, 0.1, 0.1, 'SEPA', 'robo-5d', 100, datetime('now', '-5 days'), datetime('now', '-5 days'), 0),
			('bisq', 'buy', 107, 0.1, 0.1, 'SEPA Instant', 'bisq-live', 100, datetime('now', '-20 minutes'), datetime('now', '-20 minutes'), 1)
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
			Timeframe            string `json:"timeframe"`
			AvgPremiumByExchange []struct {
				Name          string  `json:"name"`
				AvgPremiumPct float64 `json:"avg_premium_pct"`
			} `json:"avg_premium_by_exchange"`
		} `json:"past_premiums"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &stats); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if stats.TotalOffers != 5 {
		t.Fatalf("total offers = %d, want 5", stats.TotalOffers)
	}

	twentyFourHour := findPastPremiumFrame(t, stats.PastPremiums, "24h")
	if len(twentyFourHour.AvgPremiumByExchange) != 2 {
		t.Fatalf("24h past premiums len = %d, want 2", len(twentyFourHour.AvgPremiumByExchange))
	}
	assertFloat(t, twentyFourHour.AvgPremiumByExchange[0].AvgPremiumPct, 5)
	assertFloat(t, twentyFourHour.AvgPremiumByExchange[1].AvgPremiumPct, 4)

	sevenDay := findPastPremiumFrame(t, stats.PastPremiums, "7d")
	if len(sevenDay.AvgPremiumByExchange) != 2 {
		t.Fatalf("7d past premiums len = %d, want 2", len(sevenDay.AvgPremiumByExchange))
	}
	assertFloat(t, sevenDay.AvgPremiumByExchange[0].AvgPremiumPct, 5)
	assertFloat(t, sevenDay.AvgPremiumByExchange[1].AvgPremiumPct, 5)
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
	Timeframe            string `json:"timeframe"`
	AvgPremiumByExchange []struct {
		Name          string  `json:"name"`
		AvgPremiumPct float64 `json:"avg_premium_pct"`
	} `json:"avg_premium_by_exchange"`
}, label string) struct {
	Timeframe            string `json:"timeframe"`
	AvgPremiumByExchange []struct {
		Name          string  `json:"name"`
		AvgPremiumPct float64 `json:"avg_premium_pct"`
	} `json:"avg_premium_by_exchange"`
} {
	t.Helper()
	for _, timeframe := range timeframes {
		if timeframe.Timeframe == label {
			return timeframe
		}
	}
	t.Fatalf("past premiums timeframe %q not found in %#v", label, timeframes)
	return struct {
		Timeframe            string `json:"timeframe"`
		AvgPremiumByExchange []struct {
			Name          string  `json:"name"`
			AvgPremiumPct float64 `json:"avg_premium_pct"`
		} `json:"avg_premium_by_exchange"`
	}{}
}
