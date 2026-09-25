package appsettings

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"commons/credentialcrypto"
	"github.com/jackc/pgx/v5/pgconn"
)

// ErrSchemaNotManaged reports that the app_settings table is deploy-managed:
// it does not exist yet (migrations not applied) and this role may not
// create it (no CREATE privilege). Callers should run with environment-only
// settings instead of failing startup.
var ErrSchemaNotManaged = errors.New("app_settings schema is deploy-managed and not writable by this role")

// pgCode extracts the Postgres SQLSTATE from a driver error, if any.
func pgCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return string(pgErr.Code)
	}
	return ""
}

// IsMissingTable reports Postgres undefined_table (42P01).
func IsMissingTable(err error) bool {
	return pgCode(err) == "42P01"
}

// isPermissionDenied reports Postgres insufficient_privilege (42501).
func isPermissionDenied(err error) bool {
	return pgCode(err) == "42501"
}

// Setting is one persisted row of the app_settings table. Value is always
// plaintext in memory; secrets are encrypted at rest when Encrypted is set.
type Setting struct {
	Value     string
	Encrypted bool
	UpdatedBy string
	UpdatedAt time.Time
}

// Store persists db-stored settings. SQLStore is the Postgres implementation
// used in production; handlers accept the interface so tests can substitute
// a fake.
type Store interface {
	EnsureSchema(ctx context.Context) error
	GetAll(ctx context.Context) (map[string]Setting, error)
	Set(ctx context.Context, key, value string, encrypt bool, actor string) error
	// SeedMissing inserts rows for db-stored schema fields absent from the
	// table, taking values from the process environment (deploy bundle) with
	// schema defaults as fallback. Existing rows are never overwritten, so
	// operator edits survive deploys that replace the .env files.
	SeedMissing(ctx context.Context, fields map[string]Field, getenv func(string) string, actor string) (int, error)
}

// SQLStore is the Postgres-backed Store.
type SQLStore struct {
	db *sql.DB
}

// NewSQLStore wraps db (pgx stdlib driver) for settings persistence.
func NewSQLStore(db *sql.DB) *SQLStore { return &SQLStore{db: db} }

// EnsureSchema makes the app_settings table readable, creating it when the
// role allows. The table is deploy-managed (see the app_settings migration
// in dexUnifiedApi/db/migrations, applied privileged): low-privilege roles
// must not fail startup when it is absent or uncreatable, so a missing table
// the role may not create maps to ErrSchemaNotManaged for the caller to
// degrade to environment-only settings. Any other error (DB down, etc.)
// stays fatal. Keep the DDL identical to the migration.
func (s *SQLStore) EnsureSchema(ctx context.Context) error {
	const ddl = `CREATE TABLE IF NOT EXISTS app_settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL DEFAULT '',
		encrypted BOOLEAN NOT NULL DEFAULT FALSE,
		updated_by TEXT NOT NULL DEFAULT '',
		updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`
	if _, err := s.db.ExecContext(ctx, `SELECT 1 FROM app_settings LIMIT 1`); err == nil {
		return nil
	} else if !IsMissingTable(err) {
		return fmt.Errorf("probe app_settings schema: %w", err)
	}
	if _, err := s.db.ExecContext(ctx, ddl); err != nil {
		return mapEnsureSchemaError(err)
	}
	return nil
}

// mapEnsureSchemaError classifies a failed creation attempt after a
// missing-table probe: a role that may not create the deploy-managed table
// maps to ErrSchemaNotManaged (caller degrades); anything else stays fatal.
// Pure for unit-testing the SQLSTATE mapping without a restricted role.
func mapEnsureSchemaError(ddlErr error) error {
	if isPermissionDenied(ddlErr) {
		return ErrSchemaNotManaged
	}
	return fmt.Errorf("ensure app_settings schema: %w", ddlErr)
}

