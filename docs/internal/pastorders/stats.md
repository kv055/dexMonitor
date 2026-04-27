# `internal/pastorders/stats.go`

Source package: `pastorders`  
Source lines: `528`

## Package Purpose

This file contributes to the `pastorders` package.

## File Role

This file defines 17 type(s), implements 11 function or method entry point(s), declares 2 package value(s).

## Runtime Behavior

- Serializes or deserializes JSON payloads.
- Uses time windows, timestamps, or duration calculations.

## Types

### `Timeframe`

Timeframe represents a timeframe.

Fields:

- `Label` `string`: Label is the label value for the timeframe.
- `Hours` `int`: Hours is the hours value for the timeframe.

### `PremiumOrder`

PremiumOrder represents a premium order.

Fields:

- `PaymentMethod` `string`: PaymentMethod is the payment method value for the premium order.
- `LastSeen` `time.Time`: LastSeen is the last seen value for the premium order.
- `BTCAmount` `float64`: BTCAmount is a BTC-denominated btcamount value.
- `NetProfitBTC` `float64`: NetProfitBTC is a BTC-denominated net profit btc value.
- `NetProfitFiat` `float64`: NetProfitFiat is a fiat-denominated net profit fiat value.
- `BTCAmountCapped` `float64`: BTCAmountCapped is set when the order exceeded a max fiat limit.
- `NetProfitBTCCapped` `float64`: NetProfitBTCCapped is a BTC-denominated net profit btccapped value.
- `NetProfitFiatCapped` `float64`: NetProfitFiatCapped is a fiat-denominated net profit fiat capped value.
- `HasCap` `bool`: HasCap reports whether the premium order condition is true.

### `StatsResponse`

StatsResponse represents a stats response.

Fields:

- `FiatCurrency` `string`: FiatCurrency is a fiat-denominated fiat currency value.
- `ExcludedPaymentMethods` `[]string`: ExcludedPaymentMethods is the excluded payment methods value for the stats response.
- `Timeframes` `[]TimeframeStats`: Timeframes records the relevant time for the stats response.

### `TimeframeStats`

TimeframeStats represents a timeframe stats.

Fields:

- `Timeframe` `string`: Timeframe records the relevant time for the timeframe stats.
- `Hours` `int`: Hours is the hours value for the timeframe stats.
- `PremiumOrderCount` `int`: PremiumOrderCount is the count associated with the timeframe stats.
- `TotalProfitBTC` `float64`: TotalProfitBTC is a BTC-denominated total profit btc value.
- `TotalProfitFiat` `float64`: TotalProfitFiat is a fiat-denominated total profit fiat value.
- `AverageOrderBTC` `float64`: AverageOrderBTC is a BTC-denominated average order btc value.
- `SmallestOrderBTC` `float64`: SmallestOrderBTC is a BTC-denominated smallest order btc value.
- `BiggestOrderBTC` `float64`: BiggestOrderBTC is a BTC-denominated biggest order btc value.
- `TotalProfitBTCCapped` `*float64`: TotalProfitBTCCapped is set when at least one order in the window was capped by a max fiat limit.
- `TotalProfitFiatCapped` `*float64`: TotalProfitFiatCapped is a fiat-denominated total profit fiat capped value.
- `AverageOrderBTCCapped` `*float64`: AverageOrderBTCCapped is a BTC-denominated average order btccapped value.

### `Offer`

Offer is a normalized DEX offer used by this package.

Fields:

- `Exchange` `string`: Exchange is the exchange value for the offer.
- `Direction` `string`: Direction is the direction value for the offer.
- `PaymentMethod` `string`: PaymentMethod is the payment method value for the offer.
- `PriceDiffPercent` `*float64`: PriceDiffPercent is a percentage value.
- `FirstSeen` `time.Time`: FirstSeen is the first seen value for the offer.
- `LastSeen` `time.Time`: LastSeen is the last seen value for the offer.
- `IsLive` `bool`: IsLive reports whether the offer condition is true.

### `GeneralStatsOverview`

GeneralStatsOverview represents a general stats overview.

Fields:

