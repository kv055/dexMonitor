package tradingaccounts

import (
	"context"
	"database/sql"
	"encoding/base64"
	"testing"

	_ "modernc.org/sqlite"
)

func openPaymentPriorityTestDB(t *testing.T) (*sql.DB, Repository) {
	t.Helper()
	t.Setenv("APP_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	db, err := sql.Open("sqlite", t.TempDir()+"/accounts.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`
		CREATE TABLE accounts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			provider TEXT NOT NULL,
			category TEXT,
			payment_priority INTEGER,
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			email TEXT,
			password TEXT,
			phone TEXT,
			payment_tag TEXT,
			notification_channels TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);
	`); err != nil {
		t.Fatal(err)
	}
	return db, NewRepository(db)
}

func paymentPriority(t *testing.T, db *sql.DB, id int64) sql.NullInt64 {
	t.Helper()
	var priority sql.NullInt64
	if err := db.QueryRow(`SELECT payment_priority FROM accounts WHERE id = $1`, id).Scan(&priority); err != nil {
		t.Fatal(err)
	}
	return priority
}

func TestDeleteCompactsPaymentPriorities(t *testing.T) {
	db, repo := openPaymentPriorityTestDB(t)
	ctx := context.Background()

	id1, err := repo.Create(ctx, AccountPayload{Provider: "Revolut", Category: "Fiat Transmitter", Password: "a"})
	if err != nil {
		t.Fatal(err)
	}
	id2, err := repo.Create(ctx, AccountPayload{Provider: "WISE", Category: "Fiat Transmitter", Password: "b"})
	if err != nil {
		t.Fatal(err)
	}
	id3, err := repo.Create(ctx, AccountPayload{Provider: "N26", Category: "Fiat Transmitter", Password: "c"})
	if err != nil {
		t.Fatal(err)
	}

	if got := paymentPriority(t, db, id1); !got.Valid || got.Int64 != 1 {
		t.Fatalf("id1 priority = %#v, want 1", got)
	}
	if got := paymentPriority(t, db, id2); !got.Valid || got.Int64 != 2 {
		t.Fatalf("id2 priority = %#v, want 2", got)
	}
	if got := paymentPriority(t, db, id3); !got.Valid || got.Int64 != 3 {
		t.Fatalf("id3 priority = %#v, want 3", got)
	}

	if err := repo.Delete(ctx, id2); err != nil {
		t.Fatal(err)
	}

	if got := paymentPriority(t, db, id1); !got.Valid || got.Int64 != 1 {
		t.Fatalf("after delete id1 priority = %#v, want 1", got)
	}
	if got := paymentPriority(t, db, id3); !got.Valid || got.Int64 != 2 {
		t.Fatalf("after delete id3 priority = %#v, want 2 (compacted), not a hole at 2", got)
	}
}

func TestUpdateLeavingPaymentSetClearsAndCompacts(t *testing.T) {
	db, repo := openPaymentPriorityTestDB(t)
	ctx := context.Background()

	id1, err := repo.Create(ctx, AccountPayload{Provider: "Revolut", Category: "Fiat Transmitter", Password: "a"})
	if err != nil {
		t.Fatal(err)
	}
	id2, err := repo.Create(ctx, AccountPayload{Provider: "WISE", Category: "Fiat Transmitter", Password: "b"})
	if err != nil {
		t.Fatal(err)
	}
	id3, err := repo.Create(ctx, AccountPayload{Provider: "N26", Category: "Fiat Transmitter", Password: "c"})
	if err != nil {
		t.Fatal(err)
	}

	if err := repo.Update(ctx, id2, AccountPayload{
		Provider: "Kraken",
		Category: "CEX",
		Password: MaskedSecret,
	}); err != nil {
		t.Fatal(err)
	}

	if got := paymentPriority(t, db, id2); got.Valid {
		t.Fatalf("demoted account payment_priority = %#v, want NULL", got)
	}
	if got := paymentPriority(t, db, id1); !got.Valid || got.Int64 != 1 {
		t.Fatalf("id1 priority = %#v, want 1", got)
	}
	if got := paymentPriority(t, db, id3); !got.Valid || got.Int64 != 2 {
		t.Fatalf("id3 priority = %#v, want 2 after compact", got)
	}
}

func TestUpdateEnteringPaymentSetAssignsNextPriority(t *testing.T) {
	db, repo := openPaymentPriorityTestDB(t)
	ctx := context.Background()

	id1, err := repo.Create(ctx, AccountPayload{Provider: "Revolut", Category: "Fiat Transmitter", Password: "a"})
	if err != nil {
		t.Fatal(err)
	}
	id2, err := repo.Create(ctx, AccountPayload{Provider: "Kraken", Category: "CEX", Password: "b"})
	if err != nil {
		t.Fatal(err)
	}

	if got := paymentPriority(t, db, id2); got.Valid {
		t.Fatalf("CEX account payment_priority = %#v, want NULL", got)
	}

	if err := repo.Update(ctx, id2, AccountPayload{
		Provider: "WISE",
		Category: "Fiat Transmitter",
		Password: MaskedSecret,
	}); err != nil {
		t.Fatal(err)
	}

	if got := paymentPriority(t, db, id1); !got.Valid || got.Int64 != 1 {
		t.Fatalf("id1 priority = %#v, want 1", got)
	}
	if got := paymentPriority(t, db, id2); !got.Valid || got.Int64 != 2 {
		t.Fatalf("promoted account priority = %#v, want 2", got)
	}
}

func TestCompactPaymentPrioritiesHealsExistingGaps(t *testing.T) {
	db, repo := openPaymentPriorityTestDB(t)
	ctx := context.Background()

	id1, err := repo.Create(ctx, AccountPayload{Provider: "Revolut", Category: "Fiat Transmitter", Password: "a"})
	if err != nil {
		t.Fatal(err)
	}
	id2, err := repo.Create(ctx, AccountPayload{Provider: "WISE", Category: "Fiat Transmitter", Password: "b"})
	if err != nil {
		t.Fatal(err)
	}
	id3, err := repo.Create(ctx, AccountPayload{Provider: "N26", Category: "Fiat Transmitter", Password: "c"})
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a pre-compaction delete hole: remove middle row without compacting.
	if _, err := db.Exec(`DELETE FROM accounts WHERE id = $1`, id2); err != nil {
		t.Fatal(err)
	}
	if got := paymentPriority(t, db, id3); !got.Valid || got.Int64 != 3 {
		t.Fatalf("precondition: id3 priority = %#v, want 3 (hole at 2)", got)
	}

	if err := compactPaymentPriorities(ctx, db); err != nil {
		t.Fatal(err)
	}
	if got := paymentPriority(t, db, id1); !got.Valid || got.Int64 != 1 {
		t.Fatalf("id1 priority = %#v, want 1", got)
	}
	if got := paymentPriority(t, db, id3); !got.Valid || got.Int64 != 2 {
		t.Fatalf("id3 priority = %#v, want 2 after heal", got)
	}
}
