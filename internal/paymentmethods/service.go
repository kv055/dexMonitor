package paymentmethods

import (
	"context"
	"database/sql"
	"fmt"
	"sync"
	"time"
)

// Service fetches distinct payment methods from the DB, groups them, and
// caches the result in memory for use by the API handler.
type Service struct {
	db     *sql.DB
	mu     sync.RWMutex
	cached []Group
}

// NewService creates a Service and performs an initial load synchronously so
// the first API response is populated immediately.
func NewService(db *sql.DB) (*Service, error) {
	s := &Service{db: db}
	if err := s.refresh(); err != nil {
		return nil, fmt.Errorf("paymentmethods: initial load: %w", err)
	}
	return s, nil
}

// GetGroups returns the cached groups (safe for concurrent reads).
func (s *Service) GetGroups() []Group {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cached
}

// RefreshLoop refreshes the cache on the given interval until ctx is done.
// Call this in a goroutine after NewService.
func (s *Service) RefreshLoop(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.refresh(); err != nil {
				fmt.Printf("paymentmethods: refresh error: %v\n", err)
			}
		}
	}
}

// refresh queries the DB and rebuilds the cached groups.
func (s *Service) refresh() error {
	rows, err := s.db.Query(
		`SELECT DISTINCT payment_method FROM offers WHERE payment_method IS NOT NULL AND payment_method != '' ORDER BY payment_method`,
	)
	if err != nil {
		return err
	}
	defer rows.Close()

	var methods []string
	for rows.Next() {
		var m string
		if err := rows.Scan(&m); err != nil {
			return err
		}
		methods = append(methods, m)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	groups := buildGroups(methods)

	s.mu.Lock()
	s.cached = groups
	s.mu.Unlock()
	return nil
}
