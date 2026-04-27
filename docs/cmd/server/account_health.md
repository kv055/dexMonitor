# `cmd/server/account_health.go`

Source package: `main`  
Source lines: `56`

## Package Purpose

This file contributes to the `main` package.

## File Role

This file defines 1 type(s), implements 1 function or method entry point(s).

## Runtime Behavior

- Handles HTTP request or response flow.
- Serializes or deserializes JSON payloads.

## Types

### `tradingAccountHealthCheckResult`

Fields:

- `Account` `*tradingAccount`: Stores the account value for the trading account health check result.
- `Status` `string`: Stores the current status for the trading account health check result.
- `Healthy` `*bool`: Reports a boolean condition for the trading account health check result.
- `Message` `string`: Stores the message value for the trading account health check result.
- `CheckedAt` `string`: Stores timing information for the trading account health check result.

## Functions and Methods

### `handleTradingAccountHealthCheck`

This function is part of the `main` package implementation.

Signature: `func handleTradingAccountHealthCheck(w http.ResponseWriter, r *http.Request)`

## Key Dependencies

- `net/http`
- `dexmonitor/internal/accounthealth`

