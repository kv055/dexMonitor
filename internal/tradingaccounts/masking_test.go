package tradingaccounts

import (
	"context"
	"database/sql"
	"encoding/base64"
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
		BankAccounts: []BankAccount{{
			OwnerName: "Alice Example",
			Details:   map[string]string{"iban": "DE89370400440532013000"},
		}},
	}
	MaskAccount(&acc)

	if *acc.Password != MaskedSecret {
		t.Errorf("password not masked: %q", *acc.Password)
	}
	if *acc.Email != MaskedSecret {
		t.Errorf("email not masked: %q", *acc.Email)
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
	if acc.APIKeys[0].APIKey != MaskedSecret {
		t.Errorf("api key must be masked")
	}
	if *acc.APIKeys[0].APISecret != MaskedSecret || *acc.APIKeys[0].Passphrase != MaskedSecret {
		t.Errorf("api secret/passphrase not masked")
	}
	if acc.BankAccounts[0].OwnerName != MaskedSecret || acc.BankAccounts[0].Details["iban"] != MaskedSecret {
		t.Errorf("bank owner/details not masked")
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
	t.Setenv("APP_ENCRYPTION_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
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
		CREATE TABLE totp_secrets (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			account_id INTEGER NOT NULL,
			secret TEXT NOT NULL,
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			rotated_at TIMESTAMP
		);
		CREATE TABLE bank_accounts (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			account_id INTEGER NOT NULL,
			label TEXT,
			owner_name TEXT NOT NULL,
			currency TEXT NOT NULL,
			country TEXT,
			scheme TEXT NOT NULL,
			details JSON NOT NULL,
			details_encrypted TEXT,
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
	if pw == "real-pass" || pw == "" {
		t.Errorf("password was not encrypted: %q", pw)
	}

	// A real value replaces it.
	if err := repo.Update(ctx, id, AccountPayload{Provider: "Kraken", Password: "new-pass"}); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT password FROM accounts WHERE id = $1`, id).Scan(&pw); err != nil {
		t.Fatal(err)
	}
	if pw == "new-pass" || pw == "" {
		t.Errorf("real password was not encrypted: %q", pw)
	}

	// Notification channels are normalized and can be cleared back to NULL.
	channels := NotificationChannels{"email", "push", "email"}
	if err := repo.Update(ctx, id, AccountPayload{
		Provider:             "Kraken",
		Password:             MaskedSecret,
		NotificationChannels: &channels,
	}); err != nil {
		t.Fatal(err)
	}
	var storedChannels sql.NullString
	if err := db.QueryRow(`SELECT notification_channels FROM accounts WHERE id = $1`, id).Scan(&storedChannels); err != nil {
		t.Fatal(err)
	}
	if !storedChannels.Valid || storedChannels.String != "{push,email}" {
		t.Errorf("notification_channels = %#v, want {push,email}", storedChannels)
	}

	noChannels := NotificationChannels{}
	if err := repo.Update(ctx, id, AccountPayload{
		Provider:             "Kraken",
		Password:             MaskedSecret,
		NotificationChannels: &noChannels,
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT notification_channels FROM accounts WHERE id = $1`, id).Scan(&storedChannels); err != nil {
		t.Fatal(err)
	}
	if storedChannels.Valid {
		t.Errorf("notification_channels = %q, want NULL", storedChannels.String)
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

	encryptedOwner, err := encryptSecret("Alice Example")
	if err != nil {
		t.Fatal(err)
	}
	encryptedDetails, err := encryptSecret(`{"iban":"DE89370400440532013000"}`)
	if err != nil {
		t.Fatal(err)
	}
	result, err := db.Exec(`
		INSERT INTO bank_accounts (account_id, owner_name, currency, country, scheme, details, details_encrypted, is_active)
		VALUES (?, ?, 'EUR', 'DE', 'iban_bic', '{}', ?, TRUE)
	`, id, encryptedOwner, encryptedDetails)
	if err != nil {
		t.Fatal(err)
	}
	bankID, err := result.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	var ownerName string
	if err := db.QueryRow(`SELECT owner_name FROM bank_accounts WHERE id = $1`, bankID).Scan(&ownerName); err != nil {
		t.Fatal(err)
	}
	if ownerName == "Alice Example" || ownerName == "" {
		t.Errorf("bank owner name was not encrypted: %q", ownerName)
	}
	bank, err := repo.GetBankAccount(ctx, bankID)
	if err != nil {
		t.Fatal(err)
	}
	if bank.OwnerName != "Alice Example" {
		t.Errorf("bank owner name = %q, want decrypted value", bank.OwnerName)
	}
}

func TestNotificationChannelsRejectUnsupportedValue(t *testing.T) {
	channels := NotificationChannels{"sms"}
	if _, err := channels.Value(); err == nil {
		t.Fatal("expected unsupported notification channel to fail validation")
	}
}
