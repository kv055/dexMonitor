# `cmd/server/main.go`

Source package: `main`  
Source lines: `2722`

## Package Purpose

This file contributes to the `main` package.

## File Role

This file defines 32 type(s), implements 106 function or method entry point(s), declares 21 package value(s).

## Runtime Behavior

- Handles HTTP request or response flow.
- Reads from or writes to persistent storage.
- Serializes or deserializes JSON payloads.
- Uses time windows, timestamps, or duration calculations.
- Accepts context for cancellation, deadlines, or request scoping.

## Types

### `pastProfitableOrderSummary`

Fields:

- `NetProfitBTC` `float64`: Stores a Bitcoin-denominated amount or limit for the past profitable order summary.
- `NetProfitFiat` `float64`: Stores fiat currency data for the past profitable order summary.
- `TradeSizeBTC` `float64`: Stores a Bitcoin-denominated amount or limit for the past profitable order summary.
- `TradeSizeFiat` `float64`: Stores fiat currency data for the past profitable order summary.
- `NetPercent` `float64`: Stores a percentage or premium metric for the past profitable order summary.
- `CapFiat` `*float64`: Stores fiat currency data for the past profitable order summary.

### `pastProfitableOrderAPI`

Fields:

- `ID` `int64`: Identifies the past profitable order a p i.
- `Exchange` `string`: Stores the exchange value for the past profitable order a p i.
- `OfferID` `*string`: Stores the offer i d value for the past profitable order a p i.
- `PaymentMethod` `*string`: Stores the payment method value for the past profitable order a p i.
- `Direction` `string`: Stores the direction value for the past profitable order a p i.
- `Status` `pastOfferStatus`: Stores the current status for the past profitable order a p i.
- `Pricing` `pastOfferPricing`: Stores the pricing value for the past profitable order a p i.
- `Summary` `pastProfitableOrderSummary`: Stores the summary value for the past profitable order a p i.
- `Analysis` `pastOfferAnalysisAPI`: Stores the analysis value for the past profitable order a p i.
- `Offer` `map[string]any`: Stores the offer value for the past profitable order a p i.

### `generalStatsContext`

Fields:

- `hours` `int`: Stores the hours value for the general stats context.
- `excludedPaymentMethods` `[]string`: Stores the excluded payment methods value for the general stats context.
- `sub` `liveSubscription`: Stores the sub value for the general stats context.
- `offers` `[]map[string]any`: Stores the offers value for the general stats context.
- `generalOffers` `[]pastorders.Offer`: Stores the general offers value for the general stats context.
- `closedOfferIDs` `[]int64`: Stores the closed offer i ds value for the general stats context.
- `now` `time.Time`: Stores the now value for the general stats context.

### `pastOfferAnalysis`

Fields:

- `hasPositiveRawSpread` `bool`: Reports a boolean condition for the past offer analysis.
- `btcSize` `float64`: Stores a Bitcoin-denominated amount or limit for the past offer analysis.
- `refPrice` `float64`: Stores the price-related value for the past offer analysis.
- `estimatedProfitBTC` `float64`: Stores a Bitcoin-denominated amount or limit for the past offer analysis.
- `btcSizeCapped` `float64`: optional capped results (set when maxFiatLimitEUR > 0 and btcSize exceeds cap)
- `estimatedProfitBTCCapped` `float64`: Stores a Bitcoin-denominated amount or limit for the past offer analysis.
- `hasCap` `bool`: Reports a boolean condition for the past offer analysis.

### `takerOpportunityMode`

Definition: `string`

### `pastOfferDuration`

Fields:

- `Hours` `int`: Stores the hours value for the past offer duration.
- `Minutes` `int`: Stores the minutes value for the past offer duration.
- `Display` `string`: Stores the display value for the past offer duration.

### `pastOfferStatus`

Fields:

- `IsLive` `bool`: Reports a boolean condition for the past offer status.
- `FirstSeen` `string`: Stores timing information for the past offer status.
- `LastSeen` `string`: Stores timing information for the past offer status.
- `Duration` `pastOfferDuration`: Stores the duration value for the past offer status.

### `pastOfferPricing`

Fields:

