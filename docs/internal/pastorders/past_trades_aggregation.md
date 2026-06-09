# Past Trades Aggregation

## Purpose

Past Trades aggregation documents the closed-offer profitability path behind
the Taker Opportunities backtesting view. The feature has two backend stages:

1. `dexUnifiedApi` analyzes closed offers from their `order_lifecycle`
   snapshots and writes historical profitability averages back to `offers`.
2. `dexMonitor` loads those closed offers, filters profitable trades, groups
   them into time windows, and serves the result to the frontend.

This workspace does not contain a `dexInsights` frontend. The current UI that
uses this data is `dexMonitor/react-frontend/src/components/TakerOpportunities.tsx`.

## Runtime Role

The historical pass starts after offers have been observed over time. Live
snapshots persist lifecycle samples into `order_lifecycle`; once an offer is no
longer live, `dexUnifiedApi/cmd/snapshot/closed_offer_analysis.go` computes
historical averages and stores them on the closed `offers` row.

The monitor backend then exposes two API views over the same closed-offer
history:

- `/api/past_order_stats`: aggregate totals by timeframe for backtesting cards.
- `/api/past_profitable_orders`: detailed rows for each profitable closed trade.

The frontend fetches both endpoints in `useDashboard.ts` for `net_full` and
`net_capped` modes, then renders the summary and details in
`TakerOpportunities.tsx`.

## Main Flow

### 1. Closed Offer Historical Analysis

`analyzeClosedOffers` in
`dexUnifiedApi/cmd/snapshot/closed_offer_analysis.go` selects closed offers that
have not yet been analyzed and whose `last_seen` is older than
`CLOSED_OFFER_ANALYSIS_GRACE_CYCLES × SNAPSHOT_INTERVAL_MIN` (defaults: 3
cycles × 1 minute). It retries offers previously marked `ignored_no_lifecycle`
if lifecycle rows have since arrived.

If a closed offer reappears before the grace window elapses, it is never
analyzed. If it returns after analysis, the snapshot bulk `is_live` update clears
closure fields on relive.

For each selected offer, `analyzeSingleClosedOffer` runs one SQL aggregate over
`order_lifecycle`:

- It averages `ref_price`, `premium_pct`, and `btc_amount` across all lifecycle
  rows.
- It separately averages only profitable lifecycle rows where
  `net_premium_pct > 0`.
- Profitable-only averages include premium, trade cost percent, trade cost BTC,
  net premium percent, net premium BTC, and BTC amount.
- Fiat profit is computed as profitable average net premium BTC multiplied by
  the average reference price.

The result is stored on `offers` as historical fields such as
`avg_trade_cost_pct`, `avg_trade_cost_btc`, `avg_net_premium_pct`,
`avg_estimated_profit_btc`, `avg_estimated_profit_fiat`, and `avg_btc_amount`.
Route and hedge fields already maintained on `offers` are copied forward so
the monitor can explain the cost path behind the historical profit.

Offers with no lifecycle rows are marked `ignored_no_lifecycle`. Offers with
lifecycle rows but no profitable samples are marked `non_premium`. Offers whose
overall average premium is below the cleanup threshold are deleted as
non-premium noise.

### 2. Monitor Backend Reshaping

`dexMonitor/cmd/server/main.go` registers the endpoints:

- `GET /api/past_order_stats`
- `GET /api/past_profitable_orders`

Both handlers load closed offers from the last seven days with
`historical_analysis_status = 'analyzed'`. Only offers that completed snapshot
historical analysis and were marked profitable enter the taker-opportunity
pipeline. Profitability is computed through `addPastOfferCostFieldsFull`, which
derives the offer premium, selects a BTC trade size, uses stored historical
averages when available, and builds full-volume and optionally capped results.

`profitableInMode` decides whether a closed offer counts for a request. It uses
the selected mode and requires the selected profit to be greater than zero.

`fetchPastOfferLifecycleAggregates` loads per-offer lifecycle aggregates through
`lifecycle.Repository.LoadPastAggregates`. Those aggregates provide historical
averages such as average trade cost, average net percent, average BTC profit,
average fiat profit, and average BTC amount. The detailed endpoint uses this
data to enrich each profitable order row.

### 3. Timeframe Summary Endpoint

`handlePastOrderStats` builds the summary response for
`/api/past_order_stats`.

It:

- Reads query options such as excluded payment methods, excluded CEXes,
  confirmation count, fee tier, max fiat limit, premium mode, and fiat label.
- Loads closed offers whose `last_seen` is within the last seven days and
  `historical_analysis_status` is `analyzed`.
- Calls `addPastOfferCostFieldsFull` for each offer.
- Keeps only offers where `profitableInMode` is true.
- Converts each included offer into `pastorders.PremiumOrder`.
- Calls `pastorders.BuildStats`.

`BuildStats` creates one row for each default timeframe: `1h`, `6h`, `24h`,
`48h`, and `7d`. `buildTimeframeStats` then sums the profitable order count,
net BTC profit, net fiat profit, average order size, smallest order size, and
biggest order size for each window. When the request uses a max fiat cap and at
least one order is reduced by it, capped profit and capped average-size fields
are included.

### 4. Detailed Profitable Trades Endpoint

`handlePastProfitableOrders` builds the detailed list for
`/api/past_profitable_orders`.

It:

- Loads the same analyzed closed-offer set as `handlePastOrderStats`.
- Applies payment-method exclusions before lifecycle aggregation.
- Loads lifecycle aggregates for the remaining closed offer IDs.
- Recomputes the requested profitability mode.
- Keeps only profitable offers.
- Converts each kept offer with `buildPastProfitableOrderAPI`.

`buildPastProfitableOrderAPI` combines the compact past-offer representation,
the selected-mode profit summary, average historical analysis, route metadata,
and cost breakdown. The result gives the frontend enough information to show
both the table row and the expanded detail panel.

