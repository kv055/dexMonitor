# `stats.go`

## Purpose

This file builds time-windowed statistics for closed offers and general premium
summaries for the monitor dashboard. For the Past Trades aggregation feature,
its main responsibility is turning already-filtered profitable closed offers
into the `/api/past_order_stats` response consumed by the Taker Opportunities
view.

## Runtime Role

`dexMonitor/cmd/server` loads analyzed closed offers from the database
(`historical_analysis_status = 'analyzed'`, last seven days), recomputes or
selects the relevant profitability mode, filters out unprofitable offers, and
then passes those profitable offers into this package as `PremiumOrder` values.

This file groups those values into standard reporting windows, applies optional
payment-method exclusions, sums BTC and fiat profit, and includes capped
position totals when a max fiat limit reduced at least one trade.

## Function Map

### `BuildStats`

Signature:

```go
func BuildStats(orders []PremiumOrder, now time.Time, fiatCurrency string, excludedPaymentMethods []string) StatsResponse
```

Description:
Builds the complete past-order statistics response for the Taker Opportunities
backtesting summary. It normalizes a missing `now` value to the current time,
turns the excluded payment-method list into a lookup map, then calls
`buildTimeframeStats` for each standard window in `DefaultTimeframes`.

The returned response preserves the fiat currency and excluded methods so the
frontend can label summary cards and distinguish filtered statistics from
all-method statistics.

Called by:
- `handlePastOrderStats` in `dexMonitor/cmd/server/main.go`: after closed offers
  have been loaded, costed, filtered to profitable trades, and converted to
  `PremiumOrder` values.

Calls:
- `buildTimeframeStats`: computes each individual `1h`, `6h`, `24h`, `48h`, and
  `7d` row.

Side effects:
- None. It only transforms in-memory values into a response struct.

Failure behavior:
- There is no error return. Empty input produces empty/zero-valued timeframe
  totals.

Notes:
This function does not decide profitability. It assumes the caller already
removed offers that should not count for the requested taker-opportunity mode.

### `buildTimeframeStats`

Signature:

```go
func buildTimeframeStats(orders []PremiumOrder, now time.Time, tf Timeframe, excluded map[string]struct{}) TimeframeStats
```

Description:
Aggregates profitable closed offers within one reporting window. It computes a
cutoff from `now - tf.Hours`, skips orders whose `LastSeen` falls before that
cutoff, and skips orders whose payment method is excluded.

For remaining orders, it increments the order count, sums net BTC profit, sums
net fiat profit, sums order size, and tracks smallest and biggest BTC order
size. Average order size is derived from the full order-size total divided by
the count.

When at least one order was reduced by the max fiat cap, it also accumulates
capped BTC profit, capped fiat profit, and capped order size. The capped fields
are only populated on the response when a cap actually affected at least one
order in that timeframe.

Called by:
- `BuildStats`: once for every standard timeframe.

Calls:
- `round`: normalizes totals and averages to the precision expected by the API.

Side effects:
- None.

Failure behavior:
- Empty windows return a `TimeframeStats` row with zero totals.
- Capped fields are omitted when no included order has `HasCap = true`.

### `filterGeneralStatsOffers`

Signature:

```go
func filterGeneralStatsOffers(offers []Offer, now time.Time, hours int, excludedPaymentMethods []string) []Offer
```

Description:
Filters normalized offers for general dashboard statistics. It applies the
requested hour window and payment-method exclusions, defaulting an empty `now`
to the current time and a non-positive hour value to 24 hours.

Called by:
- `BuildGeneralStatsOverview`
- `BuildGeneralStatsPremiumSummary`

Side effects:
- None.

### `latestOfferTimeByExchange`

Signature:

```go
func latestOfferTimeByExchange(offers []Offer) map[string]time.Time
```

Description:
Finds the most recent `LastSeen` timestamp for each exchange. General stats use
this to avoid counting stale rows from an exchange when newer rows from the same
exchange exist in the selected window.

Called by:
- `BuildGeneralStatsOverview`
- `BuildGeneralStatsPremiumSummary`

### `isCurrentExchangeOffer`

Signature:

```go
func isCurrentExchangeOffer(offer Offer, lastSeenByExchange map[string]time.Time) bool
```

Description:
Reports whether an offer belongs to the latest observed snapshot for its
exchange. This keeps general live-style summaries focused on the current view of
each exchange rather than every historical row in the window.

Called by:
- `BuildGeneralStatsOverview`
- `BuildGeneralStatsPremiumSummary`

### `BuildGeneralStatsOverview`

Signature:

```go
func BuildGeneralStatsOverview(offers []Offer, now time.Time, hours int, excludedPaymentMethods []string) GeneralStatsOverview
```

Description:
Builds broad dashboard counts from normalized offer data. It filters offers by
time and payment method, keeps only the current snapshot per exchange for active
counts, then returns total offers, active offers, distinct live exchanges,
offers by exchange, and payment-method counts.

Called by:
- `BuildGeneralStats`
- `generalStatsContext.overview` in `dexMonitor/cmd/server/main.go`

Calls:
- `filterGeneralStatsOffers`
- `latestOfferTimeByExchange`
- `isCurrentExchangeOffer`
- `sortedCounts`

### `BuildGeneralStatsPremiumSummary`

Signature:

```go
func BuildGeneralStatsPremiumSummary(offers []Offer, now time.Time, hours int, excludedPaymentMethods []string) GeneralStatsPremiumSummary
```

Description:
Computes ask and bid premium summaries from the current exchange snapshots. It
separates `sell` and `buy` offers, sums their premium percentages, tracks the
best premium in each direction, and returns average and best premium values when
data exists.

Called by:
- `generalStatsContext.premiumSummary` in `dexMonitor/cmd/server/main.go`

Calls:
- `filterGeneralStatsOffers`
- `latestOfferTimeByExchange`
- `isCurrentExchangeOffer`

### `NewGeneralStatsResponse`

Signature:

```go
func NewGeneralStatsResponse(overview GeneralStatsOverview, premiumSummary GeneralStatsPremiumSummary) GeneralStatsResponse
```

Description:
Combines an overview and premium summary into the response shape used by older
or compact general-stats flows.

Called by:
- `BuildGeneralStats`

Side effects:
- None.

### `BuildGeneralStats`

Signature:

```go
func BuildGeneralStats(offers []Offer, now time.Time, hours int, excludedPaymentMethods []string) GeneralStatsResponse
```

Description:
Builds a compact general stats response from normalized offers. It currently
includes the overview and leaves the premium summary empty in this convenience
path.

Called by:
- Tests and any caller that needs the compact legacy general-stats response.

Calls:
- `BuildGeneralStatsOverview`
- `NewGeneralStatsResponse`

### `sortedCounts`

Signature:

```go
func sortedCounts(counts map[string]int) []Count
```

Description:
Converts a count map into a stable list ordered by descending count and then by
name. This keeps dashboard count output deterministic.

Called by:
- `BuildGeneralStatsOverview`

### `round`

Signature:

```go
func round(v float64, places int) float64
```

Description:
Rounds floating-point totals and averages to the requested decimal precision.

Called by:
- `buildTimeframeStats`