- `PriceType` `string`: Stores the price-related value for the past offer pricing.
- `FiatCurrency` `string`: Stores fiat currency data for the past offer pricing.
- `AvgOfferPrice` `float64`: Stores the price-related value for the past offer pricing.
- `AvgRefPrice` `float64`: Stores the price-related value for the past offer pricing.
- `AvgPremiumPercent` `float64`: Stores a percentage or premium metric for the past offer pricing.

### `pastOfferVolumeLimits`

Fields:

- `BTCMin` `*float64`: Stores a Bitcoin-denominated amount or limit for the past offer volume limits.
- `BTCMax` `*float64`: Stores a Bitcoin-denominated amount or limit for the past offer volume limits.
- `FiatMin` `*int64`: Stores fiat currency data for the past offer volume limits.
- `FiatMax` `*int64`: Stores fiat currency data for the past offer volume limits.

### `pastOfferBTCNetworkFee`

Fields:

- `BTC` `float64`: Stores a Bitcoin-denominated amount or limit for the past offer b t c network fee.
- `Method` `string`: Stores the method value for the past offer b t c network fee.
- `Tier` `string`: Stores the tier value for the past offer b t c network fee.
- `Confidence` `float64`: Stores the confidence value for the past offer b t c network fee.
- `NumTxs` `int`: Stores the num txs value for the past offer b t c network fee.
- `RequiredConfirmations` `int`: Stores the required confirmations value for the past offer b t c network fee.
- `EstimatedArrivalMinutes` `int`: Stores the estimated arrival minutes value for the past offer b t c network fee.
- `Detail` `*tradecost.BTCNetworkFeeDetail`: Stores the detail value for the past offer b t c network fee.

### `pastOfferRoute`

Fields:

- `CEX` `string`: Stores the c e x value for the past offer route.
- `Settlement` `string`: Stores the settlement value for the past offer route.

### `pastOfferPremium`

Fields:

- `AvgTradeCostPercent` `float64`: Stores a percentage or premium metric for the past offer premium.
- `AvgNetPercent` `float64`: Stores a percentage or premium metric for the past offer premium.

### `pastOfferProfit`

Fields:

- `AvgBTC` `float64`: Stores a Bitcoin-denominated amount or limit for the past offer profit.
- `AvgFiat` `float64`: Stores fiat currency data for the past offer profit.

### `pastOfferCostValue`

Fields:

- `Pct` `float64`: Stores a percentage or premium metric for the past offer cost value.
- `BTC` `float64`: Stores a Bitcoin-denominated amount or limit for the past offer cost value.
- `AvgPct` `float64`: Stores a percentage or premium metric for the past offer cost value.
- `AvgBTC` `float64`: Stores a Bitcoin-denominated amount or limit for the past offer cost value.

### `pastOfferHedgeCosts`

Fields:

- `OpenFeePct` `float64`: Stores a percentage or premium metric for the past offer hedge costs.
- `OpenFeeBTC` `float64`: Stores a Bitcoin-denominated amount or limit for the past offer hedge costs.
- `CloseFeePct` `float64`: Stores a percentage or premium metric for the past offer hedge costs.
- `CloseFeeBTC` `float64`: Stores a Bitcoin-denominated amount or limit for the past offer hedge costs.
- `FundingFeePct` `float64`: Stores a percentage or premium metric for the past offer hedge costs.
- `FundingFeeBTC` `float64`: Stores a Bitcoin-denominated amount or limit for the past offer hedge costs.
- `FeeSumPct` `float64`: Stores a percentage or premium metric for the past offer hedge costs.
- `FeeSumBTC` `float64`: Stores a Bitcoin-denominated amount or limit for the past offer hedge costs.
- `Venue` `string`: Stores the venue value for the past offer hedge costs.
- `Instrument` `string`: Stores the instrument value for the past offer hedge costs.
- `TransferMinutes` `int`: Stores the transfer minutes value for the past offer hedge costs.
- `Position` `*tradecost.HedgePositionDetail`: Stores the position value for the past offer hedge costs.

### `pastOfferScenarioCosts`

Fields:

