# `internal/pastorders`

## Purpose

The `pastorders` package turns closed-offer analysis into compact statistics for
dashboard views. It does not read the database itself; callers pass in already
filtered offers or profitable closed orders, and the package groups them into
the time windows expected by the monitor API.

## Main Flows

- [Past Trades aggregation](past_trades_aggregation.md) explains the full flow
  from `dexUnifiedApi` historical analysis to the monitor backend and
  Taker Opportunities frontend.
- [stats.go](stats.md) documents the package functions that build timeframe
  responses from profitable closed offers and summarize broader premium stats.

## Entry Points

- `BuildStats` builds the `/api/past_order_stats` response from profitable
  closed offers supplied by `dexMonitor/cmd/server`.
- `BuildGeneralStatsOverview`, `BuildGeneralStatsPremiumSummary`, and
  `BuildGeneralStats` build broader dashboard summaries from normalized offer
  data.

## Operational Notes

`BuildStats` expects callers to apply the profitability policy first. In the
current monitor server, taker-opportunity handlers load only analyzed closed
offers (`historical_analysis_status = 'analyzed'`) from the last seven days,
then apply `addPastOfferCostFieldsFull` and `profitableInMode`; this package
receives only the closed offers that should be counted.

Payment-method exclusions are applied inside the timeframe builders so the API
can return statistics for the same closed-offer set with or without locally
enabled payment-method filters.
