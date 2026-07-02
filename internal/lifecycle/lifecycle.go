package lifecycle

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"commons/tradecost"
)

// Point represents a point.
type Point struct {
	// Time records the relevant time for the point.
	Time string `json:"time"`
	// Price is the price value used by the point.
	Price float64 `json:"price"`
	// NetPremiumPct is a percentage value.
	NetPremiumPct *float64 `json:"net_premium_pct,omitempty"`
}

// PastAggregate represents a past aggregate.
type PastAggregate struct {
	// Count is the count associated with the past aggregate.
	Count int
	// AvgOfferPrice is the price value used by the past aggregate.
	AvgOfferPrice float64
	// AvgRefPrice is the price value used by the past aggregate.
	AvgRefPrice float64
	// AvgPremiumPercent is a percentage value.
	AvgPremiumPercent float64
	// AvgTradeCostPct is a percentage value.
	AvgTradeCostPct float64
	// AvgTradeCostBTC is a BTC-denominated avg trade cost btc value.
	AvgTradeCostBTC float64
	// AvgNetPercent is a percentage value.
	AvgNetPercent float64
	// AvgProfitBTC is a BTC-denominated avg profit btc value.
	AvgProfitBTC float64
	// AvgProfitFiat is a fiat-denominated avg profit fiat value.
	AvgProfitFiat float64
	// AvgBTCAmount is a BTC-denominated avg btcamount value.
	AvgBTCAmount float64
	// AvgNetworkPct is a percentage value.
	AvgNetworkPct float64
	// AvgHedgeNotionalEUR is the average perp hedge notional in EUR across the
	// offer's lifecycle samples.
	AvgHedgeNotionalEUR float64
	// AvgLeverageUsed is the average leverage assumed for hedge sizing across
	// the offer's lifecycle samples.
	AvgLeverageUsed float64
	// AvgRecommendedCollateralEUR is the average recommended hedge collateral
	// in EUR across the offer's lifecycle samples.
	AvgRecommendedCollateralEUR float64
}

// Record represents a record.
type Record struct {
	// ID identifies the record.
	ID int64
	// Price is the price value used by the record.
	Price float64
	// RefPrice is the price value used by the record.
	RefPrice float64
	// PriceDiffPct is a percentage value.
	PriceDiffPct float64
	// NetPremiumPct is a percentage value.
	NetPremiumPct float64
	// CostBreakdown is the cost breakdown value for the record.
	CostBreakdown tradecost.CostBreakdown
}

// Repository represents a repository.
type Repository struct {
	// DB is the database handle used by the repository.
	DB *sql.DB
}

// NewRepository creates a repository.
func NewRepository(db *sql.DB) Repository {
	return Repository{DB: db}
}

// LoadByOfferIDs loads a by offer ids.
func (r Repository) LoadByOfferIDs(ctx context.Context, ids []int64) (map[int64][]Point, error) {
	result := make(map[int64][]Point, len(ids))
	if r.DB == nil || len(ids) == 0 {
		return result, nil
	}
	placeholders, args := placeholders(ids)
	rows, err := r.DB.QueryContext(ctx, rebind(fmt.Sprintf(
		`SELECT offer_db_id, snapshot_time, price, net_premium_pct FROM order_lifecycle WHERE offer_db_id IN (%s) ORDER BY offer_db_id, snapshot_time`,
		strings.Join(placeholders, ","),
	)), args...)
	if err != nil {
		return result, err
	}
	defer rows.Close()
	for rows.Next() {
		var offerID int64
		var snapTime any
		var price float64
		var netPremiumPct sql.NullFloat64
		if err := rows.Scan(&offerID, &snapTime, &price, &netPremiumPct); err != nil {
			continue
		}
		pt := Point{Time: formatSnapshotTime(snapTime), Price: price}
		if netPremiumPct.Valid {
			pt.NetPremiumPct = &netPremiumPct.Float64
		}
		result[offerID] = append(result[offerID], pt)
	}
	return result, nil
}

func formatSnapshotTime(value any) string {
	switch v := value.(type) {
	case time.Time:
		return v.UTC().Format("2006-01-02T15:04:05Z")
	case string:
		if parsed, err := time.Parse("2006-01-02 15:04:05", v); err == nil {
			return parsed.UTC().Format("2006-01-02T15:04:05Z")
		}
		return v
	case []byte:
		return formatSnapshotTime(string(v))
	default:
		return ""
	}
}

