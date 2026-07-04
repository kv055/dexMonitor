package paymentmethods

import (
	"context"
	"database/sql"
	"log/slog"
	"strings"
	"sync"
	"time"

	commonpm "commons/paymentmethods"
)

// initialRetryStart and initialRetryCap bound the backoff used to populate the
// cache the first time. On a cold start Postgres may not be accepting
// connections yet; we retry quickly rather than waiting a full refresh interval.
const (
	initialRetryStart = 2 * time.Second
	initialRetryCap   = 30 * time.Second
)

// Service fetches distinct payment methods from the DB, groups them, and
// caches the result in memory for use by the API handler.
type Service struct {
	db     *sql.DB
	mu     sync.RWMutex
	cached []Group
}

// NewService creates a Service. It does not touch the DB — the initial load is
// performed by RefreshLoop, which retries until it succeeds. This keeps a
// transient boot-time DB outage (e.g. Postgres not yet accepting connections)
// from permanently disabling the feature.
func NewService(db *sql.DB) *Service {
	return &Service{db: db}
}

// GetGroups returns the cached groups (safe for concurrent reads). It returns an
// empty slice until the first successful refresh.
func (s *Service) GetGroups() []Group {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cached
}

// RefreshLoop populates the cache and keeps it fresh until ctx is done. It
// refreshes immediately on entry; if that fails it retries on a short backoff
// until the first success, then settles into the given interval. Call this in a
// goroutine after NewService.
func (s *Service) RefreshLoop(ctx context.Context, interval time.Duration) {
	// Initial load with retry — the DB may not be ready at startup.
	backoff := initialRetryStart
	for {
		if err := s.refresh(); err != nil {
			slog.Warn("paymentmethods: initial refresh failed, retrying", "err", err, "retry_in", backoff)
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			if backoff < initialRetryCap {
				backoff *= 2
				if backoff > initialRetryCap {
					backoff = initialRetryCap
				}
			}
			continue
		}
		break
	}

	// Steady-state periodic refresh.
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.refresh(); err != nil {
				slog.Warn("paymentmethods: periodic refresh failed", "err", err)
			}
		}
	}
}

// RefreshNow rebuilds the cache immediately — called after categorization
// panel edits so they take effect without waiting for the periodic refresh.
func (s *Service) RefreshNow() error {
	return s.refresh()
}

// refresh queries the DB and rebuilds the cached groups.
func (s *Service) refresh() error {
	rows, err := s.db.Query(
		`SELECT DISTINCT unnest(payment_methods) AS method FROM offers WHERE payment_methods IS NOT NULL ORDER BY method`,
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

	// Rebuild the registry from the payment_methods table so panel edits
	// (categories, merge regexes) apply on the next refresh. On failure keep
	// whatever registry is installed — same resilience contract as the rest
	// of this service.
	reg := commonpm.Default()
	if pmRows, err := commonpm.LoadRows(context.Background(), s.db); err != nil {
		slog.Warn("paymentmethods: loading payment_methods registry failed; keeping previous registry", "err", err)
	} else {
		reg = commonpm.NewRegistry(pmRows)
		for _, w := range reg.Warnings() {
			slog.Warn("paymentmethods: registry warning", "warning", w)
		}
		commonpm.SetDefault(reg)
	}

	groups := buildGroups(reg, methods)

	unmatched := reg.UnmatchedFromDistinct(methods)
	if len(unmatched) > 0 {
		const maxLog = 20
		shown := unmatched
		if len(shown) > maxLog {
			shown = shown[:maxLog]
		}
		slog.Info("paymentmethods: unmatched canonical candidates",
			"count", len(unmatched),
			"sample", strings.Join(shown, ", "),
		)
	}
	if other := findGroupMethods(groups, commonpm.CategoryOthers); len(other) > 0 {
		slog.Info("paymentmethods: methods in other category", "count", len(other), "methods", other)
	}

	s.mu.Lock()
	s.cached = groups
	s.mu.Unlock()
	return nil
}

func findGroupMethods(groups []Group, name string) []string {
	for _, g := range groups {
		if g.Name == name {
			return g.Methods
		}
	}
	return nil
}