- `CexTaker` `pastOfferCostValue`: Stores the cex taker value for the past offer scenario costs.
- `Withdrawal` `pastOfferCostValue`: Stores the withdrawal value for the past offer scenario costs.
- `DexFee` `pastOfferCostValue`: Stores the dex fee value for the past offer scenario costs.
- `Network` `pastOfferCostValue`: Stores the network value for the past offer scenario costs.
- `Hedge` `pastOfferHedgeCosts`: Stores the hedge value for the past offer scenario costs.
- `Total` `pastOfferCostValue`: Stores the total value for the past offer scenario costs.

### `pastOfferScenario`

Fields:

- `CapFiat` `*float64`: Stores fiat currency data for the past offer scenario.
- `CostPolicy` `string`: Stores the cost policy value for the past offer scenario.
- `Assumptions` `[]string`: Stores the assumptions value for the past offer scenario.
- `TradeSizeBTC` `float64`: Stores a Bitcoin-denominated amount or limit for the past offer scenario.
- `TradeSizeFiat` `float64`: Stores fiat currency data for the past offer scenario.
- `Route` `pastOfferRoute`: Stores the route value for the past offer scenario.
- `Premium` `pastOfferPremium`: Stores a percentage or premium metric for the past offer scenario.
- `Profit` `pastOfferProfit`: Stores the profit value for the past offer scenario.
- `Costs` `pastOfferScenarioCosts`: Stores the costs value for the past offer scenario.

### `pastOfferAnalysisAPI`

Fields:

- `FullVolume` `pastOfferScenario`: Stores the full volume value for the past offer analysis a p i.
- `CappedVolume` `*pastOfferScenario`: Stores the capped volume value for the past offer analysis a p i.

### `pastOfferAPI`

Fields:

- `ID` `int64`: Identifies the past offer a p i.
- `Exchange` `string`: Stores the exchange value for the past offer a p i.
- `OfferID` `*string`: Stores the offer i d value for the past offer a p i.
- `PaymentMethod` `*string`: Stores the payment method value for the past offer a p i.
- `Direction` `string`: Stores the direction value for the past offer a p i.
- `Status` `pastOfferStatus`: Stores the current status for the past offer a p i.
- `Pricing` `pastOfferPricing`: Stores the pricing value for the past offer a p i.
- `VolumeLimits` `pastOfferVolumeLimits`: Stores the volume limits value for the past offer a p i.
- `BTCNetworkFee` `pastOfferBTCNetworkFee`: Stores a Bitcoin-denominated amount or limit for the past offer a p i.
- `Analysis` `pastOfferAnalysisAPI`: Stores the analysis value for the past offer a p i.

### `pastOfferCompactAPI`

Fields:

- `ID` `int64`: Identifies the past offer compact a p i.
- `Exchange` `string`: Stores the exchange value for the past offer compact a p i.
- `OfferID` `*string`: Stores the offer i d value for the past offer compact a p i.
- `PaymentMethod` `*string`: Stores the payment method value for the past offer compact a p i.
- `Direction` `string`: Stores the direction value for the past offer compact a p i.
- `Status` `pastOfferStatus`: Stores the current status for the past offer compact a p i.
- `Pricing` `pastOfferPricing`: Stores the pricing value for the past offer compact a p i.
- `VolumeLimits` `pastOfferVolumeLimits`: Stores the volume limits value for the past offer compact a p i.

### `pastLifecycleSample`

Definition: `lifecycle.PastSample`

### `pastLifecycleAggregate`

Definition: `lifecycle.PastAggregate`

### `tradingAccount`

Definition: `tradingaccounts.Account`

### `tradingTOTPSecret`

Definition: `tradingaccounts.TOTPSecret`

### `tradingPasskey`

Definition: `tradingaccounts.Passkey`

### `tradingSeed`

Definition: `tradingaccounts.Seed`

### `tradingAPIKey`

Definition: `tradingaccounts.APIKey`

### `tradingAccountPayload`

Definition: `tradingaccounts.AccountPayload`

### `tradingTOTPSecretPayload`

Definition: `tradingaccounts.TOTPSecretPayload`

### `tradingPasskeyPayload`

Definition: `tradingaccounts.PasskeyPayload`

### `tradingSeedPayload`

Definition: `tradingaccounts.SeedPayload`

### `tradingAPIKeyPayload`

Definition: `tradingaccounts.APIKeyPayload`

## Functions and Methods

### `coreTablesReady`

This function is part of the `main` package implementation.

