package snapshotlog

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Entry is a stored snapshot-log row returned to the monitor UI.
type Entry struct {
	// ID identifies the entry.
	ID int `json:"id"`
	// Timestamp records the relevant time for the entry.
	Timestamp time.Time `json:"timestamp"`
	// Exchanges is the exchanges value for the entry.
	Exchanges map[string]any `json:"exchanges"`
	// OffersCount is the count associated with the entry.
	OffersCount int `json:"offers_count"`
}

// Repository represents a repository.
type Repository struct {
	// DB is the database handle used by the repository.
	DB *sql.DB
}

// NewRepository creates a repository.
func NewRepository(db *sql.DB) Repository {
	return Repository{DB: db}
}

// List returns recent records, capped by the requested limit.
func (r Repository) List(ctx context.Context, limit int, compact bool) ([]Entry, error) {
	rows, err := r.DB.QueryContext(ctx, rebind("SELECT id, timestamp, exchanges, offers_count FROM snapshot_log ORDER BY timestamp DESC LIMIT ?"), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]Entry, 0)
	for rows.Next() {
		var entry Entry
		var exchangesJSON []byte
		if err := rows.Scan(&entry.ID, &entry.Timestamp, &exchangesJSON, &entry.OffersCount); err != nil {
			return nil, err
		}
		entry.Exchanges = map[string]any{}
		json.Unmarshal(exchangesJSON, &entry.Exchanges)
		if compact {
			entry.Exchanges = CompactExchanges(entry.Exchanges)
		}
		result = append(result, entry)
	}
	return result, rows.Err()
}

// Detail returns the stored snapshot payload for a log entry.
func (r Repository) Detail(ctx context.Context, id int64) (Entry, error) {
	var entry Entry
	var exchangesJSON []byte
	if err := r.DB.QueryRowContext(ctx, rebind("SELECT timestamp, exchanges, offers_count FROM snapshot_log WHERE id = ?"), id).Scan(&entry.Timestamp, &exchangesJSON, &entry.OffersCount); err != nil {
		return Entry{}, err
	}
	entry.ID = int(id)
	entry.Exchanges = map[string]any{}
	json.Unmarshal(exchangesJSON, &entry.Exchanges)
	return entry, nil
}

// CompactExchanges formats exchange names for compact display.
func CompactExchanges(exchanges map[string]any) map[string]any {
	out := make(map[string]any, len(exchanges))
	for name, raw := range exchanges {
		count := 0
		if data, ok := raw.(map[string]any); ok {
			if v, ok := data["count"].(float64); ok {
				count = int(v)
			}
			if count == 0 {
				if ids, ok := data["ids"].([]any); ok {
					count = len(ids)
				}
			}
		}
		entry := map[string]any{"count": count}
		if data, ok := raw.(map[string]any); ok {
			if status, ok := data["status"].(string); ok && status != "" {
				entry["status"] = status
			}
			if offline, ok := data["offline"].(bool); ok && offline {
				entry["offline"] = true
			}
		}
		out[name] = entry
	}
	return out
}

func rebind(query string) string {
	var out strings.Builder
	n := 1
	inQuote := false
	for i := 0; i < len(query); i++ {
		ch := query[i]
		if ch == '\'' {
			out.WriteByte(ch)
			if i+1 < len(query) && query[i+1] == '\'' {
				out.WriteByte(query[i+1])
				i++
				continue
			}
			inQuote = !inQuote
			continue
		}
		if ch == '?' && !inQuote {
			out.WriteString(fmt.Sprintf("$%d", n))
			n++
			continue
		}
		out.WriteByte(ch)
	}
	return out.String()
}