// LoadPastAggregates loads per-offer lifecycle averages without raw sample rows.
func (r Repository) LoadPastAggregates(ctx context.Context, ids []int64) (map[int64]PastAggregate, error) {
	result := make(map[int64]PastAggregate, len(ids))
	if r.DB == nil || len(ids) == 0 {
		return result, nil
	}
	ph, args := placeholders(ids)
	rows, err := r.DB.QueryContext(ctx, rebind(fmt.Sprintf(
		`SELECT offer_db_id,
		        COUNT(*) AS cnt,
		        AVG(price) AS avg_price,
		        AVG(ref_price) AS avg_ref_price,
		        AVG(premium_pct) AS avg_premium,
		        AVG(trade_cost_pct) AS avg_trade_cost_pct,
		        AVG(trade_cost_btc) AS avg_trade_cost_btc,
		        AVG(net_premium_pct) AS avg_net_pct,
		        AVG(net_premium_btc) AS avg_profit_btc,
		        AVG(net_premium_btc * ref_price) AS avg_profit_fiat,
		        AVG(btc_amount) AS avg_btc_amount,
		        AVG(hedge_notional_eur) AS avg_hedge_notional_eur,
		        AVG(leverage_used) AS avg_leverage_used,
		        AVG(recommended_collateral_eur) AS avg_recommended_collateral_eur
		   FROM order_lifecycle
		  WHERE offer_db_id IN (%s)
		  GROUP BY offer_db_id`,
		strings.Join(ph, ","),
	)), args...)
	if err != nil {
		return result, err
	}
	defer rows.Close()

	for rows.Next() {
		var offerID int64
		var count int
		var avgPrice, avgRefPrice, avgPremium sql.NullFloat64
		var avgTradeCostPct, avgTradeCostBTC, avgNetPct, avgProfitBTC, avgProfitFiat, avgBTCAmount sql.NullFloat64
		var avgHedgeNotionalEUR, avgLeverageUsed, avgRecommendedCollateralEUR sql.NullFloat64
		if err := rows.Scan(
			&offerID, &count,
			&avgPrice, &avgRefPrice, &avgPremium,
			&avgTradeCostPct, &avgTradeCostBTC, &avgNetPct,
			&avgProfitBTC, &avgProfitFiat, &avgBTCAmount,
			&avgHedgeNotionalEUR, &avgLeverageUsed, &avgRecommendedCollateralEUR,
		); err != nil {
			continue
		}
		agg := PastAggregate{Count: count}
		if avgPrice.Valid {
			agg.AvgOfferPrice = tradecost.Round4(avgPrice.Float64)
		}
		if avgRefPrice.Valid {
			agg.AvgRefPrice = tradecost.Round4(avgRefPrice.Float64)
		}
		if avgPremium.Valid {
			agg.AvgPremiumPercent = tradecost.Round4(avgPremium.Float64)
		}
		if avgTradeCostPct.Valid {
			agg.AvgTradeCostPct = tradecost.Round4(avgTradeCostPct.Float64)
		}
		if avgTradeCostBTC.Valid {
			agg.AvgTradeCostBTC = tradecost.Round8(avgTradeCostBTC.Float64)
		}
		if avgNetPct.Valid {
			agg.AvgNetPercent = tradecost.Round4(avgNetPct.Float64)
		}
		if avgProfitBTC.Valid {
			agg.AvgProfitBTC = tradecost.Round8(avgProfitBTC.Float64)
		}
		if avgProfitFiat.Valid {
			agg.AvgProfitFiat = tradecost.Round4(avgProfitFiat.Float64)
		}
		if avgBTCAmount.Valid {
			agg.AvgBTCAmount = tradecost.Round8(avgBTCAmount.Float64)
		}
		if avgHedgeNotionalEUR.Valid {
			agg.AvgHedgeNotionalEUR = tradecost.Round2(avgHedgeNotionalEUR.Float64)
		}
		if avgLeverageUsed.Valid {
			agg.AvgLeverageUsed = tradecost.Round4(avgLeverageUsed.Float64)
		}
		if avgRecommendedCollateralEUR.Valid {
			agg.AvgRecommendedCollateralEUR = tradecost.Round2(avgRecommendedCollateralEUR.Float64)
		}
		result[offerID] = agg
	}
	return result, nil
}