Signature: `func coreTablesReady() bool`

### `getCexPrice`

This function is part of the `main` package implementation.

Signature: `func getCexPrice(cex string) float64`

### `setCexPrice`

This function is part of the `main` package implementation.

Signature: `func setCexPrice(cex string, p float64)`

### `init`

This function is part of the `main` package implementation.

Signature: `func init()`

### `main`

This function is part of the `main` package implementation.

Signature: `func main()`

### `corsMiddleware`

This function is part of the `main` package implementation.

Signature: `func corsMiddleware(next http.Handler) http.Handler`

### `serveFrontend`

This function is part of the `main` package implementation.

Signature: `func serveFrontend(w http.ResponseWriter, r *http.Request)`

### `handleOffers`

This function is part of the `main` package implementation.

Signature: `func handleOffers(w http.ResponseWriter, r *http.Request)`

### `handleLiveOffersREST`

handleLiveOffersREST is the REST fallback for /ws/live_offers.

Signature: `func handleLiveOffersREST(w http.ResponseWriter, r *http.Request)`

### `handlePastOffers`

handlePastOffers serves closed offers (is_live=0) from the DB.
Costing uses the cheapest available CEX→DEX route for each premium offer.

Signature: `func handlePastOffers(w http.ResponseWriter, r *http.Request)`

### `handlePastOfferLifecycle`

This function is part of the `main` package implementation.

Signature: `func handlePastOfferLifecycle(w http.ResponseWriter, r *http.Request)`

### `fetchOfferLifecycle`

fetchOfferLifecycle returns lifecycle (snapshot_time, price) points grouped by offer_db_id.

Signature: `func fetchOfferLifecycle(ids []int64) map[int64][]LifecyclePoint`

### `fetchPastOfferLifecycleAggregates`

This function is part of the `main` package implementation.

Signature: `func fetchPastOfferLifecycleAggregates(ids []int64) map[int64]pastLifecycleAggregate`

### `handlePastOrderStats`

This function is part of the `main` package implementation.

Signature: `func handlePastOrderStats(w http.ResponseWriter, r *http.Request)`

### `handlePastProfitableOrders`

This function is part of the `main` package implementation.

Signature: `func handlePastProfitableOrders(w http.ResponseWriter, r *http.Request)`

### `loadGeneralStatsContext`

This function is part of the `main` package implementation.

Signature: `func loadGeneralStatsContext(r *http.Request) (generalStatsContext, error)`

### `(generalStatsContext).overview`

This function is part of the `main` package implementation.

Signature: `func (ctx generalStatsContext) overview() pastorders.GeneralStatsOverview`

### `(generalStatsContext).premiumSummary`

This function is part of the `main` package implementation.

Signature: `func (ctx generalStatsContext) premiumSummary() pastorders.GeneralStatsPremiumSummary`

### `(generalStatsContext).openPremiums`

This function is part of the `main` package implementation.

Signature: `func (ctx generalStatsContext) openPremiums() pastorders.OpenPremiumStats`

### `(generalStatsContext).pastPremiums`

This function is part of the `main` package implementation.

Signature: `func (ctx generalStatsContext) pastPremiums(r *http.Request, lifecycleAgg map[int64]pastLifecycleAggregate) []pastorders.PastPremiumTimeframeStats`

### `(generalStatsContext).premiumLifetimes`

This function is part of the `main` package implementation.

Signature: `func (ctx generalStatsContext) premiumLifetimes(r *http.Request, lifecycleAgg map[int64]pastLifecycleAggregate) pastorders.PremiumLifetimeModes`

### `handleGeneralStatsOverview`

This function is part of the `main` package implementation.

Signature: `func handleGeneralStatsOverview(w http.ResponseWriter, r *http.Request)`

### `handleGeneralStatsOpenPremiums`

This function is part of the `main` package implementation.

Signature: `func handleGeneralStatsOpenPremiums(w http.ResponseWriter, r *http.Request)`

### `handleGeneralStatsPastPremiums`

This function is part of the `main` package implementation.

Signature: `func handleGeneralStatsPastPremiums(w http.ResponseWriter, r *http.Request)`

### `handleGeneralStatsLifetimes`

This function is part of the `main` package implementation.