- `TotalOffers` `int`: TotalOffers is the total offers value for the general stats overview.
- `ActiveOffers` `int`: ActiveOffers is the active offers value for the general stats overview.
- `ExchangesLive` `int`: ExchangesLive is the exchanges live value for the general stats overview.
- `OffersByExchange` `[]Count`: OffersByExchange is the offers by exchange value for the general stats overview.
- `PaymentMethodCounts` `[]Count`: PaymentMethodCounts is the count associated with the general stats overview.

### `GeneralStatsPremiumSummary`

GeneralStatsPremiumSummary represents a general stats premium summary.

Fields:

- `BestAskPremiumPct` `*float64`: BestAskPremiumPct is a percentage value.
- `AvgAskPremiumPct` `*float64`: AvgAskPremiumPct is a percentage value.
- `BestBidPremiumPct` `*float64`: BestBidPremiumPct is a percentage value.
- `AvgBidPremiumPct` `*float64`: AvgBidPremiumPct is a percentage value.

### `GeneralStatsResponse`

GeneralStatsResponse represents a general stats response.

Fields:

- `TotalOffers` `int`: TotalOffers is the total offers value for the general stats response.
- `ActiveOffers` `int`: ActiveOffers is the active offers value for the general stats response.
- `ExchangesLive` `int`: ExchangesLive is the exchanges live value for the general stats response.
- `OffersByExchange` `[]Count`: OffersByExchange is the offers by exchange value for the general stats response.
- `BestAskPremiumPct` `*float64`: BestAskPremiumPct is a percentage value.
- `AvgAskPremiumPct` `*float64`: AvgAskPremiumPct is a percentage value.
- `BestBidPremiumPct` `*float64`: BestBidPremiumPct is a percentage value.
- `AvgBidPremiumPct` `*float64`: AvgBidPremiumPct is a percentage value.
- `OpenPremiums` `OpenPremiumStats`: OpenPremiums is the open premiums value for the general stats response.
- `AvgOfferLifetimeMs` `*int64`: AvgOfferLifetimeMs records the relevant time for the general stats response.
- `AvgOfferLifetimeMsByExchange` `[]NamedDuration`: AvgOfferLifetimeMsByExchange records the relevant time for the general stats response.
- `PremiumLifetimes` `PremiumLifetimeModes`: PremiumLifetimes records the relevant time for the general stats response.
- `PaymentMethodCounts` `[]Count`: PaymentMethodCounts is the count associated with the general stats response.
- `PastPremiums` `[]PastPremiumTimeframeStats`: PastPremiums is the past premiums value for the general stats response.

### `OpenPremiumModeStats`

OpenPremiumModeStats summarizes live premiums for one pricing mode.

Fields:

- `AvgAskPremiumPct` `*float64`: AvgAskPremiumPct is a percentage value.
- `AvgBidPremiumPct` `*float64`: AvgBidPremiumPct is a percentage value.

### `OpenPremiumStats`

OpenPremiumStats groups live premium summaries by pricing mode.

Fields:

- `Raw` `OpenPremiumModeStats`: Raw preserves additional source data for the open premium stats.
- `NetFull` `OpenPremiumModeStats`: NetFull is the net full value for the open premium stats.
- `NetCapped` `OpenPremiumModeStats`: NetCapped is the net capped value for the open premium stats.

### `PremiumLifetimeStats`

PremiumLifetimeStats represents a premium lifetime stats.

Fields:

- `AvgOfferLifetimeMs` `*int64`: AvgOfferLifetimeMs records the relevant time for the premium lifetime stats.
- `AvgOfferLifetimeMsByExchange` `[]NamedDuration`: AvgOfferLifetimeMsByExchange records the relevant time for the premium lifetime stats.

### `PremiumLifetimeModes`

PremiumLifetimeModes represents a premium lifetime modes.

Fields:

- `Raw` `PremiumLifetimeStats`: Raw preserves additional source data for the premium lifetime modes.
- `NetFull` `PremiumLifetimeStats`: NetFull is the net full value for the premium lifetime modes.
- `NetCapped` `PremiumLifetimeStats`: NetCapped is the net capped value for the premium lifetime modes.