// PersistSnapshot writes lifecycle samples and derived route costs.
// Per-row best-effort: a single bad row never aborts the rest of the batch;
// skipped/failing rows are logged with offer ID so silent data loss is loud.
func (r Repository) PersistSnapshot(ctx context.Context, offers []Record) error {
	if len(offers) == 0 || r.DB == nil {
		return nil
	}
	insStmt, err := r.DB.PrepareContext(ctx, rebind(`
		INSERT INTO order_lifecycle
			(offer_db_id, price, ref_price, premium_pct,
			 trade_cost_pct, trade_cost_btc, net_premium_pct, net_premium_btc, btc_amount)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
	`))
	if err != nil {
		return fmt.Errorf("prepare insert: %w", err)
	}
	defer insStmt.Close()

	updStmt, err := r.DB.PrepareContext(ctx, rebind(`
		UPDATE offers SET
			best_route_cex = ?,
			best_route_method = ?,
			hedge_open_fee_btc = ?,
			hedge_close_fee_btc = ?,
			hedge_funding_fee_btc = ?,
			hedge_fee_sum_btc = ?,
			hedge_venue = ?,
			hedge_instrument = ?,
			hedge_transfer_minutes = ?,
			cex_taker_fee_btc = ?,
			cex_withdraw_fee_btc = ?,
			network_fee_btc = ?,
			dex_fee_btc = ?,
			abort_cost_btc = ?,
			abort_cost_pct = ?
		WHERE id = ?
	`))
	if err != nil {
		return fmt.Errorf("prepare update: %w", err)
	}
	defer updStmt.Close()

	total := len(offers)
	var skippedRefPrice, skippedOfferPrice, inserted, insertErrs, updateErrs int
	var skippedSampleIDs, insertErrSampleIDs []int64
	appendSample := func(dst *[]int64, id int64) {
		if len(*dst) < 5 {
			*dst = append(*dst, id)
		}
	}

	for _, o := range offers {
		// Match the DB CHECK constraints so we don't rely on tx-abort to surface bad data.
		if o.RefPrice <= 0 {
			skippedRefPrice++
			appendSample(&skippedSampleIDs, o.ID)
			continue
		}
		if o.Price <= 0 {
			skippedOfferPrice++
			appendSample(&skippedSampleIDs, o.ID)
			continue
		}
		bd := o.CostBreakdown
		var cexWithdrawFee any
		if bd.TradeDirection != "ask" {
			cexWithdrawFee = tradecost.Round8(bd.WithdrawalFeeBTC)
		}
		if _, err := insStmt.ExecContext(ctx,
			o.ID,
			tradecost.Round4(o.Price),
			tradecost.Round4(o.RefPrice),
			tradecost.Round4(o.PriceDiffPct),
			tradecost.Round4(bd.TotalCostPct),
			tradecost.Round8(bd.TotalCostBTC),
			tradecost.Round4(o.NetPremiumPct),
			tradecost.Round8(bd.EstimatedProfitBTC),
			tradecost.Round8(bd.BTCAmount),
		); err != nil {
			insertErrs++
			appendSample(&insertErrSampleIDs, o.ID)
			fmt.Printf("[Lifecycle] insert error offer_db_id=%d: %v\n", o.ID, err)
			continue
		}
		inserted++
		if bd.RouteCEX != "" {
			abort := tradecost.AbortCostFromBreakdown(bd)
			if _, err := updStmt.ExecContext(ctx,
				bd.RouteCEX,
				bd.RouteMethod,
				tradecost.Round8(bd.Hedge.OpenFeeBTC),
				tradecost.Round8(bd.Hedge.CloseFeeBTC),
				tradecost.Round8(bd.Hedge.FundingFeeBTC),
				tradecost.Round8(bd.Hedge.FeeSumBTC),
				nullIfEmpty(bd.Hedge.Venue),
				nullIfEmpty(bd.Hedge.Instrument),
				nullIfZeroInt(bd.Hedge.TransferMinutes),
				tradecost.Round8(bd.CexTakerFeeBTC),
				cexWithdrawFee,
				tradecost.Round8(bd.NetworkFeeBTC),
				tradecost.Round8(bd.DexFeeBTC),
				tradecost.Round8(abort.Total.BTC),
				tradecost.Round4(abort.Total.Pct),
				o.ID,
			); err != nil {
				updateErrs++
				fmt.Printf("[Lifecycle] update offer-costs error offer_db_id=%d: %v\n", o.ID, err)
			}
		}
	}

	if skippedRefPrice+skippedOfferPrice > 0 || insertErrs > 0 || updateErrs > 0 {
		fmt.Printf("[Lifecycle] batch=%d inserted=%d skipped_ref_price<=0=%d skipped_offer_price<=0=%d insert_errs=%d update_errs=%d sample_skipped_ids=%v sample_insert_err_ids=%v\n",
			total, inserted, skippedRefPrice, skippedOfferPrice, insertErrs, updateErrs, skippedSampleIDs, insertErrSampleIDs)
	}
	return nil
}

func placeholders(ids []int64) ([]string, []any) {
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	return placeholders, args
}

func rebind(query string) string {
	var out strings.Builder
	n := 1
	inQuote := false
	for i := 0; i < len(query); i++ {
		ch := query[i]
		if ch == '\'' {
			out.WriteByte(ch)
			if i+1 < len(query) && query[i+1] == '\'' {
				out.WriteByte(query[i+1])
				i++
				continue
			}
			inQuote = !inQuote
			continue
		}
		if ch == '?' && !inQuote {
			out.WriteString(fmt.Sprintf("$%d", n))
			n++
			continue
		}
		out.WriteByte(ch)
	}
	return out.String()
}

func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func nullIfZeroInt(v int) any {
	if v == 0 {
		return nil
	}
	return v
}
