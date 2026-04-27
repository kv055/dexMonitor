# `internal/accounthealth/account_health.go`

Source package: `accounthealth`  
Source lines: `85`

## Package Purpose

This file contributes to the `accounthealth` package.

## File Role

This file defines 2 type(s), implements 2 function or method entry point(s).

## Runtime Behavior

- Handles HTTP request or response flow.
- Reads from or writes to persistent storage.
- Serializes or deserializes JSON payloads.
- Uses time windows, timestamps, or duration calculations.
- Accepts context for cancellation, deadlines, or request scoping.

## Types

### `MMControllerResponse`

MMControllerResponse represents a mmcontroller response.

Fields:

- `Provider` `string`: Provider is the provider value for the mmcontroller response.
- `Status` `string`: Status is the current status of the mmcontroller response.
- `Healthy` `bool`: Healthy reports whether the mmcontroller response condition is true.
- `Message` `string`: Message carries a human-readable message for the mmcontroller response.
- `CheckedAt` `string`: CheckedAt records the relevant time for the mmcontroller response.

### `Service`

Service represents a service.

Fields:

- `BaseURL` `string`: BaseURL is the base url value for the service.
- `Client` `*http.Client`: Client is the client value for the service.

## Functions and Methods

### `NewService`

NewService creates a service.

Signature: `func NewService(baseURL string) *Service`

### `(*Service).Check`

Check checks value.

Signature: `func (s *Service) Check(ctx context.Context, provider string) (*MMControllerResponse, int, error)`

## Key Dependencies

- `context`
- `encoding/json`
- `errors`
- `fmt`
- `net/http`
- `net/url`
- `time`

