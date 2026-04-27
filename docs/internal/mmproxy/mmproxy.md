# `internal/mmproxy/mmproxy.go`

Source package: `mmproxy`  
Source lines: `70`

## Package Purpose

This file contributes to the `mmproxy` package.

## File Role

This file defines 1 type(s), implements 2 function or method entry point(s).

## Runtime Behavior

- Handles HTTP request or response flow.
- Reads from or writes to persistent storage.
- Uses time windows, timestamps, or duration calculations.

## Types

### `Proxy`

Proxy represents a proxy.

Fields:

- `BaseURL` `string`: BaseURL is the base url value for the proxy.
- `Client` `*http.Client`: Client is the client value for the proxy.

## Functions and Methods

### `New`

New creates value.

Signature: `func New(baseURL string) *Proxy`

### `(*Proxy).ForwardJSON`

ForwardJSON proxies a JSON request to the market-maker controller.

Signature: `func (p *Proxy) ForwardJSON(w http.ResponseWriter, r *http.Request, path string)`

## Key Dependencies

- `io`
- `net/http`
- `net/url`
- `strings`
- `time`

