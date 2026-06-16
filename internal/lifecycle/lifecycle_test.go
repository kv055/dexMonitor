package lifecycle

import (
	"context"
	"database/sql"
	"math"
	"testing"

	"commons/tradecost"

	_ "modernc.org/sqlite"
)

const testSchema = `
CREATE TABLE offers (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	best_route_cex TEXT,
	best_route_method TEXT,
	hedge_open_fee_btc REAL,
	hedge_close_fee_btc REAL,
	hedge_funding_fee_btc REAL,
	hedge_fee_sum_btc REAL,
	hedge_venue TEXT,
	hedge_instrument TEXT,
	hedge_transfer_minutes INTEGER,
	cex_taker_fee_btc REAL,
	cex_withdraw_fee_btc REAL,
	network_fee_btc REAL,
	dex_fee_btc REAL,
	abort_cost_btc REAL,
	abort_cost_pct REAL
);

CREATE TABLE order_lifecycle (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	offer_db_id INTEGER NOT NULL,
	snapshot_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	price REAL NOT NULL,
	ref_price REAL NOT NULL,
	premium_pct REAL NOT NULL,
	trade_cost_pct REAL,
	trade_cost_btc REAL,
	net_premium_pct REAL,
	net_premium_btc REAL,
	btc_amount REAL,
	hedge_notional_eur REAL,
	leverage_used REAL,
	recommended_collateral_eur REAL
);
`

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()

	db, err := sql.Open("sqlite", t.TempDir()+"/lifecycle.db")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() {
		db.Close()
	})
	if _, err := db.Exec(testSchema); err != nil {
		t.Fatalf("create schema: %v", err)
	}
	return db
}

