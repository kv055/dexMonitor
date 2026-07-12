package tradingaccounts

import (
	"context"
	"database/sql"
	"testing"

	_ "modernc.org/sqlite"
)

func strPtr(s string) *string { return &s }

func TestMaskAccount(t *testing.T) {
	acc := Account{
		Password: strPtr("hunter2"),
		Email:    strPtr("a@b.c"),
		TOTPSecrets: []TOTPSecret{
			{Secret: "JBSWY3DP"},
			{Secret: ""},
		},
		PasskeyCredentials: []Passkey{{CredentialID: "cred", PrivateKeyPKCS8: "pkcs8"}},
		Seeds:              []Seed{{SeedPhrase: "abandon abandon"}},
		APIKeys: []APIKey{{
			APIKey:     "key-id",
			APISecret:  strPtr("sec"),
			Passphrase: strPtr("pp"),
		}},
	}
	MaskAccount(&acc)

	if *acc.Password != MaskedSecret {
		t.Errorf("password not masked: %q", *acc.Password)
	}
	if *acc.Email != "a@b.c" {
		t.Errorf("email must stay readable: %q", *acc.Email)
	}
	if acc.TOTPSecrets[0].Secret != MaskedSecret {
		t.Errorf("totp secret not masked: %q", acc.TOTPSecrets[0].Secret)
	}
	if acc.TOTPSecrets[1].Secret != "" {
		t.Errorf("empty totp secret must stay empty")
	}
	if acc.PasskeyCredentials[0].PrivateKeyPKCS8 != MaskedSecret {
		t.Errorf("passkey private key not masked")
	}
	if acc.PasskeyCredentials[0].CredentialID != "cred" {
		t.Errorf("credential id must stay readable")
	}
	if acc.Seeds[0].SeedPhrase != MaskedSecret {
		t.Errorf("seed phrase not masked")
	}
	if acc.APIKeys[0].APIKey != "key-id" {
		t.Errorf("api key id must stay readable")
	}
	if *acc.APIKeys[0].APISecret != MaskedSecret || *acc.APIKeys[0].Passphrase != MaskedSecret {
		t.Errorf("api secret/passphrase not masked")
	}

	// nil-safe
	MaskAccount(nil)
	MaskTOTPSecret(nil)
	MaskPasskey(nil)
	MaskSeed(nil)
	MaskAPIKey(nil)
}

// TestUpdateKeepsMaskedSecrets verifies that echoing MaskedSecret back on an
// update leaves the stored secret untouched (the round-trip safety property
// the frontend edit forms rely on), while a real new value replaces it.
func TestUpdateKeepsMaskedSecrets(t *testing.T) {
	db, err := sql.Open("sqlite", t.TempDir()+"/accounts.db")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()

	if _, err := db.Exec(`
		CREATE TABLE accounts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			provider TEXT NOT NULL,
			category TEXT,
			email TEXT,
			password TEXT,
			phone TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		);
		CREATE TABLE totp_secrets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			account_id INTEGER NOT NULL,
			secret TEXT NOT NULL,
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			rotated_at TIMESTAMP
		);
	`); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db)
	id, err := repo.Create(ctx, AccountPayload{Provider: "Kraken", Password: "real-pass"})
	if err != nil {
		t.Fatal(err)
	}

	// Echoing the mask keeps the stored password.
	if err := repo.Update(ctx, id, AccountPayload{Provider: "Kraken", Password: MaskedSecret}); err != nil {
		t.Fatal(err)
	}
	var pw string
	if err := db.QueryRow(`SELECT password FROM accounts WHERE id = $1`, id).Scan(&pw); err != nil {
		t.Fatal(err)
	}
	if pw != "real-pass" {
		t.Errorf("masked update overwrote password: %q", pw)
	}

	// A real value replaces it.
	if err := repo.Update(ctx, id, AccountPayload{Provider: "Kraken", Password: "new-pass"}); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT password FROM accounts WHERE id = $1`, id).Scan(&pw); err != nil {
		t.Fatal(err)
	}
	if pw != "new-pass" {
		t.Errorf("real update did not replace password: %q", pw)
	}

	// Same round-trip property for TOTP secrets.
	totpID, err := repo.CreateTOTPSecret(ctx, id, TOTPSecretPayload{Secret: "JBSWY3DP", IsActive: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdateTOTPSecret(ctx, totpID, TOTPSecretPayload{Secret: MaskedSecret, IsActive: false}); err != nil {
		t.Fatal(err)
	}
	row, err := repo.GetTOTPSecret(ctx, totpID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Secret != "JBSWY3DP" {
		t.Errorf("masked update overwrote totp secret: %q", row.Secret)
	}
	if row.IsActive {
		t.Errorf("non-secret field must still update")
	}
}
