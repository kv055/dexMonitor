package main

import (
	"database/sql"
	"fmt"
	"math"
	"time"
)

const (
	minClosedOfferLifetime        = 5 * time.Minute
	maxHistoricalAnalysisWindow   = 10 * time.Minute
	deleteBelowPremiumPct         = -3.0
	historicalDefaultBTCTradeSize = 0.01
)

type historicalWithdrawalMethod string

const (
	historicalMethodOnchain   historicalWithdrawalMethod = "onchain"
	historicalMethodLightning historicalWithdrawalMethod = "lightning"
)

var historicalSupportedCEXes = []string{"kraken", "binance", "bitstamp", "coinbase"}

var historicalCexTakerFeeFallbacks = map[string]float64{
	"kraken":   0.0040,
	"binance":  0.0010,
	"coinbase": 0.0060,
	"bitstamp": 0.0050,
}

var historicalWithdrawalFallbacks = map[string]map[historicalWithdrawalMethod]float64{
	"kraken": {
		historicalMethodOnchain:   0.00015,
		historicalMethodLightning: 0.0,
	},
	"binance": {
		historicalMethodOnchain: 0.0000046,
	},
	"coinbase": {
		historicalMethodOnchain: 0.0,
	},
	"bitstamp": {
		historicalMethodOnchain: 0.0003,
	},
}

var historicalDexTakerFees = map[string]float64{
	"bisq":     0.0115,
	"robosats": 0.00175,
	"hodlhodl": 0.005,
}

var historicalDexAcceptsLightning = map[string]bool{
	"robosats": true,
	"bisq":     false,
	"hodlhodl": false,
}

var historicalCexMethods = map[string][]historicalWithdrawalMethod{
	"kraken":   {historicalMethodOnchain, historicalMethodLightning},
	"binance":  {historicalMethodOnchain},
	"coinbase": {historicalMethodOnchain},
	"bitstamp": {historicalMethodOnchain},
}

type historicalNetworkFeeProvider interface {
	FeeBTC(method historicalWithdrawalMethod, btcAmount float64) float64
}

type staticHistoricalNetworkFeeProvider struct{}

func (staticHistoricalNetworkFeeProvider) FeeBTC(method historicalWithdrawalMethod, btcAmount float64) float64 {
	switch method {
	case historicalMethodLightning:
		return 500.0 / 1e8
	default:
		return 0.00005
	}
}

type historicalTradeRoute struct {
	cex       string
	method    historicalWithdrawalMethod
	totalBTC  float64
	totalPct  float64
}

type closedOfferWindowAnalysis struct {
	avgRefPrice      float64
	avgPremiumPct    float64
	avgTradeCostPct  float64
	avgTradeCostBTC  float64
	avgNetPremiumPct float64
	avgProfitBTC     float64
	avgProfitFiat    float64
	btcAmount        float64
	bestRouteCEX     string
	bestRouteMethod  string
}

type closedOfferRecord struct {
	id        int64
	exchange  string
	direction string
	price     float64
	btcMin    sql.NullFloat64
	btcMax    sql.NullFloat64
	firstSeen string
	lastSeen  string
}

func analyzeClosedOffers(sdb *sql.DB) {
	rows, err := sdb.Query(`
		SELECT id, exchange, direction, price, btc_min, btc_max, first_seen, last_seen
		FROM offers
		WHERE is_live = 0
		  AND historical_analysis_status IS NULL
	`)
	if err != nil {
		fmt.Printf("[ClosedAnalysis] query error: %v\n", err)
		return
	}
	defer rows.Close()

	var batch []closedOfferRecord
	for rows.Next() {
		var o closedOfferRecord
		if err := rows.Scan(&o.id, &o.exchange, &o.direction, &o.price, &o.btcMin, &o.btcMax, &o.firstSeen, &o.lastSeen); err != nil {
			continue
		}
		batch = append(batch, o)
	}

	networkFees := staticHistoricalNetworkFeeProvider{}
	analyzed := 0
	deleted := 0
	ignored := 0

	for _, offer := range batch {
		status, removed := analyzeSingleClosedOffer(sdb, offer, networkFees)
		switch status {
		case "analyzed", "non_premium":
			analyzed++
		case "ignored_short_lifetime":
			ignored++
		}
		if removed {
			deleted++
		}
	}

	if len(batch) > 0 {
		fmt.Printf("[ClosedAnalysis] processed=%d analyzed=%d ignored=%d deleted=%d\n", len(batch), analyzed, ignored, deleted)
	}
}

