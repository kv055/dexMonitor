package snapshotlog

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type Entry struct {
	ID          int            `json:"id"`
	Timestamp   time.Time      `json:"timestamp"`
	Exchanges   map[string]any `json:"exchanges"`
	OffersCount int            `json:"offers_count"`
}

type Repository struct {
	DB *sql.DB
}

func NewRepository(db *sql.DB) Repository {
	return Repository{DB: db}
}

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
		out[name] = map[string]any{"count": count}
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
