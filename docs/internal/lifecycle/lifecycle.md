# `internal/lifecycle/lifecycle.go`

Source package: `lifecycle`  
Source lines: `388`

## Package Purpose

This file contributes to the `lifecycle` package.

## File Role

This file defines 5 type(s), implements 9 function or method entry point(s).

## Runtime Behavior

- Reads from or writes to persistent storage.
- Serializes or deserializes JSON payloads.
- Uses time windows, timestamps, or duration calculations.
- Accepts context for cancellation, deadlines, or request scoping.

## Types

### `Point`

Point represents a point.

Fields:

- `Time` `string`: Time records the relevant time for the point.
- `Price` `float64`: Price is the price value used by the point.
- `NetPremiumPct` `*float64`: NetPremiumPct is a percentage value.

### `PastSample`

PastSample represents a past sample.

Fields:

- `RefPrice` `float64`: RefPrice is the price value used by the past sample.
- `PremiumPct` `float64`: PremiumPct is a percentage value.

### `PastAggregate`

PastAggregate represents a past aggregate.

Fields:

- `Count` `int`: Count is the count associated with the past aggregate.
- `AvgOfferPrice` `float64`: AvgOfferPrice is the price value used by the past aggregate.
- `AvgRefPrice` `float64`: AvgRefPrice is the price value used by the past aggregate.
- `AvgPremiumPercent` `float64`: AvgPremiumPercent is a percentage value.
- `AvgTradeCostPct` `float64`: AvgTradeCostPct is a percentage value.
- `AvgTradeCostBTC` `float64`: AvgTradeCostBTC is a BTC-denominated avg trade cost btc value.
- `AvgNetPercent` `float64`: AvgNetPercent is a percentage value.
- `AvgProfitBTC` `float64`: AvgProfitBTC is a BTC-denominated avg profit btc value.
- `AvgProfitFiat` `float64`: AvgProfitFiat is a fiat-denominated avg profit fiat value.
- `AvgBTCAmount` `float64`: AvgBTCAmount is a BTC-denominated avg btcamount value.
- `AvgNetworkPct` `float64`: AvgNetworkPct is a percentage value.
- `Samples` `[]PastSample`: Samples is the samples value for the past aggregate.

### `Record`

Record represents a record.

Fields:

- `ID` `int64`: ID identifies the record.
- `Price` `float64`: Price is the price value used by the record.
- `RefPrice` `float64`: RefPrice is the price value used by the record.
- `PriceDiffPct` `float64`: PriceDiffPct is a percentage value.
- `NetPremiumPct` `float64`: NetPremiumPct is a percentage value.
- `CostBreakdown` `tradecost.CostBreakdown`: CostBreakdown is the cost breakdown value for the record.

### `Repository`

Repository represents a repository.

Fields:

- `DB` `*sql.DB`: DB is the database handle used by the repository.

## Functions and Methods

### `NewRepository`

NewRepository creates a repository.

Signature: `func NewRepository(db *sql.DB) Repository`

### `(Repository).LoadByOfferIDs`

LoadByOfferIDs loads a by offer ids.

Signature: `func (r Repository) LoadByOfferIDs(ctx context.Context, ids []int64) (map[int64][]Point, error)`

### `formatSnapshotTime`

This function is part of the `lifecycle` package implementation.

Signature: `func formatSnapshotTime(value any) string`

### `(Repository).LoadPastAggregates`

LoadPastAggregates loads a past aggregates.

Signature: `func (r Repository) LoadPastAggregates(ctx context.Context, ids []int64) (map[int64]PastAggregate, error)`

### `(Repository).PersistSnapshot`

PersistSnapshot writes lifecycle samples and derived route costs.

Signature: `func (r Repository) PersistSnapshot(ctx context.Context, offers []Record) error`

### `placeholders`

This function is part of the `lifecycle` package implementation.

Signature: `func placeholders(ids []int64) ([]string, []any)`

### `rebind`

This function is part of the `lifecycle` package implementation.

Signature: `func rebind(query string) string`

### `nullIfEmpty`

This function is part of the `lifecycle` package implementation.

Signature: `func nullIfEmpty(s string) any`

### `nullIfZeroInt`

This function is part of the `lifecycle` package implementation.

Signature: `func nullIfZeroInt(v int) any`

## Key Dependencies

- `context`
- `database/sql`
- `fmt`
- `strings`
- `time`
- `commons/tradecost`