### 5. Frontend Consumption

`dexMonitor/react-frontend/src/hooks/useDashboard.ts` fetches both endpoints in
parallel during the analytics load:

- `/api/past_order_stats` with `premium_mode=net_full`
- `/api/past_order_stats` with `premium_mode=net_capped`
- `/api/past_profitable_orders` with `premium_mode=net_full`
- `/api/past_profitable_orders` with `premium_mode=net_capped`

When payment-method exclusions are active, it also fetches filtered and
all-method variants so the UI can toggle between selected methods and all
methods.

`dexMonitor/react-frontend/src/components/TakerOpportunities.tsx` renders the
data. The left panel shows timeframe controls, premium mode controls, and
summary cards for order count, net BTC, net fiat, average size, smallest size,
and biggest size. The right panel lists profitable closed trades and expands
each row to show average net percent, average trade cost percent, route,
capped/full-volume values, and raw offer payload fields.

## Function Map

### `analyzeSingleClosedOffer`

Signature:

```go
func analyzeSingleClosedOffer(sdb closedOfferDB, offer closedOfferRecord) (string, bool)
```

Description:
Aggregates historical lifecycle samples for one closed offer and stores the
result on `offers`. It is the backend source of the `avg_*` profitability fields
later consumed by `dexMonitor`.

Called by:
- `analyzeClosedOffers` in `dexUnifiedApi/cmd/snapshot/closed_offer_analysis.go`.

### `fetchPastOfferLifecycleAggregates`

Signature:

```go
func fetchPastOfferLifecycleAggregates(ids []int64) map[int64]pastLifecycleAggregate
```

Description:
Loads per-offer historical lifecycle aggregates for closed offers. It delegates
to `lifecycle.Repository.LoadPastAggregates` and converts repository values into
the server-local alias used by past-offer API builders.

Called by:
- `handlePastProfitableOrders`: enriches detailed profitable trade rows.
- General-stats handlers in `dexMonitor/cmd/server/main.go`: reuse lifecycle
  averages for other historical premium views.

### `addPastOfferCostFieldsFull`

Signature:

```go
func addPastOfferCostFieldsFull(o map[string]any, requiredConfirmations int, excludedCEXes []string, feeTier string, maxFiatLimitEUR float64) pastOfferAnalysis
```

Description:
Derives the profit fields used for taker-opportunity filtering. It computes the
raw directional premium, chooses a BTC trade size, prefers stored historical
averages when available, stores `trade_cost_percent`, `net_premium_percent`,
and `cost_breakdown` back on the offer map, and optionally computes a capped
profit scenario when `maxFiatLimitEUR` reduces the trade size.

Called by:
- `handlePastOrderStats`
- `handlePastProfitableOrders`
- `buildPastProfitableOrderAPI`
- Past-offer API builders in `dexMonitor/cmd/server/main.go`

### `profitableInMode`

Signature:

```go
func (a pastOfferAnalysis) profitableInMode(mode takerOpportunityMode) bool
```

Description:
Selects either full-volume or capped-volume values for the requested mode and
returns true only when the selected BTC profit is greater than zero.

Called by:
- `handlePastOrderStats`
- `handlePastProfitableOrders`

### `handlePastOrderStats`

Signature:

```go
func handlePastOrderStats(w http.ResponseWriter, r *http.Request)
```

Description:
Serves `/api/past_order_stats`. It loads recent analyzed closed offers, computes
profitability for the requested mode, filters to profitable trades, converts
them into `pastorders.PremiumOrder`, and returns timeframe totals from
`pastorders.BuildStats`.

### `BuildStats`

Signature:

```go
func BuildStats(orders []PremiumOrder, now time.Time, fiatCurrency string, excludedPaymentMethods []string) StatsResponse
```

Description:
Builds the timeframe response consumed by the Taker Opportunities summary cards.

Called by:
- `handlePastOrderStats`

### `buildTimeframeStats`

Signature:

```go
func buildTimeframeStats(orders []PremiumOrder, now time.Time, tf Timeframe, excluded map[string]struct{}) TimeframeStats
```

Description:
Aggregates the profitable closed orders that fall inside one timeframe.

Called by:
- `BuildStats`

### `handlePastProfitableOrders`

Signature:

```go
func handlePastProfitableOrders(w http.ResponseWriter, r *http.Request)
```

Description:
Serves `/api/past_profitable_orders`. It loads recent analyzed closed offers,
applies payment-method exclusions, fetches lifecycle aggregates, filters
profitable offers for the selected mode, and returns detailed rows.

### `buildPastProfitableOrderAPI`

Signature:

```go
func buildPastProfitableOrderAPI(o map[string]any, agg pastLifecycleAggregate, requiredConfirmations int, excludedCEXes []string, feeTier string, maxFiatLimitEUR float64, mode takerOpportunityMode) pastProfitableOrderAPI
```

Description:
Builds one detailed profitable-trade row by combining status, pricing, selected
profit summary, full/capped analysis, route and cost breakdown, and table-ready
offer fields.

Called by:
- `handlePastProfitableOrders`

## Operational Notes

- The monitor endpoints currently look back seven days from request time and
  only include offers with `historical_analysis_status = 'analyzed'`.
- Profitability is selected by `premium_mode`; supported modes are `net_full`
  and `net_capped`.
- `net_capped` only differs from `net_full` when a positive max fiat limit is
  configured and the offer size exceeds that cap.
- Historical averages are stored on `offers`, but detailed lifecycle aggregates
  can still be loaded from `order_lifecycle` for richer API responses.
- Closed offers with no lifecycle rows are intentionally ignored until lifecycle
  data exists, then retried by the snapshot analyzer.