Signature: `func handleGeneralStatsLifetimes(w http.ResponseWriter, r *http.Request)`

### `handleGeneralStatsPaymentMethods`

This function is part of the `main` package implementation.

Signature: `func handleGeneralStatsPaymentMethods(w http.ResponseWriter, r *http.Request)`

### `buildOpenPremiumStats`

This function is part of the `main` package implementation.

Signature: `func buildOpenPremiumStats(sub liveSubscription, excludedPaymentMethods []string) pastorders.OpenPremiumStats`

### `buildPastPremiumStats`

This function is part of the `main` package implementation.

Signature: `func buildPastPremiumStats(offers []map[string]any, lifecycleAgg map[int64]pastLifecycleAggregate, now time.Time, excludedPaymentMethods []string, maxFiatLimitEUR float64, requiredConfirmations int, excludedCEXes []string, feeTier string) []pastorders.PastPremiumTimeframeStats`

### `buildPremiumLifetimeStats`

This function is part of the `main` package implementation.

Signature: `func buildPremiumLifetimeStats(offers []map[string]any, lifecycleAgg map[int64]pastLifecycleAggregate, now time.Time, excludedPaymentMethods []string, maxFiatLimitEUR float64, requiredConfirmations int, excludedCEXes []string, feeTier string) pastorders.PremiumLifetimeModes`

### `(pastOfferAnalysis).valuesForMode`

This function is part of the `main` package implementation.

Signature: `func (a pastOfferAnalysis) valuesForMode(mode takerOpportunityMode) (float64, float64)`

### `(pastOfferAnalysis).profitableInMode`

This function is part of the `main` package implementation.

Signature: `func (a pastOfferAnalysis) profitableInMode(mode takerOpportunityMode) bool`

### `addPastOfferCostFields`

This function is part of the `main` package implementation.

Signature: `func addPastOfferCostFields(o map[string]any, requiredConfirmations int) pastOfferAnalysis`

### `addPastOfferCostFieldsFull`

This function is part of the `main` package implementation.

Signature: `func addPastOfferCostFieldsFull(o map[string]any, requiredConfirmations int, excludedCEXes []string, feeTier string, maxFiatLimitEUR float64) pastOfferAnalysis`

### `buildPastOfferAPI`

This function is part of the `main` package implementation.

Signature: `func buildPastOfferAPI(o map[string]any, agg pastLifecycleAggregate, requiredConfirmations int, excludedCEXes []string, feeTier string, maxFiatLimitEUR float64) pastOfferAPI`

### `buildPastOfferCompactAPI`

This function is part of the `main` package implementation.

Signature: `func buildPastOfferCompactAPI(o map[string]any) pastOfferCompactAPI`

### `buildPastProfitableOrderAPI`

This function is part of the `main` package implementation.

Signature: `func buildPastProfitableOrderAPI(o map[string]any, agg pastLifecycleAggregate, requiredConfirmations int, excludedCEXes []string, feeTier string, maxFiatLimitEUR float64, mode takerOpportunityMode) pastProfitableOrderAPI`

### `buildPastOfferDuration`

This function is part of the `main` package implementation.

Signature: `func buildPastOfferDuration(firstSeen, lastSeen time.Time) pastOfferDuration`

### `normalizePastPriceType`

This function is part of the `main` package implementation.

Signature: `func normalizePastPriceType(value string) string`

### `buildStoredPastBreakdown`

This function is part of the `main` package implementation.

Signature: `func buildStoredPastBreakdown(o map[string]any, btcSize, refPrice, tradeCostPct, tradeCostBTC, netPremiumPct, profitBTC float64) tradecost.CostBreakdown`

### `buildCappedPastBreakdown`

This function is part of the `main` package implementation.

Signature: `func buildCappedPastBreakdown(o map[string]any, fullBTCSize, cappedBTCSize, refPrice, premiumPct float64) tradecost.CostBreakdown`

### `recomputeCappedLifecycleAverages`

This function is part of the `main` package implementation.

Signature: `func recomputeCappedLifecycleAverages(o map[string]any, samples []pastLifecycleSample, fullBTCSize, maxFiatLimitEUR float64) (float64, float64, float64, float64, float64, float64)`

### `buildPastScenarioCosts`

This function is part of the `main` package implementation.