// GetAll returns every persisted row, decrypting secrets. A decrypt failure
// means the encryption key changed or the row is corrupt; it surfaces as an
// error rather than silently falling back to a stale environment value.
func (s *SQLStore) GetAll(ctx context.Context) (map[string]Setting, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT key, value, encrypted, updated_by, updated_at FROM app_settings`)
	if err != nil {
		return nil, fmt.Errorf("read app_settings: %w", err)
	}
	defer func() { _ = rows.Close() }()
	out := make(map[string]Setting)
	for rows.Next() {
		var key, value, updatedBy string
		var encrypted bool
		var updatedAt time.Time
		if err := rows.Scan(&key, &value, &encrypted, &updatedBy, &updatedAt); err != nil {
			return nil, fmt.Errorf("scan app_settings: %w", err)
		}
		if encrypted {
			value, err = credentialcrypto.Decrypt(value)
			if err != nil {
				return nil, fmt.Errorf("decrypt setting %q: %w", key, err)
			}
		}
		out[key] = Setting{Value: value, Encrypted: encrypted, UpdatedBy: updatedBy, UpdatedAt: updatedAt}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read app_settings: %w", err)
	}
	return out, nil
}

// Set inserts or replaces one row, encrypting secrets at rest. The
// MaskedSecret sentinel must be filtered by the caller (it means "leave
// unchanged"); storing it would destroy the real value.
func (s *SQLStore) Set(ctx context.Context, key, value string, encrypt bool, actor string) error {
	stored := value
	if encrypt {
		encrypted, err := credentialcrypto.Encrypt(strings.TrimSpace(value))
		if err != nil {
			return fmt.Errorf("encrypt setting %q (is APP_ENCRYPTION_KEY set?): %w", key, err)
		}
		stored = encrypted
	}
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO app_settings (key, value, encrypted, updated_by, updated_at)
		 VALUES ($1, $2, $3, $4, now())
		 ON CONFLICT (key) DO UPDATE SET
		   value = EXCLUDED.value,
		   encrypted = EXCLUDED.encrypted,
		   updated_by = EXCLUDED.updated_by,
		   updated_at = now()`,
		key, stored, encrypt, actor)
	if err != nil {
		return fmt.Errorf("store setting %q: %w", key, err)
	}
	return nil
}

// SeedMissing implements Store.SeedMissing.
func (s *SQLStore) SeedMissing(ctx context.Context, fields map[string]Field, getenv func(string) string, actor string) (int, error) {
	existing, err := s.GetAll(ctx)
	if err != nil {
		return 0, err
	}
	seeded := 0
	for key, field := range fields {
		if !field.StoredInDB() {
			continue
		}
		if _, ok := existing[key]; ok {
			continue
		}
		value := strings.TrimSpace(getenv(key))
		if value == "" {
			value = field.Default
		}
		encrypt := field.Type == "secret"
		if encrypt && value != "" {
			encrypted, err := credentialcrypto.Encrypt(value)
			if err != nil {
				// No encryption key (e.g. fresh dev setup): leave the secret
				// to the environment fallback instead of storing plaintext.
				slog.Warn("app-settings seed skipped secret without encryption key", "key", key)
				continue
			}
			value = encrypted
		}
		_, err := s.db.ExecContext(ctx,
			`INSERT INTO app_settings (key, value, encrypted, updated_by, updated_at)
			 VALUES ($1, $2, $3, $4, now()) ON CONFLICT (key) DO NOTHING`,
			key, value, encrypt && value != "", actor)
		if err != nil {
			return seeded, fmt.Errorf("seed setting %q: %w", key, err)
		}
		seeded++
	}
	return seeded, nil
}

// EffectiveValue resolves the runtime value for a field: the DB row first,
// then the process environment. Empty DB values count as unset so clearing a
// row falls back exactly like an empty environment variable does.
func EffectiveValue(field Field, rows map[string]Setting, getenv func(string) string) string {
	if row, ok := rows[field.Key]; ok && strings.TrimSpace(row.Value) != "" {
		return row.Value
	}
	return strings.TrimSpace(getenv(field.Key))
}

// DisplayValueWithRow mirrors DisplayValue but prefers the DB row for
// db-stored fields.
func DisplayValueWithRow(field Field, rows map[string]Setting, getenv func(string) string) string {
	if field.StoredInDB() {
		if row, ok := rows[field.Key]; ok && strings.TrimSpace(row.Value) != "" {
			if field.Type == "secret" {
				return MaskedSecret
			}
			return row.Value
		}
	}
	return DisplayValue(field, getenv)
}

// DisplayValuesWithRow returns display values for every schema field,
// preferring DB rows where present.
func DisplayValuesWithRow(fields map[string]Field, rows map[string]Setting, getenv func(string) string) map[string]string {
	values := make(map[string]string, len(fields))
	for key, field := range fields {
		values[key] = DisplayValueWithRow(field, rows, getenv)
	}
	return values
}

// SecretSetWithRow reports whether a secret has a DB value or a non-empty
// process env value.
func SecretSetWithRow(key string, fields map[string]Field, rows map[string]Setting, getenv func(string) string) bool {
	if row, ok := rows[key]; ok && strings.TrimSpace(row.Value) != "" {
		return true
	}
	return SecretSet(key, getenv)
}