func analyzeSingleClosedOffer(sdb *sql.DB, offer closedOfferRecord, networkFees historicalNetworkFeeProvider) (string, bool) {
	firstSeen, ok := parseDBTimestamp(offer.firstSeen)
	if !ok {
		return "", false
	}
	lastSeen, ok := parseDBTimestamp(offer.lastSeen)
	if !ok {
		return "", false
	}
	if !lastSeen.After(firstSeen) {
		_, _ = sdb.Exec(`UPDATE offers SET historical_analysis_status = ? WHERE id = ?`, "ignored_short_lifetime", offer.id)
		return "ignored_short_lifetime", false
	}

	lifetime := lastSeen.Sub(firstSeen)
	if lifetime < minClosedOfferLifetime {
		_, _ = sdb.Exec(`UPDATE offers SET historical_analysis_status = ? WHERE id = ?`, "ignored_short_lifetime", offer.id)
		return "ignored_short_lifetime", false
	}

	windowEnd := firstSeen.Add(maxHistoricalAnalysisWindow)
	if lastSeen.Before(windowEnd) {
		windowEnd = lastSeen
	}

	avgRefPrice := averageClosePriceForWindow(sdb, firstSeen, windowEnd)
	if avgRefPrice <= 0 {
		return "", false
	}

	premiumPct := directionalPremiumPct(offer.direction, offer.price, avgRefPrice)
	btcAmount := selectHistoricalBTCTradeSize(offer.btcMax, offer.btcMin)

	if premiumPct < deleteBelowPremiumPct {
		_, _ = sdb.Exec(`DELETE FROM offers WHERE id = ?`, offer.id)
		return "deleted_non_premium", true
	}

	if premiumPct <= 0 {
		_, _ = sdb.Exec(`
			UPDATE offers SET
				historical_analysis_status = ?,
				avg_ref_price_10m = ?,
				avg_premium_10m_pct = ?,
				avg_btc_amount_10m = ?
			WHERE id = ?
		`, "non_premium", historicalRound4(avgRefPrice), historicalRound4(premiumPct), historicalRound8(btcAmount), offer.id)
		return "non_premium", false
	}

	analysis := computeClosedOfferWindowAnalysis(offer.exchange, premiumPct, avgRefPrice, btcAmount, networkFees)
	_, _ = sdb.Exec(`
		UPDATE offers SET
			historical_analysis_status = ?,
			avg_ref_price_10m = ?,
			avg_premium_10m_pct = ?,
			avg_trade_cost_pct_10m = ?,
			avg_trade_cost_btc_10m = ?,
			avg_net_premium_10m_pct = ?,
			avg_estimated_profit_btc_10m = ?,
			avg_estimated_profit_fiat_10m = ?,
			avg_btc_amount_10m = ?,
			best_route_cex_10m = ?,
			best_route_method_10m = ?
		WHERE id = ?
	`,
		"analyzed",
		historicalRound4(analysis.avgRefPrice),
		historicalRound4(analysis.avgPremiumPct),
		historicalRound4(analysis.avgTradeCostPct),
		historicalRound8(analysis.avgTradeCostBTC),
		historicalRound4(analysis.avgNetPremiumPct),
		historicalRound8(analysis.avgProfitBTC),
		historicalRound4(analysis.avgProfitFiat),
		historicalRound8(analysis.btcAmount),
		analysis.bestRouteCEX,
		analysis.bestRouteMethod,
		offer.id,
	)
	return "analyzed", false
}

func averageClosePriceForWindow(sdb *sql.DB, windowStart, windowEnd time.Time) float64 {
	start := windowStart.UTC().Format("2006-01-02 15:04:05")
	end := windowEnd.UTC().Format("2006-01-02 15:04:05")

	var avgClose float64
	sdb.QueryRow(`
		SELECT AVG(close) FROM kraken_ohlc
		WHERE time >= ? AND time <= ?
	`, start, end).Scan(&avgClose)

	if avgClose == 0 {
		fetchAndStoreKrakenOHLCSince(sdb, windowStart.Unix())
		sdb.QueryRow(`
			SELECT AVG(close) FROM kraken_ohlc
			WHERE time >= ? AND time <= ?
		`, start, end).Scan(&avgClose)
	}

	if avgClose == 0 {
		sdb.QueryRow(`
			SELECT close FROM kraken_ohlc
			ORDER BY ABS(strftime('%s', time) - strftime('%s', ?))
			LIMIT 1
		`, end).Scan(&avgClose)
	}

	return avgClose
}

