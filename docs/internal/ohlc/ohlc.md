# `internal/ohlc/ohlc.go`

Source package: `ohlc`  
Source lines: `266`

## Package Purpose

This file contributes to the `ohlc` package.

## File Role

This file defines 1 type(s), implements 8 function or method entry point(s).

## Runtime Behavior

- Handles HTTP request or response flow.
- Reads from or writes to persistent storage.
- Serializes or deserializes JSON payloads.
- Uses time windows, timestamps, or duration calculations.
- Accepts context for cancellation, deadlines, or request scoping.

## Types

### `Service`

Service represents a service.

Fields:

- `Client` `*http.Client`: Client is the client value for the service.

## Functions and Methods

### `NewService`

NewService creates a service.

Signature: `func NewService() *Service`

### `(*Service).Candles`

Candles fetches OHLC candles for the requested market.

Signature: `func (s *Service) Candles(ctx context.Context, exchange string, hours int, intervalMin int) []map[string]any`

### `(*Service).client`

This function is part of the `ohlc` package implementation.

Signature: `func (s *Service) client() *http.Client`

### `(*Service).fetchKraken`

This function is part of the `ohlc` package implementation.

Signature: `func (s *Service) fetchKraken(ctx context.Context, hours int, intervalMin int) []map[string]any`

### `(*Service).fetchBinance`

This function is part of the `ohlc` package implementation.

Signature: `func (s *Service) fetchBinance(ctx context.Context, hours int, intervalMin int) []map[string]any`

### `(*Service).fetchBitstamp`

This function is part of the `ohlc` package implementation.

Signature: `func (s *Service) fetchBitstamp(ctx context.Context, hours int, intervalMin int) []map[string]any`

### `(*Service).fetchCoinbase`

This function is part of the `ohlc` package implementation.

Signature: `func (s *Service) fetchCoinbase(ctx context.Context, hours int, intervalMin int) []map[string]any`

### `parseFloat`

This function is part of the `ohlc` package implementation.

Signature: `func parseFloat(s string) float64`

## Key Dependencies

- `context`
- `encoding/json`
- `fmt`
- `io`
- `net/http`
- `net/url`
- `strconv`
- `time`