Signature: `func buildPastScenarioCosts(rep tradecost.CostBreakdown, avgNetworkPct, avgTradeCostPct, avgTradeCostBTC float64) pastOfferScenarioCosts`

### `buildPastBTCNetworkFee`

This function is part of the `main` package implementation.

Signature: `func buildPastBTCNetworkFee(rep tradecost.CostBreakdown, requiredConfirmations int) pastOfferBTCNetworkFee`

### `writeLifecycleEntries`

writeLifecycleEntries persists a computed snapshot of each live offer's
metrics into order_lifecycle, and updates best_route_cex / best_route_method
on the offers table when the optimizer found a valid route.

Signature: `func writeLifecycleEntries(offers []liveOutOffer)`

### `handleInternalLiveOffers`

handleInternalLiveOffers receives the live offer list from the snapshot tool,
updates the hub, and persists a lifecycle snapshot to the DB.

Signature: `func handleInternalLiveOffers(w http.ResponseWriter, r *http.Request)`

### `handleStats`

This function is part of the `main` package implementation.

Signature: `func handleStats(w http.ResponseWriter, r *http.Request)`

### `handleOHLC`

This function is part of the `main` package implementation.

Signature: `func handleOHLC(w http.ResponseWriter, r *http.Request)`

### `handlePaymentMethodGroups`

This function is part of the `main` package implementation.

Signature: `func handlePaymentMethodGroups(w http.ResponseWriter, r *http.Request)`

### `handleTradeCostConfig`

This function is part of the `main` package implementation.

Signature: `func handleTradeCostConfig(w http.ResponseWriter, r *http.Request)`

### `handleSnapshotLog`

This function is part of the `main` package implementation.

Signature: `func handleSnapshotLog(w http.ResponseWriter, r *http.Request)`

### `handleSnapshotLogDetail`

This function is part of the `main` package implementation.

Signature: `func handleSnapshotLogDetail(w http.ResponseWriter, r *http.Request)`

### `compactSnapshotExchanges`

This function is part of the `main` package implementation.

Signature: `func compactSnapshotExchanges(exchanges map[string]any) map[string]any`

### `handleMmControllerTransactions`

This function is part of the `main` package implementation.

Signature: `func handleMmControllerTransactions(w http.ResponseWriter, r *http.Request)`

### `handleMmControllerTransactionByID`

This function is part of the `main` package implementation.

Signature: `func handleMmControllerTransactionByID(w http.ResponseWriter, r *http.Request)`

### `handleHealth`

This function is part of the `main` package implementation.

Signature: `func handleHealth(w http.ResponseWriter, r *http.Request)`

### `handleTradingAccounts`

This function is part of the `main` package implementation.

Signature: `func handleTradingAccounts(w http.ResponseWriter, r *http.Request)`

### `handleTradingAccountByID`

This function is part of the `main` package implementation.

Signature: `func handleTradingAccountByID(w http.ResponseWriter, r *http.Request)`

### `handleTradingAccountTOTPSecrets`

This function is part of the `main` package implementation.

Signature: `func handleTradingAccountTOTPSecrets(w http.ResponseWriter, r *http.Request)`

### `handleTradingTOTPSecretByID`

This function is part of the `main` package implementation.

Signature: `func handleTradingTOTPSecretByID(w http.ResponseWriter, r *http.Request)`

### `handleTradingAccountPasskeys`

This function is part of the `main` package implementation.

Signature: `func handleTradingAccountPasskeys(w http.ResponseWriter, r *http.Request)`

### `handleTradingPasskeyByID`

This function is part of the `main` package implementation.

Signature: `func handleTradingPasskeyByID(w http.ResponseWriter, r *http.Request)`

### `handleTradingAccountSeeds`

This function is part of the `main` package implementation.

Signature: `func handleTradingAccountSeeds(w http.ResponseWriter, r *http.Request)`

### `handleTradingSeedByID`

This function is part of the `main` package implementation.

Signature: `func handleTradingSeedByID(w http.ResponseWriter, r *http.Request)`

### `handleTradingAccountAPIKeys`

This function is part of the `main` package implementation.

Signature: `func handleTradingAccountAPIKeys(w http.ResponseWriter, r *http.Request)`

### `handleTradingAPIKeyByID`

