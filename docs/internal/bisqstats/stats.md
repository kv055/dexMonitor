# `internal/bisqstats/stats.go`

Source package: `bisqstats`  
Source lines: `261`

## Package Purpose

This file contributes to the `bisqstats` package.

## File Role

This file defines 7 type(s), implements 7 function or method entry point(s).

## Runtime Behavior

- Reads from or writes to persistent storage.
- Serializes or deserializes JSON payloads.
- Uses time windows, timestamps, or duration calculations.

## Types

### `TradeRecord`

TradeRecord captures the Bisq closed-trade fields needed to calculate
settlement duration.

Fields:

- `TradeID` `string`: TradeID is Bisq's trade identifier.
- `Role` `string`: Role is the local node's role in the trade.
- `PaymentMethodID` `string`: PaymentMethodID identifies the fiat payment rail used by the trade.
- `FiatCurrency` `string`: FiatCurrency is the trade's fiat currency code.
- `TakeOfferAt` `time.Time`: TakeOfferAt records when the offer was taken.
- `SellerConfirmedAt` `time.Time`: SellerConfirmedAt records when the seller confirmed fiat receipt.
- `SettlementDuration` `time.Duration`: SettlementDuration is the elapsed time between taking the offer and seller confirmation.

### `Query`

Query selects the time window and optional grouping filters for Bisq stats.

Fields:

- `Hours` `int`: Hours is the hours value for the query.
- `Days` `int`: Days is the days value for the query.
- `PaymentMethod` `string`: PaymentMethod is the payment method value for the query.
- `Currency` `string`: Currency names the asset or network for the query.

### `Response`

Response represents a response.

Fields:

- `Source` `string`: Source is the source value for the response.
- `Definition` `Definition`: Definition is the definition value for the response.
- `Window` `Window`: Window is the window value for the response.
- `TradesFile` `string`: TradesFile is the trades file value for the response.
- `CompletedTrades` `int`: CompletedTrades is the completed trades value for the response.
- `SkippedTrades` `map[string]int`: SkippedTrades is the skipped trades value for the response.
- `Duration` `DurationSummary`: Duration is the duration value for the response.
- `ByPaymentMethod` `[]GroupedSummary`: ByPaymentMethod is the by payment method value for the response.
- `ByCurrency` `[]GroupedSummary`: ByCurrency names the asset or network for the response.
- `GeneratedAt` `time.Time`: GeneratedAt records the relevant time for the response.

### `Definition`

Definition represents a definition.

Fields:

- `StartField` `string`: StartField is the start field value for the definition.
- `EndField` `string`: EndField is the end field value for the definition.

### `Window`

Window represents a window.

Fields:

- `Hours` `int`: Hours is the hours value for the window.
- `From` `time.Time`: From is the from value for the window.
- `To` `time.Time`: To is the to value for the window.

### `GroupedSummary`

GroupedSummary represents a grouped summary.

Fields:

- `Name` `string`: Name is the name value for the grouped summary.
- `CompletedTrades` `int`: CompletedTrades is the completed trades value for the grouped summary.
- `Duration` `DurationSummary`: Duration is the duration value for the grouped summary.

### `DurationSummary`

DurationSummary represents a duration summary.

Fields:

- `MeanSeconds` `int64`: MeanSeconds is the mean seconds value for the duration summary.
- `MedianSeconds` `int64`: MedianSeconds is the median seconds value for the duration summary.
- `P90Seconds` `int64`: P90Seconds is the p90 seconds value for the duration summary.
- `MinSeconds` `int64`: MinSeconds is the min seconds value for the duration summary.
- `MaxSeconds` `int64`: MaxSeconds is the max seconds value for the duration summary.

## Functions and Methods

### `BuildResponse`

BuildResponse builds a response.

Signature: `func BuildResponse(records []TradeRecord, skipped map[string]int, tradesFile string, q Query, now time.Time) Response`

### `withinWindow`

This function is part of the `bisqstats` package implementation.

Signature: `func withinWindow(ts time.Time, q Query, now time.Time) bool`

### `buildWindow`

This function is part of the `bisqstats` package implementation.

Signature: `func buildWindow(q Query, now time.Time) Window`

### `buildGroupedSummaries`

This function is part of the `bisqstats` package implementation.

Signature: `func buildGroupedSummaries(records []TradeRecord, groupFn func(TradeRecord) string) []GroupedSummary`

### `buildDurationSummary`

This function is part of the `bisqstats` package implementation.

Signature: `func buildDurationSummary(records []TradeRecord) DurationSummary`

### `percentile`

This function is part of the `bisqstats` package implementation.

Signature: `func percentile(sorted []int64, p float64) int64`

### `copySkipped`

This function is part of the `bisqstats` package implementation.

Signature: `func copySkipped(in map[string]int) map[string]int`

## Key Dependencies

- `math`
- `sort`
- `strings`
- `time`

