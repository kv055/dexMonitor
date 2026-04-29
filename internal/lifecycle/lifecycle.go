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

// PastSample represents a past sample.
type PastSample struct {
	// RefPrice is the price value used by the past sample.
	RefPrice float64
	// PremiumPct is a percentage value.
	PremiumPct float64
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
	// Samples is the samples value for the past aggregate.
	Samples []PastSample
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

// LoadPastAggregates loads a past aggregates.
func (r Repository) LoadPastAggregates(ctx context.Context, ids []int64) (map[int64]PastAggregate, error) {
	result := make(map[int64]PastAggregate, len(ids))
	if r.DB == nil || len(ids) == 0 {
		return result, nil
	}
	ph, args := placeholders(ids)
	rows, err := r.DB.QueryContext(ctx, rebind(fmt.Sprintf(
		`SELECT offer_db_id, price, ref_price, premium_pct, trade_cost_pct, trade_cost_btc,
		        network_fee_btc, net_premium_pct, net_premium_btc, btc_amount
		   FROM order_lifecycle
		  WHERE offer_db_id IN (%s)
		  ORDER BY offer_db_id, snapshot_time`,
		strings.Join(ph, ","),
	)), args...)
	if err != nil {
		return result, err
	}
	defer rows.Close()

	type accum struct {
		count             int
		sumPrice          float64
		sumRefPrice       float64
		sumPremium        float64
		sumTradeCostPct   float64
		countTradeCost    int
		sumTradeCostBTC   float64
		countTradeCostBTC int
		sumNetPct         float64
		countNetPct       int
		sumProfitBTC      float64
		countProfitBTC    int
		sumProfitFiat     float64
		countProfitFiat   int
		sumBTCAmount      float64
		countBTCAmount    int
		sumNetworkPct     float64
		countNetworkPct   int
		samples           []PastSample
	}

	accs := make(map[int64]*accum, len(ids))
	for rows.Next() {
		var offerID int64
		var price, refPrice, premiumPct float64
		var tradeCostPct, tradeCostBTC, networkFeeBTC, netPremiumPct, netPremiumBTC, btcAmount sql.NullFloat64
		if err := rows.Scan(&offerID, &price, &refPrice, &premiumPct, &tradeCostPct, &tradeCostBTC, &networkFeeBTC, &netPremiumPct, &netPremiumBTC, &btcAmount); err != nil {
			continue
		}
		ac := accs[offerID]
		if ac == nil {
			ac = &accum{}
			accs[offerID] = ac
		}
		ac.count++
		ac.sumPrice += price
		ac.sumRefPrice += refPrice
		ac.sumPremium += premiumPct
		ac.samples = append(ac.samples, PastSample{RefPrice: refPrice, PremiumPct: premiumPct})
		if tradeCostPct.Valid {
			ac.sumTradeCostPct += tradeCostPct.Float64
			ac.countTradeCost++
		}
		if tradeCostBTC.Valid {
			ac.sumTradeCostBTC += tradeCostBTC.Float64
			ac.countTradeCostBTC++
		}
		if netPremiumPct.Valid {
			ac.sumNetPct += netPremiumPct.Float64
			ac.countNetPct++
		}
		if netPremiumBTC.Valid {
			ac.sumProfitBTC += netPremiumBTC.Float64
			ac.countProfitBTC++
			ac.sumProfitFiat += netPremiumBTC.Float64 * refPrice
			ac.countProfitFiat++
		}
		if btcAmount.Valid {
			ac.sumBTCAmount += btcAmount.Float64
			ac.countBTCAmount++
			if networkFeeBTC.Valid && btcAmount.Float64 > 0 {
				ac.sumNetworkPct += (networkFeeBTC.Float64 / btcAmount.Float64) * 100
				ac.countNetworkPct++
			}
		}
	}

	for id, ac := range accs {
		agg := PastAggregate{}
		if ac.count > 0 {
			agg.Count = ac.count
			agg.AvgOfferPrice = tradecost.Round4(ac.sumPrice / float64(ac.count))
			agg.AvgRefPrice = tradecost.Round4(ac.sumRefPrice / float64(ac.count))
			agg.AvgPremiumPercent = tradecost.Round4(ac.sumPremium / float64(ac.count))
		}
		if ac.countTradeCost > 0 {
			agg.AvgTradeCostPct = tradecost.Round4(ac.sumTradeCostPct / float64(ac.countTradeCost))
		}
		if ac.countTradeCostBTC > 0 {
			agg.AvgTradeCostBTC = tradecost.Round8(ac.sumTradeCostBTC / float64(ac.countTradeCostBTC))
		}
		if ac.countNetPct > 0 {
			agg.AvgNetPercent = tradecost.Round4(ac.sumNetPct / float64(ac.countNetPct))
		}
		if ac.countProfitBTC > 0 {
			agg.AvgProfitBTC = tradecost.Round8(ac.sumProfitBTC / float64(ac.countProfitBTC))
		}
		if ac.countProfitFiat > 0 {
			agg.AvgProfitFiat = tradecost.Round4(ac.sumProfitFiat / float64(ac.countProfitFiat))
		}
		if ac.countBTCAmount > 0 {
			agg.AvgBTCAmount = tradecost.Round8(ac.sumBTCAmount / float64(ac.countBTCAmount))
		}
		if ac.countNetworkPct > 0 {
			agg.AvgNetworkPct = tradecost.Round4(ac.sumNetworkPct / float64(ac.countNetworkPct))
		}
		agg.Samples = ac.samples
		result[id] = agg
	}
	return result, nil
}

// PersistSnapshot writes lifecycle samples and derived route costs.
func (r Repository) PersistSnapshot(ctx context.Context, offers []Record) error {
	if len(offers) == 0 || r.DB == nil {
		return nil
	}
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()
	insStmt, err := tx.PrepareContext(ctx, rebind(`
		INSERT INTO order_lifecycle
			(offer_db_id, price, ref_price, premium_pct,
			 trade_cost_pct, trade_cost_btc, cex_taker_fee_btc, cex_withdraw_fee_btc, network_fee_btc, dex_fee_btc,
			 net_premium_pct, net_premium_btc, btc_amount)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`))
	if err != nil {
		return fmt.Errorf("prepare insert: %w", err)
	}
	defer insStmt.Close()

	updStmt, err := tx.PrepareContext(ctx, rebind(`
		UPDATE offers SET
			best_route_cex = ?,
			best_route_method = ?,
			hedge_open_fee_btc = ?,
			hedge_close_fee_btc = ?,
			hedge_funding_fee_btc = ?,
			hedge_fee_sum_btc = ?,
			hedge_venue = ?,
			hedge_instrument = ?,
			hedge_transfer_minutes = ?
		WHERE id = ?
	`))
	if err != nil {
		return fmt.Errorf("prepare update: %w", err)
	}
	defer updStmt.Close()

	for _, o := range offers {
		if o.RefPrice <= 0 {
			continue
		}
		bd := o.CostBreakdown
		var cexWithdrawFee any
		if bd.TradeDirection != "ask" {
			cexWithdrawFee = tradecost.Round8(bd.WithdrawalFeeBTC)
		}
		_, _ = insStmt.ExecContext(ctx,
			o.ID,
			tradecost.Round4(o.Price),
			tradecost.Round4(o.RefPrice),
			tradecost.Round4(o.PriceDiffPct),
			tradecost.Round4(bd.TotalCostPct),
			tradecost.Round8(bd.TotalCostBTC),
			tradecost.Round8(bd.CexTakerFeeBTC),
			cexWithdrawFee,
			tradecost.Round8(bd.NetworkFeeBTC),
			tradecost.Round8(bd.DexFeeBTC),
			tradecost.Round4(o.NetPremiumPct),
			tradecost.Round8(bd.EstimatedProfitBTC),
			tradecost.Round8(bd.BTCAmount),
		)
		if bd.RouteCEX != "" {
			_, _ = updStmt.ExecContext(ctx,
				bd.RouteCEX,
				bd.RouteMethod,
				tradecost.Round8(bd.Hedge.OpenFeeBTC),
				tradecost.Round8(bd.Hedge.CloseFeeBTC),
				tradecost.Round8(bd.Hedge.FundingFeeBTC),
				tradecost.Round8(bd.Hedge.FeeSumBTC),
				nullIfEmpty(bd.Hedge.Venue),
				nullIfEmpty(bd.Hedge.Instrument),
				nullIfZeroInt(bd.Hedge.TransferMinutes),
				o.ID,
			)
		}
	}
	return tx.Commit()
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
