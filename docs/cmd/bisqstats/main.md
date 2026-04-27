# `cmd/bisqstats/main.go`

Source package: `main`  
Source lines: `108`

## Package Purpose

This file contributes to the `main` package.

## File Role

This file implements 8 function or method entry point(s).

## Runtime Behavior

- Handles HTTP request or response flow.
- Reads from or writes to persistent storage.
- Serializes or deserializes JSON payloads.
- Uses time windows, timestamps, or duration calculations.

## Functions and Methods

### `main`

This binary is a dormant helper API for future Bisq settlement analysis.
It serves stats derived from the local ClosedTrades store, but it is
intentionally not wired into docker-compose at the moment.

Signature: `func main()`

### `parseQuery`

This function is part of the `main` package implementation.

Signature: `func parseQuery(r *http.Request) bisqstats.Query`

### `queryInt`

This function is part of the `main` package implementation.

Signature: `func queryInt(r *http.Request, key string, fallback int) int`

### `cors`

This function is part of the `main` package implementation.

Signature: `func cors(next http.Handler) http.Handler`

### `writeJSON`

This function is part of the `main` package implementation.

Signature: `func writeJSON(w http.ResponseWriter, payload any)`

### `writeError`

This function is part of the `main` package implementation.

Signature: `func writeError(w http.ResponseWriter, status int, err error)`

### `envOr`

This function is part of the `main` package implementation.

Signature: `func envOr(key, fallback string) string`

### `init`

This function is part of the `main` package implementation.

Signature: `func init()`

## Key Dependencies

- `encoding/json`
- `fmt`
- `log`
- `net/http`
- `os`
- `strconv`
- `strings`
- `time`
- `dexmonitor/internal/bisqstats`

