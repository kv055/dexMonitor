package main

import (
	"database/sql"
	"fmt"
	"math"
)

const deleteBelowPremiumPct = -3.0

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

	analyzed := 0
	deleted := 0
	ignored := 0

	for _, offer := range batch {
		status, removed := analyzeSingleClosedOffer(sdb, offer)
		switch status {
		case "analyzed", "non_premium":
			analyzed++
		case "ignored_no_lifecycle":
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

func analyzeSingleClosedOffer(sdb *sql.DB, offer closedOfferRecord) (string, bool) {
	// Single query: overall aggregates + profitable-only conditional aggregates.
	// AVG(CASE WHEN net_premium_pct > 0 THEN col END) returns NULL when no row matches,
	// which maps cleanly to sql.NullFloat64.
	var totalCount, profitableCount int
	var overallAvgPremium sql.NullFloat64 // all entries — used for delete threshold
	var avgRefPrice sql.NullFloat64       // all entries — market reference
	var profAvgPremium sql.NullFloat64    // profitable entries only
	var profAvgTradeCostPct sql.NullFloat64
	var profAvgTradeCostBTC sql.NullFloat64
	var profAvgNetPremiumPct sql.NullFloat64
	var profAvgNetPremiumBTC sql.NullFloat64
	var profAvgBTCAmount sql.NullFloat64

	err := sdb.QueryRow(`
		SELECT
			COUNT(*),
			AVG(ref_price),
			AVG(premium_pct),
			COUNT(CASE WHEN net_premium_pct > 0 THEN 1 END),
			AVG(CASE WHEN net_premium_pct > 0 THEN premium_pct    END),
			AVG(CASE WHEN net_premium_pct > 0 THEN trade_cost_pct END),
			AVG(CASE WHEN net_premium_pct > 0 THEN trade_cost_btc END),
			AVG(CASE WHEN net_premium_pct > 0 THEN net_premium_pct END),
			AVG(CASE WHEN net_premium_pct > 0 THEN net_premium_btc END),
			AVG(CASE WHEN net_premium_pct > 0 THEN btc_amount     END)
		FROM order_lifecycle
		WHERE offer_db_id = ?
	`, offer.id).Scan(
		&totalCount,
		&avgRefPrice,
		&overallAvgPremium,
		&profitableCount,
		&profAvgPremium,
		&profAvgTradeCostPct,
		&profAvgTradeCostBTC,
		&profAvgNetPremiumPct,
		&profAvgNetPremiumBTC,
		&profAvgBTCAmount,
	)
	if err != nil || totalCount == 0 || !avgRefPrice.Valid {
		_, _ = sdb.Exec(`UPDATE offers SET historical_analysis_status = ? WHERE id = ?`, "ignored_no_lifecycle", offer.id)
		return "ignored_no_lifecycle", false
	}

	// Delete threshold uses the overall (unfiltered) average premium.
	if overallAvgPremium.Valid && overallAvgPremium.Float64 < deleteBelowPremiumPct {
		_, _ = sdb.Exec(`DELETE FROM offers WHERE id = ?`, offer.id)
		return "deleted_non_premium", true
	}

	// No profitable snapshots → non_premium (store basic stats only).
	if profitableCount == 0 {
		_, _ = sdb.Exec(`
			UPDATE offers SET
				historical_analysis_status = ?,
				avg_ref_price              = ?,
				avg_premium_pct            = ?,
				avg_btc_amount             = ?
			WHERE id = ?
		`, "non_premium",
			historicalRound4(avgRefPrice.Float64),
			historicalRound4(overallAvgPremium.Float64),
			historicalRound8(profAvgBTCAmount.Float64),
			offer.id,
		)
		return "non_premium", false
	}

	// Best route is maintained live on the offers table by the server.
	var bestRouteCEX, bestRouteMethod sql.NullString
	_ = sdb.QueryRow(`SELECT best_route_cex, best_route_method FROM offers WHERE id = ?`, offer.id).
		Scan(&bestRouteCEX, &bestRouteMethod)

	var cexTakerFeeBTC, cexWithdrawFeeBTC, networkFeeBTC, dexFeeBTC sql.NullFloat64
	_ = sdb.QueryRow(`
		SELECT cex_taker_fee_btc, cex_withdraw_fee_btc, network_fee_btc, dex_fee_btc
		FROM order_lifecycle
		WHERE offer_db_id = ? AND net_premium_pct > 0
		ORDER BY snapshot_time DESC, id DESC
		LIMIT 1
	`, offer.id).Scan(&cexTakerFeeBTC, &cexWithdrawFeeBTC, &networkFeeBTC, &dexFeeBTC)

	profitFiat := profAvgNetPremiumBTC.Float64 * avgRefPrice.Float64

	_, _ = sdb.Exec(`
		UPDATE offers SET
			historical_analysis_status = ?,
			avg_ref_price              = ?,
			avg_premium_pct            = ?,
			avg_trade_cost_pct         = ?,
			avg_trade_cost_btc         = ?,
			cex_taker_fee_btc          = ?,
			cex_withdraw_fee_btc       = ?,
			network_fee_btc            = ?,
			dex_fee_btc                = ?,
			avg_net_premium_pct        = ?,
			avg_estimated_profit_btc   = ?,
			avg_estimated_profit_fiat  = ?,
			avg_btc_amount             = ?,
			best_route_cex             = ?,
			best_route_method          = ?
		WHERE id = ?
	`,
		"analyzed",
		historicalRound4(avgRefPrice.Float64),
		historicalRound4(profAvgPremium.Float64),
		historicalRound4(profAvgTradeCostPct.Float64),
		historicalRound8(profAvgTradeCostBTC.Float64),
		nullHistoricalRound8(cexTakerFeeBTC),
		nullHistoricalRound8(cexWithdrawFeeBTC),
		nullHistoricalRound8(networkFeeBTC),
		nullHistoricalRound8(dexFeeBTC),
		historicalRound4(profAvgNetPremiumPct.Float64),
		historicalRound8(profAvgNetPremiumBTC.Float64),
		historicalRound4(profitFiat),
		historicalRound8(profAvgBTCAmount.Float64),
		bestRouteCEX.String,
		bestRouteMethod.String,
		offer.id,
	)
	return "analyzed", false
}

func historicalRound4(v float64) float64 {
	return math.Round(v*1e4) / 1e4
}

func historicalRound8(v float64) float64 {
	return math.Round(v*1e8) / 1e8
}

func nullHistoricalRound8(v sql.NullFloat64) any {
	if !v.Valid {
		return nil
	}
	return historicalRound8(v.Float64)
}