This function is part of the `main` package implementation.

Signature: `func handleTradingAPIKeyByID(w http.ResponseWriter, r *http.Request)`

### `tradingAccounts`

This function is part of the `main` package implementation.

Signature: `func tradingAccounts() tradingaccounts.Repository`

### `loadTradingAccounts`

This function is part of the `main` package implementation.

Signature: `func loadTradingAccounts(ctx context.Context) ([]tradingAccount, error)`

### `loadTradingAccountByID`

This function is part of the `main` package implementation.

Signature: `func loadTradingAccountByID(ctx context.Context, id int64) (*tradingAccount, error)`

### `createTradingAccount`

This function is part of the `main` package implementation.

Signature: `func createTradingAccount(ctx context.Context, payload tradingAccountPayload) (int64, error)`

### `updateTradingAccount`

This function is part of the `main` package implementation.

Signature: `func updateTradingAccount(ctx context.Context, id int64, payload tradingAccountPayload) error`

### `loadTradingTOTPSecretByID`

This function is part of the `main` package implementation.

Signature: `func loadTradingTOTPSecretByID(ctx context.Context, id int64) (*tradingTOTPSecret, error)`

### `loadTradingPasskeyByID`

This function is part of the `main` package implementation.

Signature: `func loadTradingPasskeyByID(ctx context.Context, id int64) (*tradingPasskey, error)`

### `loadTradingSeedByID`

This function is part of the `main` package implementation.

Signature: `func loadTradingSeedByID(ctx context.Context, id int64) (*tradingSeed, error)`

### `loadTradingAPIKeyByID`

This function is part of the `main` package implementation.

Signature: `func loadTradingAPIKeyByID(ctx context.Context, id int64) (*tradingAPIKey, error)`

### `decodeJSON`

This function is part of the `main` package implementation.

Signature: `func decodeJSON(r *http.Request, dest any) error`

### `pathID`

This function is part of the `main` package implementation.

Signature: `func pathID(r *http.Request, name string) (int64, error)`

### `rebind`

rebind converts SQLite-style ? placeholders to PostgreSQL $1, $2, ... style.

Signature: `func rebind(query string) string`

### `parseDBTime`

This function is part of the `main` package implementation.

Signature: `func parseDBTime(s string) time.Time`

### `scanOffers`

This function is part of the `main` package implementation.

Signature: `func scanOffers(rows *sql.Rows) ([]map[string]any, error)`

### `offerRefPrice`

This function is part of the `main` package implementation.

Signature: `func offerRefPrice(o map[string]any) float64`

### `offerStringPtr`

This function is part of the `main` package implementation.

Signature: `func offerStringPtr(o map[string]any, key string) *string`

### `offerInt64Ptr`

This function is part of the `main` package implementation.

Signature: `func offerInt64Ptr(o map[string]any, key string) *int64`

### `buildOfferTablePayload`

This function is part of the `main` package implementation.

Signature: `func buildOfferTablePayload(o map[string]any) map[string]any`

### `nilIfEmpty`

This function is part of the `main` package implementation.

Signature: `func nilIfEmpty(value string) any`

### `offerFloatPtr`

This function is part of the `main` package implementation.

Signature: `func offerFloatPtr(o map[string]any, key string) *float64`

### `nonEmptyOr`

This function is part of the `main` package implementation.

Signature: `func nonEmptyOr(value, fallback string) string`

### `nonZeroFloat`

This function is part of the `main` package implementation.

Signature: `func nonZeroFloat(value, fallback float64) float64`

### `queryCex`

queryCex reads the ?cex= query param and validates it against supportedCEXes.
Falls back to defaultCEX if missing or unrecognised.

Signature: `func queryCex(r *http.Request) string`

### `queryInt`

This function is part of the `main` package implementation.

Signature: `func queryInt(r *http.Request, key string, defaultVal int) int`

### `queryBool`

This function is part of the `main` package implementation.

Signature: `func queryBool(r *http.Request, key string) bool`

### `queryConfirmations`

This function is part of the `main` package implementation.

Signature: `func queryConfirmations(r *http.Request) int`

### `queryFeeTier`

queryFeeTier reads the ?fee_tier= query param. Returns "" (auto) for missing/unknown values.

