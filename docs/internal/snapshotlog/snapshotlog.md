# `internal/snapshotlog/snapshotlog.go`

Source package: `snapshotlog`  
Source lines: `118`

## Package Purpose

This file contributes to the `snapshotlog` package.

## File Role

This file defines 2 type(s), implements 5 function or method entry point(s).

## Runtime Behavior

- Reads from or writes to persistent storage.
- Serializes or deserializes JSON payloads.
- Uses time windows, timestamps, or duration calculations.
- Accepts context for cancellation, deadlines, or request scoping.

## Types

### `Entry`

Entry is a stored snapshot-log row returned to the monitor UI.

Fields:

- `ID` `int`: ID identifies the entry.
- `Timestamp` `time.Time`: Timestamp records the relevant time for the entry.
- `Exchanges` `map[string]any`: Exchanges is the exchanges value for the entry.
- `OffersCount` `int`: OffersCount is the count associated with the entry.

### `Repository`

Repository represents a repository.

Fields:

- `DB` `*sql.DB`: DB is the database handle used by the repository.

## Functions and Methods

### `NewRepository`

NewRepository creates a repository.

Signature: `func NewRepository(db *sql.DB) Repository`

### `(Repository).List`

List returns recent records, capped by the requested limit.

Signature: `func (r Repository) List(ctx context.Context, limit int, compact bool) ([]Entry, error)`

### `(Repository).Detail`

Detail returns the stored snapshot payload for a log entry.

Signature: `func (r Repository) Detail(ctx context.Context, id int64) (Entry, error)`

### `CompactExchanges`

CompactExchanges formats exchange names for compact display.

Signature: `func CompactExchanges(exchanges map[string]any) map[string]any`

### `rebind`

This function is part of the `snapshotlog` package implementation.

Signature: `func rebind(query string) string`

## Key Dependencies

- `context`
- `database/sql`
- `encoding/json`
- `fmt`
- `strings`
- `time`