func computeClosedOfferWindowAnalysis(dexExchange string, premiumPct, avgRefPrice, btcAmount float64, networkFees historicalNetworkFeeProvider) closedOfferWindowAnalysis {
	route := bestHistoricalRoute(dexExchange, btcAmount, networkFees)
	netPremium := premiumPct - route.totalPct
	profitBTC := btcAmount * (netPremium / 100)

	return closedOfferWindowAnalysis{
		avgRefPrice:      avgRefPrice,
		avgPremiumPct:    premiumPct,
		avgTradeCostPct:  route.totalPct,
		avgTradeCostBTC:  route.totalBTC,
		avgNetPremiumPct: netPremium,
		avgProfitBTC:     profitBTC,
		avgProfitFiat:    profitBTC * avgRefPrice,
		btcAmount:        btcAmount,
		bestRouteCEX:     route.cex,
		bestRouteMethod:  string(route.method),
	}
}

func bestHistoricalRoute(dexExchange string, btcAmount float64, networkFees historicalNetworkFeeProvider) historicalTradeRoute {
	best := historicalTradeRoute{}
	found := false

	for _, cex := range historicalSupportedCEXes {
		for _, method := range supportedHistoricalMethods(cex, dexExchange) {
			route := buildHistoricalRoute(cex, dexExchange, method, btcAmount, networkFees)
			if !found || route.totalPct < best.totalPct {
				best = route
				found = true
			}
		}
	}

	if !found {
		return historicalTradeRoute{}
	}
	return best
}

func buildHistoricalRoute(cex, dexExchange string, method historicalWithdrawalMethod, btcAmount float64, networkFees historicalNetworkFeeProvider) historicalTradeRoute {
	takerBTC := btcAmount * historicalCexTakerFeeFallbacks[cex]
	withdrawalBTC := historicalWithdrawalFallbacks[cex][method]
	networkBTC := networkFees.FeeBTC(method, btcAmount)
	dexBTC := btcAmount * historicalDexTakerFees[dexExchange]
	totalBTC := takerBTC + withdrawalBTC + networkBTC + dexBTC

	return historicalTradeRoute{
		cex:      cex,
		method:   method,
		totalBTC: totalBTC,
		totalPct: totalBTC / btcAmount * 100,
	}
}

func supportedHistoricalMethods(cex, dexExchange string) []historicalWithdrawalMethod {
	methods := historicalCexMethods[cex]
	if len(methods) == 0 {
		return []historicalWithdrawalMethod{historicalMethodOnchain}
	}

	out := make([]historicalWithdrawalMethod, 0, len(methods))
	for _, method := range methods {
		if method == historicalMethodLightning && !historicalDexAcceptsLightning[dexExchange] {
			continue
		}
		out = append(out, method)
	}
	if len(out) == 0 {
		return []historicalWithdrawalMethod{historicalMethodOnchain}
	}
	return out
}

func directionalPremiumPct(direction string, offerPrice, refPrice float64) float64 {
	if refPrice <= 0 {
		return 0
	}
	pct := (offerPrice/refPrice - 1) * 100
	if direction == "sell" {
		pct = -pct
	}
	return pct
}

func selectHistoricalBTCTradeSize(btcMax, btcMin sql.NullFloat64) float64 {
	if btcMax.Valid && btcMax.Float64 > 0 {
		return btcMax.Float64
	}
	if btcMin.Valid && btcMin.Float64 > 0 {
		return btcMin.Float64
	}
	return historicalDefaultBTCTradeSize
}

func parseDBTimestamp(s string) (time.Time, bool) {
	for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02T15:04:05", "2006-01-02T15:04:05Z"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}

func historicalRound4(v float64) float64 {
	return math.Round(v*1e4) / 1e4
}

func historicalRound8(v float64) float64 {
	return math.Round(v*1e8) / 1e8
}
