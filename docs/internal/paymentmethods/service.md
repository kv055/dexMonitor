# `internal/paymentmethods/service.go`

Source package: `paymentmethods`  
Source lines: `82`

## Package Purpose

This file contributes to the `paymentmethods` package.

## File Role

This file defines 1 type(s), implements 4 function or method entry point(s).

## Runtime Behavior

- Reads from or writes to persistent storage.
- Uses time windows, timestamps, or duration calculations.
- Accepts context for cancellation, deadlines, or request scoping.

## Types

### `Service`

Service fetches distinct payment methods from the DB, groups them, and
caches the result in memory for use by the API handler.

Fields:

- `db` `*sql.DB`: Stores the db value for the service.
- `mu` `sync.RWMutex`: Stores the mu value for the service.
- `cached` `[]Group`: Stores the cached value for the service.

## Functions and Methods

### `NewService`

NewService creates a Service and performs an initial load synchronously so
the first API response is populated immediately.

Signature: `func NewService(db *sql.DB) (*Service, error)`

### `(*Service).GetGroups`

GetGroups returns the cached groups (safe for concurrent reads).

Signature: `func (s *Service) GetGroups() []Group`

### `(*Service).RefreshLoop`

RefreshLoop refreshes the cache on the given interval until ctx is done.
Call this in a goroutine after NewService.

Signature: `func (s *Service) RefreshLoop(ctx context.Context, interval time.Duration)`

### `(*Service).refresh`

refresh queries the DB and rebuilds the cached groups.

Signature: `func (s *Service) refresh() error`

## Key Dependencies

- `context`
- `database/sql`
- `fmt`
- `sync`
- `time`

