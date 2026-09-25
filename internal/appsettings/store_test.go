package appsettings

import (
	"context"
	"database/sql"
	"encoding/base64"
	"os"
	"reflect"
	"testing"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

func testDBFields() map[string]Field {
	return map[string]Field{
		"A_DB_STRING": {Key: "A_DB_STRING", Type: "string", Store: "db", Default: "dflt"},
		"A_DB_SECRET": {Key: "A_DB_SECRET", Type: "secret", Store: "db"},
		"A_FILE_FLAG": {Key: "A_FILE_FLAG", Type: "bool", Default: "false"},
	}
}

func TestPartitionKeys(t *testing.T) {
	db, file := PartitionKeys(
		[]string{"A_FILE_FLAG", "A_DB_SECRET", "A_DB_STRING"},
		testDBFields())
	if !reflect.DeepEqual(db, []string{"A_DB_SECRET", "A_DB_STRING"}) {
		t.Errorf("db = %v", db)
	}
	if !reflect.DeepEqual(file, []string{"A_FILE_FLAG"}) {
		t.Errorf("file = %v", file)
	}
}

func TestEffectiveValuePrefersDB(t *testing.T) {
	fields := testDBFields()
	rows := map[string]Setting{
		"A_DB_STRING": {Value: "from-db"},
		"A_DB_SECRET": {Value: "s3cr3t", Encrypted: true},
	}
	getenv := func(key string) string { return "from-env" }

	if got := EffectiveValue(fields["A_DB_STRING"], rows, getenv); got != "from-db" {
		t.Errorf("db string = %q", got)
	}
	if got := EffectiveValue(fields["A_DB_SECRET"], rows, getenv); got != "s3cr3t" {
		t.Errorf("db secret = %q", got)
	}
	// File-backed fields and empty rows fall back to the environment.
	if got := EffectiveValue(fields["A_FILE_FLAG"], rows, getenv); got != "from-env" {
		t.Errorf("file flag = %q", got)
	}
	rows["A_DB_STRING"] = Setting{Value: "  "}
	if got := EffectiveValue(fields["A_DB_STRING"], rows, getenv); got != "from-env" {
		t.Errorf("empty db row = %q, want env fallback", got)
	}
}

func TestDisplayValueWithRow(t *testing.T) {
	fields := testDBFields()
	rows := map[string]Setting{
		"A_DB_STRING": {Value: "from-db"},
		"A_DB_SECRET": {Value: "s3cr3t", Encrypted: true},
	}
	getenv := func(key string) string {
		if key == "A_FILE_FLAG" {
			return "true"
		}
		return ""
	}

	if got := DisplayValueWithRow(fields["A_DB_STRING"], rows, getenv); got != "from-db" {
		t.Errorf("db string display = %q", got)
	}
	if got := DisplayValueWithRow(fields["A_DB_SECRET"], rows, getenv); got != MaskedSecret {
		t.Errorf("db secret display = %q, want masked", got)
	}
	if got := DisplayValueWithRow(fields["A_FILE_FLAG"], rows, getenv); got != "true" {
		t.Errorf("file flag display = %q", got)
	}
	// Unset db field falls back to schema default via DisplayValue.
	if got := DisplayValueWithRow(fields["A_DB_STRING"], nil, func(string) string { return "" }); got != "dflt" {
		t.Errorf("unset db field display = %q, want default", got)
	}
}

func TestSecretSetWithRow(t *testing.T) {
	fields := testDBFields()
	if !SecretSetWithRow("A_DB_SECRET", fields,
		map[string]Setting{"A_DB_SECRET": {Value: "x", Encrypted: true}},
		func(string) string { return "" }) {
		t.Error("db secret row should count as set")
	}
	// Without a row the environment decides (empty here).
	if SecretSetWithRow("A_DB_SECRET", fields, nil, func(string) string { return "" }) {
		t.Error("empty secret should count as unset")
	}
}

// openTestPostgres connects to the database named by TEST_POSTGRES_URL,
// skipping when unreachable so unit runs without a database still pass.
// The SQLStore round-trip below runs in CI/prod-like environments.
func openTestPostgres(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("TEST_POSTGRES_URL")
	if url == "" {
		t.Skip("TEST_POSTGRES_URL not set")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Skipf("open test postgres: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		t.Skipf("postgres unreachable: %v", err)
	}
	return db
}

func TestSQLStoreRoundTrip(t *testing.T) {
	db := openTestPostgres(t)
	defer func() { _ = db.Close() }()
	ctx := context.Background()
	store := NewSQLStore(db)
	if err := store.EnsureSchema(ctx); err != nil {
		t.Fatalf("EnsureSchema: %v", err)
	}
	t.Setenv("APP_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))

	if err := store.Set(ctx, "T_ROUND_STRING", "hello", false, "tester"); err != nil {
		t.Fatalf("Set: %v", err)
	}
	if err := store.Set(ctx, "T_ROUND_SECRET", "s3cr3t", true, "tester"); err != nil {
		t.Fatalf("Set secret: %v", err)
	}
	rows, err := store.GetAll(ctx)
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if rows["T_ROUND_STRING"].Value != "hello" || rows["T_ROUND_STRING"].Encrypted {
		t.Errorf("string row = %+v", rows["T_ROUND_STRING"])
	}
	secret, ok := rows["T_ROUND_SECRET"]
	if !ok || secret.Value != "s3cr3t" || !secret.Encrypted {
		t.Errorf("secret row = %+v, present=%v", secret, ok)
	}
	if secret.UpdatedBy != "tester" {
		t.Errorf("updated_by = %q", secret.UpdatedBy)
	}

	// SeedMissing fills absent schema keys from env/defaults but never
	// overwrites existing rows.
	fields := map[string]Field{
		"T_ROUND_STRING": {Key: "T_ROUND_STRING", Type: "string", Store: "db"},
		"T_SEEDED":       {Key: "T_SEEDED", Type: "string", Store: "db", Default: "dflt"},
		"T_FILE":         {Key: "T_FILE", Type: "bool"},
	}
	t.Setenv("T_SEEDED", "from-env")
	seeded, err := store.SeedMissing(ctx, fields, os.Getenv, "seeder")
	if err != nil {
		t.Fatalf("SeedMissing: %v", err)
	}
	if seeded != 1 {
		t.Errorf("seeded = %d, want 1 (only T_SEEDED)", seeded)
	}
	rows, err = store.GetAll(ctx)
	if err != nil {
		t.Fatalf("GetAll: %v", err)
	}
	if rows["T_SEEDED"].Value != "from-env" {
		t.Errorf("seeded value = %q", rows["T_SEEDED"].Value)
	}
	if rows["T_ROUND_STRING"].Value != "hello" {
		t.Errorf("seed overwrote existing row: %q", rows["T_ROUND_STRING"].Value)
	}

	_, _ = db.ExecContext(ctx, `DELETE FROM app_settings WHERE key IN ('T_ROUND_STRING','T_ROUND_SECRET','T_SEEDED')`)
}