### `NamedDuration`

NamedDuration represents a named duration.

Fields:

- `Name` `string`: Name is the name value for the named duration.
- `Ms` `int64`: Ms is the ms value for the named duration.

### `NamedPremium`

NamedPremium represents a named premium.

Fields:

- `Name` `string`: Name is the name value for the named premium.
- `AvgPremiumPct` `float64`: AvgPremiumPct is a percentage value.

### `PastPremiumTimeframeStats`

PastPremiumTimeframeStats represents a past premium timeframe stats.

Fields:

- `Timeframe` `string`: Timeframe records the relevant time for the past premium timeframe stats.
- `Hours` `int`: Hours is the hours value for the past premium timeframe stats.
- `AvgPremiumByExchange` `[]NamedPremium`: AvgPremiumByExchange is the avg premium by exchange value for the past premium timeframe stats.
- `Modes` `PastPremiumModes`: Modes is the modes value for the past premium timeframe stats.

### `PastPremiumModes`

PastPremiumModes represents a past premium modes.

Fields:

- `Raw` `[]NamedPremium`: Raw preserves additional source data for the past premium modes.
- `NetFull` `[]NamedPremium`: NetFull is the net full value for the past premium modes.
- `NetCapped` `[]NamedPremium`: NetCapped is the net capped value for the past premium modes.

### `Count`

Count represents a count.

Fields:

- `Name` `string`: Name is the name value for the count.
- `Count` `int`: Count is the count associated with the count.

## Functions and Methods

### `BuildStats`

BuildStats builds a stats.

Signature: `func BuildStats(orders []PremiumOrder, now time.Time, fiatCurrency string, excludedPaymentMethods []string) StatsResponse`

### `filterGeneralStatsOffers`

This function is part of the `pastorders` package implementation.

Signature: `func filterGeneralStatsOffers(offers []Offer, now time.Time, hours int, excludedPaymentMethods []string) []Offer`

### `latestOfferTimeByExchange`

This function is part of the `pastorders` package implementation.

Signature: `func latestOfferTimeByExchange(offers []Offer) map[string]time.Time`

### `isCurrentExchangeOffer`

This function is part of the `pastorders` package implementation.

Signature: `func isCurrentExchangeOffer(offer Offer, lastSeenByExchange map[string]time.Time) bool`

### `BuildGeneralStatsOverview`

BuildGeneralStatsOverview builds a general stats overview.

Signature: `func BuildGeneralStatsOverview(offers []Offer, now time.Time, hours int, excludedPaymentMethods []string) GeneralStatsOverview`

### `BuildGeneralStatsPremiumSummary`

BuildGeneralStatsPremiumSummary builds a general stats premium summary.

Signature: `func BuildGeneralStatsPremiumSummary(offers []Offer, now time.Time, hours int, excludedPaymentMethods []string) GeneralStatsPremiumSummary`

### `NewGeneralStatsResponse`

NewGeneralStatsResponse creates a general stats response.

Signature: `func NewGeneralStatsResponse(overview GeneralStatsOverview, premiumSummary GeneralStatsPremiumSummary) GeneralStatsResponse`

### `BuildGeneralStats`

BuildGeneralStats builds a general stats.

Signature: `func BuildGeneralStats(offers []Offer, now time.Time, hours int, excludedPaymentMethods []string) GeneralStatsResponse`

### `buildTimeframeStats`

TODO: write comments and document this function in a new readme file

Signature: `func buildTimeframeStats(orders []PremiumOrder, now time.Time, tf Timeframe, excluded map[string]struct{}) TimeframeStats`

### `sortedCounts`

This function is part of the `pastorders` package implementation.

Signature: `func sortedCounts(counts map[string]int) []Count`

### `round`

This function is part of the `pastorders` package implementation.

Signature: `func round(v float64, places int) float64`

## Constants and Variables

- `DefaultTimeframes`: DefaultTimeframes lists the standard reporting windows.
- `PastPremiumTimeframes`: PastPremiumTimeframes is the past premium timeframes value.

## Key Dependencies

- `math`
- `sort`
- `time`