Signature: `func queryFeeTier(r *http.Request) string`

### `queryExcludedCEXes`

queryExcludedCEXes reads the ?exclude_cexes= query param (comma-separated).

Signature: `func queryExcludedCEXes(r *http.Request) []string`

### `queryCoupledHedge`

queryCoupledHedge reads the ?coupled_hedge= query param. Default is true.

Signature: `func queryCoupledHedge(r *http.Request) bool`

### `queryMaxFiatLimitEUR`

queryMaxFiatLimitEUR reads the ?max_fiat_limit= query param (EUR amount, positive float).
Returns 0 when absent, zero, or invalid.

Signature: `func queryMaxFiatLimitEUR(r *http.Request) float64`

### `queryTakerOpportunityMode`

This function is part of the `main` package implementation.

Signature: `func queryTakerOpportunityMode(r *http.Request) takerOpportunityMode`

### `queryExcludedPaymentMethods`

This function is part of the `main` package implementation.

Signature: `func queryExcludedPaymentMethods(r *http.Request) []string`

### `isPaymentMethodExcluded`

This function is part of the `main` package implementation.

Signature: `func isPaymentMethodExcluded(method string, excluded []string) bool`

### `offerString`

This function is part of the `main` package implementation.

Signature: `func offerString(o map[string]any, key string) string`

### `offerFloat`

This function is part of the `main` package implementation.

Signature: `func offerFloat(o map[string]any, key string) float64`

### `offerBool`

This function is part of the `main` package implementation.

Signature: `func offerBool(o map[string]any, key string) bool`

### `forwardMMControllerJSON`

This function is part of the `main` package implementation.

Signature: `func forwardMMControllerJSON(w http.ResponseWriter, r *http.Request, path string)`

### `queryIntPtr`

This function is part of the `main` package implementation.

Signature: `func queryIntPtr(r *http.Request, key string) *int`

### `parseFloat`

This function is part of the `main` package implementation.

Signature: `func parseFloat(s string) float64`

### `writeJSON`

This function is part of the `main` package implementation.

Signature: `func writeJSON(w http.ResponseWriter, data any)`

### `writeError`

This function is part of the `main` package implementation.

Signature: `func writeError(w http.ResponseWriter, err error)`

## Constants and Variables

- `defaultCEX`: No inline declaration comment is present.
- `takerOpportunityModeNetFull`: No inline declaration comment is present.
- `takerOpportunityModeNetCapped`: No inline declaration comment is present.
- `databaseURL`: No inline declaration comment is present.
- `snapshotIntervalMin`: No inline declaration comment is present.
- `frontendDir`: No inline declaration comment is present.
- `mmControllerAPIURL`: No inline declaration comment is present.
- `db`: No inline declaration comment is present.
- `pmService`: No inline declaration comment is present.
- `priceManager`: No inline declaration comment is present.
- `lifecycleRepo`: No inline declaration comment is present.
- `ohlcService`: No inline declaration comment is present.
- `snapshotLogRepo`: No inline declaration comment is present.
- `mmProxy`: No inline declaration comment is present.
- `tradingAccountRepo`: No inline declaration comment is present.
- `cexPricesMu`: No inline declaration comment is present.
- `cexPrices`: No inline declaration comment is present.
- `supportedCEXes`: supportedCEXes lists all exchanges available for selection in the UI.
- `tradeCostEstimators`: No inline declaration comment is present.
- `tradeRouteOptimizer`: No inline declaration comment is present.
- `validFeeTiers`: validFeeTiers lists the fee tiers the user can lock in via settings.

## Key Dependencies

- `context`
- `database/sql`
- `encoding/json`
- `fmt`
- `math`
- `net/http`
- `net/url`
- `os`
- `path/filepath`
- `sort`
- `strconv`
- `strings`
- `sync`
- `time`
- `commons/prices`
- `commons/tradecost`
- `dexmonitor/internal/lifecycle`
- `dexmonitor/internal/mmproxy`
- `dexmonitor/internal/ohlc`
- `dexmonitor/internal/pastorders`
- `dexmonitor/internal/paymentmethods`
- `dexmonitor/internal/snapshotlog`
- `dexmonitor/internal/tradingaccounts`
- `github.com/jackc/pgx/v5/stdlib`