func insertOffer(t *testing.T, db *sql.DB) int64 {
	t.Helper()

	res, err := db.Exec(`INSERT INTO offers DEFAULT VALUES`)
	if err != nil {
		t.Fatalf("insert offer: %v", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("last insert id: %v", err)
	}
	return id
}

func assertFloat(t *testing.T, got, want float64) {
	t.Helper()
	if math.Abs(got-want) > 1e-12 {
		t.Fatalf("got %.12f, want %.12f", got, want)
	}
}

func TestPersistSnapshotStoresStaticCostsOnOfferOnly(t *testing.T) {
	db := openTestDB(t)
	offerID := insertOffer(t, db)
	repo := NewRepository(db)

	err := repo.PersistSnapshot(context.Background(), []Record{{
		ID:            offerID,
		Price:         105,
		RefPrice:      100,
		PriceDiffPct:  5,
		NetPremiumPct: 4,
		CostBreakdown: tradecost.CostBreakdown{
			BTCAmount:          0.1,
			RouteCEX:           "kraken",
			RouteMethod:        "onchain",
			TradeDirection:     "bid",
			CexTakerFeeBTC:     0.00025,
			WithdrawalFeeBTC:   0.00015,
			NetworkFeeBTC:      0.0001,
			DexFeeBTC:          0.0005,
			TotalCostPct:       1,
			TotalCostBTC:       0.001,
			EstimatedProfitBTC: 0.004,
		},
	}})
	if err != nil {
		t.Fatalf("PersistSnapshot: %v", err)
	}

	var lifecycleRows int
	if err := db.QueryRow(`SELECT COUNT(*) FROM order_lifecycle`).Scan(&lifecycleRows); err != nil {
		t.Fatalf("count lifecycle: %v", err)
	}
	if lifecycleRows != 1 {
		t.Fatalf("lifecycle rows = %d, want 1", lifecycleRows)
	}

	var taker, withdrawal, network, dexFee, abortBTC, abortPct float64
	if err := db.QueryRow(`
		SELECT cex_taker_fee_btc, cex_withdraw_fee_btc, network_fee_btc,
		       dex_fee_btc, abort_cost_btc, abort_cost_pct
		FROM offers WHERE id = ?
	`, offerID).Scan(&taker, &withdrawal, &network, &dexFee, &abortBTC, &abortPct); err != nil {
		t.Fatalf("select offer costs: %v", err)
	}
	assertFloat(t, taker, 0.00025)
	assertFloat(t, withdrawal, 0.00015)
	assertFloat(t, network, 0.0001)
	assertFloat(t, dexFee, 0.0005)
	assertFloat(t, abortBTC, 0.00075)
	assertFloat(t, abortPct, 0.75)
}

func TestPersistSnapshotSkipsBadRowsAndKeepsGoodOnes(t *testing.T) {
	db := openTestDB(t)
	goodID := insertOffer(t, db)
	badRefID := insertOffer(t, db)
	badPriceID := insertOffer(t, db)
	repo := NewRepository(db)

	err := repo.PersistSnapshot(context.Background(), []Record{
		{ID: badRefID, Price: 100, RefPrice: 0, PriceDiffPct: 0, NetPremiumPct: 0,
			CostBreakdown: tradecost.CostBreakdown{TradeDirection: "bid"}},
		{ID: goodID, Price: 105, RefPrice: 100, PriceDiffPct: 5, NetPremiumPct: 4,
			CostBreakdown: tradecost.CostBreakdown{TradeDirection: "bid", BTCAmount: 0.1}},
		{ID: badPriceID, Price: 0, RefPrice: 100, PriceDiffPct: 0, NetPremiumPct: 0,
			CostBreakdown: tradecost.CostBreakdown{TradeDirection: "bid"}},
	})
	if err != nil {
		t.Fatalf("PersistSnapshot: %v", err)
	}

	var rows int
	if err := db.QueryRow(`SELECT COUNT(*) FROM order_lifecycle`).Scan(&rows); err != nil {
		t.Fatalf("count lifecycle: %v", err)
	}
	if rows != 1 {
		t.Fatalf("lifecycle rows = %d, want 1 (only the good row should land)", rows)
	}

	var storedOfferID int64
	if err := db.QueryRow(`SELECT offer_db_id FROM order_lifecycle`).Scan(&storedOfferID); err != nil {
		t.Fatalf("select offer id: %v", err)
	}
	if storedOfferID != goodID {
		t.Fatalf("stored offer = %d, want %d", storedOfferID, goodID)
	}
}

func TestLoadPastAggregatesComputesAveragesWithoutSamples(t *testing.T) {
	db := openTestDB(t)
	offerID := insertOffer(t, db)
	repo := NewRepository(db)

	for _, row := range []struct {
		price, ref, premium, netPct, netBTC float64
	}{
		{105, 100, 5, 4, 0.004},
		{110, 100, 10, 8, 0.008},
	} {
		if _, err := db.Exec(
			`INSERT INTO order_lifecycle (offer_db_id, price, ref_price, premium_pct, net_premium_pct, net_premium_btc)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			offerID, row.price, row.ref, row.premium, row.netPct, row.netBTC,
		); err != nil {
			t.Fatalf("insert lifecycle: %v", err)
		}
	}

	agg, err := repo.LoadPastAggregates(context.Background(), []int64{offerID})
	if err != nil {
		t.Fatalf("LoadPastAggregates: %v", err)
	}
	got := agg[offerID]
	if got.Count != 2 {
		t.Fatalf("count = %d, want 2", got.Count)
	}
	if len(got.Samples) != 0 {
		t.Fatalf("expected no samples in aggregate load, got %d", len(got.Samples))
	}
	assertFloat(t, got.AvgPremiumPercent, 7.5)
	assertFloat(t, got.AvgNetPercent, 6)
}

func TestLoadPastAggregatesComputesHedgePositionAverages(t *testing.T) {
	db := openTestDB(t)
	offerID := insertOffer(t, db)
	repo := NewRepository(db)

	for _, row := range []struct {
		notional, leverage, collateral float64
	}{
		{50, 5, 15},
		{60, 5, 17},
	} {
		if _, err := db.Exec(
			`INSERT INTO order_lifecycle
				(offer_db_id, price, ref_price, premium_pct, hedge_notional_eur, leverage_used, recommended_collateral_eur)
			 VALUES (?, 105, 100, 5, ?, ?, ?)`,
			offerID, row.notional, row.leverage, row.collateral,
		); err != nil {
			t.Fatalf("insert lifecycle: %v", err)
		}
	}

	agg, err := repo.LoadPastAggregates(context.Background(), []int64{offerID})
	if err != nil {
		t.Fatalf("LoadPastAggregates: %v", err)
	}
	got := agg[offerID]
	assertFloat(t, got.AvgHedgeNotionalEUR, 55)
	assertFloat(t, got.AvgLeverageUsed, 5)
	assertFloat(t, got.AvgRecommendedCollateralEUR, 16)
}

func TestLoadPastSamplesReturnsRefPriceRows(t *testing.T) {
	db := openTestDB(t)
	offerID := insertOffer(t, db)
	repo := NewRepository(db)

	if _, err := db.Exec(
		`INSERT INTO order_lifecycle (offer_db_id, price, ref_price, premium_pct)
		 VALUES (?, 105, 100, 5), (?, 110, 100, 10)`,
		offerID, offerID,
	); err != nil {
		t.Fatalf("insert lifecycle: %v", err)
	}

	samples, err := repo.LoadPastSamples(context.Background(), []int64{offerID})
	if err != nil {
		t.Fatalf("LoadPastSamples: %v", err)
	}
	if len(samples[offerID]) != 2 {
		t.Fatalf("sample count = %d, want 2", len(samples[offerID]))
	}
}

func TestPersistSnapshotLeavesAskWithdrawalFeeNull(t *testing.T) {
	db := openTestDB(t)
	offerID := insertOffer(t, db)
	repo := NewRepository(db)

	err := repo.PersistSnapshot(context.Background(), []Record{{
		ID:            offerID,
		Price:         95,
		RefPrice:      100,
		PriceDiffPct:  5,
		NetPremiumPct: 4,
		CostBreakdown: tradecost.CostBreakdown{
			BTCAmount:          0.1,
			RouteCEX:           "kraken",
			RouteMethod:        "onchain",
			TradeDirection:     "ask",
			CexTakerFeeBTC:     0.00025,
			WithdrawalFeeBTC:   0.00015,
			NetworkFeeBTC:      0.0001,
			DexFeeBTC:          0.0005,
			TotalCostPct:       1,
			TotalCostBTC:       0.001,
			EstimatedProfitBTC: 0.004,
		},
	}})
	if err != nil {
		t.Fatalf("PersistSnapshot: %v", err)
	}

	var withdrawal sql.NullFloat64
	if err := db.QueryRow(`SELECT cex_withdraw_fee_btc FROM offers WHERE id = ?`, offerID).Scan(&withdrawal); err != nil {
		t.Fatalf("select withdrawal: %v", err)
	}
	if withdrawal.Valid {
		t.Fatalf("ask withdrawal fee = %v, want NULL", withdrawal.Float64)
	}

	var abortBTC, abortPct float64
	if err := db.QueryRow(`SELECT abort_cost_btc, abort_cost_pct FROM offers WHERE id = ?`, offerID).Scan(&abortBTC, &abortPct); err != nil {
		t.Fatalf("select abort cost: %v", err)
	}
	assertFloat(t, abortBTC, 0.0002)
	assertFloat(t, abortPct, 0.2)
}
