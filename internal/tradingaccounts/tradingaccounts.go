package tradingaccounts

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"commons/accounts"
	"commons/paymentmethods"
	"dexmonitor/internal/credentialcrypto"
)

// MaskedSecret replaces stored secret material (passwords, TOTP secrets, seed
// phrases, API secrets, passkey private keys) in every API response. When an
// update payload carries this exact value the stored secret is kept unchanged,
// so a masked read can be round-tripped through an edit form without wiping
// the real credential. Secrets therefore never leave the server after being
// written; recovery requires direct database access.
const MaskedSecret = "***"

// MaskAccount replaces all secret material on an account in place.
func MaskAccount(a *Account) {
	if a == nil {
		return
	}
	if a.Password != nil && *a.Password != "" {
		masked := MaskedSecret
		a.Password = &masked
	}
	if a.Email != nil && *a.Email != "" {
		masked := MaskedSecret
		a.Email = &masked
	}
	if a.Phone != nil && *a.Phone != "" {
		masked := MaskedSecret
		a.Phone = &masked
	}
	if a.PaymentTag != nil && *a.PaymentTag != "" {
		masked := MaskedSecret
		a.PaymentTag = &masked
	}
	for i := range a.BankAccounts {
		MaskBankAccount(&a.BankAccounts[i])
	}
	for i := range a.TOTPSecrets {
		MaskTOTPSecret(&a.TOTPSecrets[i])
	}
	for i := range a.PasskeyCredentials {
		MaskPasskey(&a.PasskeyCredentials[i])
	}
	for i := range a.Seeds {
		MaskSeed(&a.Seeds[i])
	}
	for i := range a.APIKeys {
		MaskAPIKey(&a.APIKeys[i])
	}
}

// MaskAccounts replaces all secret material on a list of accounts in place.
func MaskAccounts(accs []Account) {
	for i := range accs {
		MaskAccount(&accs[i])
	}
}

// MaskTOTPSecret masks the shared secret of one TOTP entry in place.
func MaskTOTPSecret(t *TOTPSecret) {
	if t != nil && t.Secret != "" {
		t.Secret = MaskedSecret
	}
}

// MaskPasskey masks the private key of one passkey credential in place.
func MaskPasskey(p *Passkey) {
	if p != nil && p.PrivateKeyPKCS8 != "" {
		p.PrivateKeyPKCS8 = MaskedSecret
	}
}

// MaskSeed masks the phrase of one recovery seed in place.
func MaskSeed(s *Seed) {
	if s != nil && s.SeedPhrase != "" {
		s.SeedPhrase = MaskedSecret
	}
}

// MaskAPIKey masks the secret and passphrase of one API key in place. The key
// id stays visible: it identifies the credential in the UI and is unusable
// without the secret.
func MaskAPIKey(k *APIKey) {
	if k == nil {
		return
	}
	if k.APIKey != "" {
		k.APIKey = MaskedSecret
	}
	if k.APISecret != nil && *k.APISecret != "" {
		masked := MaskedSecret
		k.APISecret = &masked
	}
	if k.Passphrase != nil && *k.Passphrase != "" {
		masked := MaskedSecret
		k.Passphrase = &masked
	}
}

// MaskBankAccount hides payment-account identifiers and holder details while
// keeping non-sensitive account metadata usable in the UI.
func MaskBankAccount(b *BankAccount) {
	if b == nil {
		return
	}
	if b.OwnerName != "" {
		b.OwnerName = MaskedSecret
	}
	for key := range b.Details {
		b.Details[key] = MaskedSecret
	}
}

func encryptSecret(value string) (string, error) {
	return credentialcrypto.Encrypt(strings.TrimSpace(value))
}

func encryptOptionalSecret(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	encrypted, err := encryptSecret(*value)
	if err != nil {
		return nil, err
	}
	return &encrypted, nil
}

func decryptSecret(value string) (string, error) {
	return credentialcrypto.Decrypt(value)
}

func decryptOptionalSecret(value *string) error {
	if value == nil {
		return nil
	}
	decrypted, err := decryptSecret(*value)
	if err != nil {
		return err
	}
	*value = decrypted
	return nil
}

// ValidationError marks an error as rejected user input (mapped to HTTP 400
// by the API handlers), as opposed to an internal/database failure (500).
type ValidationError struct {
	err error
}

func (e ValidationError) Error() string { return e.err.Error() }
func (e ValidationError) Unwrap() error { return e.err }

// NotificationChannels contains the confirmed ways an incoming payment can
// be detected for an account. A nil slice is stored and returned as SQL/JSON
// null, meaning that no channel has been confirmed.
type NotificationChannels []string

var notificationChannelOrder = []string{"push", "email"}

// Scan implements sql.Scanner for PostgreSQL enum arrays.
func (channels *NotificationChannels) Scan(src any) error {
	if src == nil {
		*channels = nil
		return nil
	}
	var literal string
	switch value := src.(type) {
	case string:
		literal = value
	case []byte:
		literal = string(value)
	default:
		return fmt.Errorf("scan notification channels from %T", src)
	}
	literal = strings.TrimSpace(literal)
	if literal == "" || literal == "{}" {
		*channels = nil
		return nil
	}
	if len(literal) < 2 || literal[0] != '{' || literal[len(literal)-1] != '}' {
		return fmt.Errorf("invalid notification channels array %q", literal)
	}
	values := strings.Split(literal[1:len(literal)-1], ",")
	normalized, err := normalizeNotificationChannels(values)
	if err != nil {
		return err
	}
	*channels = normalized
	return nil
}

// Value implements driver.Valuer for PostgreSQL enum arrays.
func (channels NotificationChannels) Value() (driver.Value, error) {
	normalized, err := normalizeNotificationChannels(channels)
	if err != nil {
		return nil, err
	}
	if len(normalized) == 0 {
		return nil, nil
	}
	return "{" + strings.Join(normalized, ",") + "}", nil
}

func normalizeNotificationChannels(values []string) (NotificationChannels, error) {
	if len(values) == 0 {
		return nil, nil
	}
	present := make(map[string]bool, len(values))
	for _, raw := range values {
		channel := strings.Trim(strings.TrimSpace(raw), `"`)
		switch channel {
		case "push", "email":
			present[channel] = true
		default:
			return nil, ValidationError{fmt.Errorf("unsupported notification channel %q", channel)}
		}
	}
	normalized := make(NotificationChannels, 0, len(present))
	for _, channel := range notificationChannelOrder {
		if present[channel] {
			normalized = append(normalized, channel)
		}
	}
	return normalized, nil
}

// validateEmail checks format and (best-effort) domain deliverability for a
// non-empty email before it's persisted.
func validateEmail(ctx context.Context, email string) error {
	if err := paymentmethods.ValidateEmailFormat(email); err != nil {
		return ValidationError{err}
	}
	if err := paymentmethods.ValidateEmailDomain(ctx, email); err != nil {
		return ValidationError{err}
	}
	return nil
}

// validateIBAN checks the "iban" detail, if present, before it's persisted.
func validateIBAN(details map[string]string) error {
	iban := strings.TrimSpace(details["iban"])
	if iban == "" {
		return nil
	}
	if err := paymentmethods.ValidateIBAN(iban); err != nil {
		return ValidationError{err}
	}
	return nil
}

// Account is a stored trading-account profile and its credential metadata.
type Account struct {
	// ID identifies the account.
	ID int64 `json:"id"`
	// Provider is the provider value for the account.
	Provider string `json:"provider"`
	// Category is the category value for the account.
	Category string `json:"category"`
	// PaymentPriority ranks payment accounts; one is the highest priority.
	PaymentPriority int `json:"payment_priority"`
	// IsActive controls whether this payment account may be used for payments.
	IsActive bool `json:"is_active"`
	// NotificationChannels lists the confirmed incoming-payment alert paths.
	NotificationChannels NotificationChannels `json:"notification_channels"`
	// Email is the email value for the account.
	Email *string `json:"email"`
	// Password is the password value for the account.
	Password *string `json:"password"`
	// Phone is the phone value for the account.
	Phone *string `json:"phone"`
	// PaymentTag is the payment identifier shown to counterparties, such as a Revolut revtag or Wise tag.
	PaymentTag *string `json:"payment_tag"`
	// IsHealthy reports whether the account condition is true.
	IsHealthy bool `json:"is_healthy"`
	// LastHealthCheck is the last health check value for the account.
	LastHealthCheck *string `json:"last_health_check"`
	// CreatedAt records the relevant time for the account.
	CreatedAt string `json:"created_at"`
	// UpdatedAt records the relevant time for the account.
	UpdatedAt string `json:"updated_at"`
	// TOTPSecrets is the totpsecrets value for the account.
	TOTPSecrets []TOTPSecret `json:"totp_secrets"`
	// PasskeyCredentials is the passkey credentials value for the account.
	PasskeyCredentials []Passkey `json:"passkey_credentials"`
	// Seeds is the seeds value for the account.
	Seeds []Seed `json:"seeds"`
	// APIKeys is the apikeys value for the account.
	APIKeys []APIKey `json:"api_keys"`
	// AccountFileBackup is the latest Bisq UserPayload backup metadata, if any.
	AccountFileBackup *AccountFileBackup `json:"account_file_backup"`
	// LNDChannelBackup is the latest LND static channel backup metadata, if any.
	LNDChannelBackup *LNDChannelBackup `json:"lnd_channel_backup"`
	// BankAccounts is the list of payable bank accounts under this login.
	BankAccounts []BankAccount `json:"bank_accounts"`
}

// BankAccount is a payable bank account linked to an online-banking login.
type BankAccount struct {
	// ID identifies the bank account.
	ID int64 `json:"id"`
	// AccountID is the parent account.
	AccountID int64 `json:"account_id"`
	// Label is an optional human-readable name.
	Label *string `json:"label"`
	// OwnerName is the account holder name.
	OwnerName string `json:"owner_name"`
	// Currency is the ISO 4217 currency code.
	Currency string `json:"currency"`
	// Country is the ISO 3166-1 alpha-2 country code.
	Country *string `json:"country"`
	// Scheme identifies the payment scheme (e.g. iban_bic, us_ach).
	Scheme string `json:"scheme"`
	// Details holds scheme-specific fields (iban, bic, routing_number, …).
	Details map[string]string `json:"details"`
	// IsActive reports whether this bank account is active.
	IsActive bool `json:"is_active"`
	// CreatedAt records when the row was created.
	CreatedAt string `json:"created_at"`
	// UpdatedAt records when the row was last updated.
	UpdatedAt string `json:"updated_at"`
}

// BankAccountPayload is the editable payload for bank account create/update.
type BankAccountPayload struct {
	// Label is an optional human-readable name.
	Label string `json:"label"`
	// OwnerName is the account holder name.
	OwnerName string `json:"owner_name"`
	// Currency is the ISO 4217 currency code.
	Currency string `json:"currency"`
	// Country is the ISO 3166-1 alpha-2 country code.
	Country string `json:"country"`
	// Scheme identifies the payment scheme.
	Scheme string `json:"scheme"`
	// Details holds scheme-specific fields.
	Details map[string]string `json:"details"`
	// IsActive reports whether this bank account is active.
	IsActive bool `json:"is_active"`
}

// TOTPSecret represents a totpsecret.
type TOTPSecret struct {
	// ID identifies the totpsecret.
	ID int64 `json:"id"`
	// AccountID is the count associated with the totpsecret.
	AccountID int64 `json:"account_id"`
	// Secret is the secret value for the totpsecret.
	Secret string `json:"secret"`
	// IsActive reports whether the totpsecret condition is true.
	IsActive bool `json:"is_active"`
	// CreatedAt records the relevant time for the totpsecret.
	CreatedAt string `json:"created_at"`
	// RotatedAt records the relevant time for the totpsecret.
	RotatedAt *string `json:"rotated_at"`
}

// Passkey represents a passkey.
type Passkey struct {
	// ID identifies the passkey.
	ID int64 `json:"id"`
	// AccountID is the count associated with the passkey.
	AccountID int64 `json:"account_id"`
	// CredentialID is the credential id value for the passkey.
	CredentialID string `json:"credential_id"`
	// RPID is the rpid value for the passkey.
	RPID string `json:"rp_id"`
	// PrivateKeyPKCS8 is the private key pkcs8 value for the passkey.
	PrivateKeyPKCS8 string `json:"private_key_pkcs8"`
	// UserHandle is the user handle value for the passkey.
	UserHandle string `json:"user_handle"`
	// SignCount is the count associated with the passkey.
	SignCount int64 `json:"sign_count"`
	// IsActive reports whether the passkey condition is true.
	IsActive bool `json:"is_active"`
	// CreatedAt records the relevant time for the passkey.
	CreatedAt string `json:"created_at"`
	// LastUsedAt records the relevant time for the passkey.
	LastUsedAt *string `json:"last_used_at"`
}

// Seed represents a seed.
type Seed struct {
	// ID identifies the seed.
	ID int64 `json:"id"`
	// AccountID is the count associated with the seed.
	AccountID int64 `json:"account_id"`
	// SeedPhrase is the seed phrase value for the seed.
	SeedPhrase string `json:"seed_phrase"`
	// WalletCreatedAt records the relevant time for the seed.
	WalletCreatedAt *string `json:"wallet_created_at"`
	// CreatedAt records the relevant time for the seed.
	CreatedAt string `json:"created_at"`
}

// AccountFileBackup is metadata for the latest Bisq account file backup (UserPayload).
type AccountFileBackup struct {
	// ID identifies the backup row.
	ID int64 `json:"id"`
	// AccountID is the account associated with the backup.
	AccountID int64 `json:"account_id"`
	// FileName is the backed-up file name (e.g. UserPayload).
	FileName string `json:"file_name"`
	// FileSHA256 is the SHA-256 hash of the file contents.
	FileSHA256 string `json:"file_sha256"`
	// FileSizeBytes is the size of the backed-up file in bytes.
	FileSizeBytes int64 `json:"file_size_bytes"`
	// ModifiedAt is when the source file was last modified, if known.
	ModifiedAt *string `json:"modified_at"`
	// CreatedAt is when the backup row was stored.
	CreatedAt string `json:"created_at"`
}

// LatestBisqAccountFile returns the most recently stored Bisq account file,
// including its binary contents for an explicit download request.
func (r Repository) LatestBisqAccountFile(ctx context.Context, accountID int64) (string, []byte, error) {
	var fileName string
	var contents []byte
	err := r.DB.QueryRowContext(ctx, `
		SELECT file_name, contents
		FROM bisq_account_file_backups
		WHERE account_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT 1
	`, accountID).Scan(&fileName, &contents)
	return fileName, contents, err
}

// LNDChannelBackup is metadata for the latest LND static channel backup.
type LNDChannelBackup struct {
	// ID identifies the backup row.
	ID int64 `json:"id"`
	// AccountID is the account associated with the backup.
	AccountID int64 `json:"account_id"`
	// BackupSHA256 is the SHA-256 hash of the backup blob.
	BackupSHA256 string `json:"backup_sha256"`
	// BackupSizeBytes is the size of the backup blob in bytes.
	BackupSizeBytes int64 `json:"backup_size_bytes"`
	// ChannelCount is the number of channels covered by the backup.
	ChannelCount int `json:"channel_count"`
	// CreatedAt is when the backup row was stored.
	CreatedAt string `json:"created_at"`
}

// APIKey is a stored exchange or DEX API credential.
type APIKey struct {
	// ID identifies the apikey.
	ID int64 `json:"id"`
	// AccountID is the count associated with the apikey.
	AccountID int64 `json:"account_id"`
	// Name is the name value for the apikey.
	Name string `json:"name"`
	// APIKey is the apikey value for the apikey.
	APIKey string `json:"api_key"`
	// APISecret is the apisecret value for the apikey.
	APISecret *string `json:"api_secret"`
	// Passphrase is the passphrase value for the apikey.
	Passphrase *string `json:"passphrase"`
	// IsActive reports whether the apikey condition is true.
	IsActive bool `json:"is_active"`
	// Permissions stores normalized tri-state permission status
	// ("granted" | "denied" | "unsupported") from the latest health check.
	Permissions map[string]string `json:"permissions,omitempty"`
	// PermissionsCheckedAt records when permissions were last fetched from the exchange.
	PermissionsCheckedAt *string `json:"permissions_checked_at,omitempty"`
	// CreatedAt records the relevant time for the apikey.
	CreatedAt string `json:"created_at"`
	// UpdatedAt records the relevant time for the apikey.
	UpdatedAt string `json:"updated_at"`
}

// AccountPayload is the editable account payload accepted by monitor handlers.
type AccountPayload struct {
	// Provider is the provider value for the account payload.
	Provider string `json:"provider"`
	// Category overrides the derived category (required for Bank accounts).
	Category string `json:"category"`
	// Email is the email value for the account payload.
	Email string `json:"email"`
	// Password is the password value for the account payload.
	Password string `json:"password"`
	// Phone is the phone value for the account payload.
	Phone string `json:"phone"`
	// PaymentTag is the payment identifier shown to counterparties, such as a Revolut revtag or Wise tag.
	PaymentTag string `json:"payment_tag"`
	// NotificationChannels replaces the confirmed alert paths when present.
	// Omitting it preserves the current value during updates.
	NotificationChannels *NotificationChannels `json:"notification_channels"`
	// IsActive updates whether this payment account may be used for payments.
	// Omitting it preserves the current value during updates.
	IsActive *bool `json:"is_active"`
}

// CredentialReveal contains decrypted account credentials for an explicit
// authenticated reveal request.
type CredentialReveal struct {
	Email      string `json:"email"`
	Password   string `json:"password"`
	Phone      string `json:"phone"`
	PaymentTag string `json:"payment_tag"`
}

// TOTPSecretPayload represents a totpsecret payload.
type TOTPSecretPayload struct {
	// Secret is the secret value for the totpsecret payload.
	Secret string `json:"secret"`
	// IsActive reports whether the totpsecret payload condition is true.
	IsActive bool `json:"is_active"`
}

// PasskeyPayload represents a passkey payload.
type PasskeyPayload struct {
	// CredentialID is the credential id value for the passkey payload.
	CredentialID string `json:"credential_id"`
	// RPID is the rpid value for the passkey payload.
	RPID string `json:"rp_id"`
	// PrivateKeyPKCS8 is the private key pkcs8 value for the passkey payload.
	PrivateKeyPKCS8 string `json:"private_key_pkcs8"`
	// UserHandle is the user handle value for the passkey payload.
	UserHandle string `json:"user_handle"`
	// SignCount is the count associated with the passkey payload.
	SignCount int64 `json:"sign_count"`
	// IsActive reports whether the passkey payload condition is true.
	IsActive bool `json:"is_active"`
	// LastUsedAt records the relevant time for the passkey payload.
	LastUsedAt *string `json:"last_used_at"`
}

// SeedPayload represents a seed payload.
type SeedPayload struct {
	// SeedPhrase is the seed phrase value for the seed payload.
	SeedPhrase string `json:"seed_phrase"`
	// WalletCreatedAt records the relevant time for the seed payload.
	WalletCreatedAt *string `json:"wallet_created_at"`
}

// APIKeyPayload is the editable API-key payload accepted by monitor handlers.
type APIKeyPayload struct {
	// Name is the name value for the apikey payload.
	Name string `json:"name"`
	// APIKey is the apikey value for the apikey payload.
	APIKey string `json:"api_key"`
	// APISecret is the apisecret value for the apikey payload.
	APISecret *string `json:"api_secret"`
	// Passphrase is the passphrase value for the apikey payload.
	Passphrase *string `json:"passphrase"`
	// IsActive reports whether the apikey payload condition is true.
	IsActive bool `json:"is_active"`
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

// EncryptLegacySecrets upgrades plaintext credential rows in place. It is
// intentionally idempotent and keeps compatibility with databases created
// before application-level encryption was introduced.
func (r Repository) EncryptLegacySecrets(ctx context.Context) error {
	for _, target := range []struct{ table, column string }{
		{"accounts", "email"}, {"accounts", "password"}, {"accounts", "phone"}, {"accounts", "payment_tag"},
		{"bank_accounts", "owner_name"},
		{"totp_secrets", "secret"}, {"passkey_credentials", "private_key_pkcs8"}, {"seeds", "seed_phrase"}, // gitleaks:allow -- SQL identifiers, not credentials
		{"api_keys", "api_key"}, {"api_keys", "api_secret"}, {"api_keys", "passphrase"},
	} {
		rows, err := r.DB.QueryContext(ctx, "SELECT id, "+target.column+" FROM "+target.table+" WHERE "+target.column+" IS NOT NULL AND "+target.column+" <> '' AND "+target.column+" NOT LIKE 'enc:v1:%'")
		if err != nil {
			return fmt.Errorf("scan legacy %s.%s: %w", target.table, target.column, err)
		}
		for rows.Next() {
			var id int64
			var value string
			if err := rows.Scan(&id, &value); err != nil {
				rows.Close()
				return err
			}
			encrypted, err := encryptSecret(value)
			if err != nil {
				rows.Close()
				return err
			}
			if _, err := r.DB.ExecContext(ctx, "UPDATE "+target.table+" SET "+target.column+" = $1 WHERE id = $2", encrypted, id); err != nil {
				rows.Close()
				return err
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
	}
	rows, err := r.DB.QueryContext(ctx, `SELECT id, details FROM bank_accounts WHERE details_encrypted IS NULL AND details <> '{}'::jsonb`)
	if err != nil {
		return fmt.Errorf("scan legacy bank details: %w", err)
	}
	for rows.Next() {
		var id int64
		var details []byte
		if err := rows.Scan(&id, &details); err != nil {
			rows.Close()
			return err
		}
		encrypted, err := encryptSecret(string(details))
		if err != nil {
			rows.Close()
			return err
		}
		if _, err := r.DB.ExecContext(ctx, `UPDATE bank_accounts SET details = '{}'::jsonb, details_encrypted = $1 WHERE id = $2`, encrypted, id); err != nil {
			rows.Close()
			return err
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	return rows.Close()
}

// List returns recent records, capped by the requested limit.
func (r Repository) List(ctx context.Context) ([]Account, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id,
		       provider,
		       COALESCE(category, 'Uncategorized') AS category,
		       COALESCE(payment_priority, 0) AS payment_priority,
		       is_active,
		       email,
		       password,
		       phone,
		       payment_tag,
		       notification_channels,
		       is_healthy,
		       last_health_check,
		       created_at,
		       updated_at
		FROM accounts
		ORDER BY category, payment_priority NULLS LAST, provider, id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	accounts := make([]Account, 0)
	accountIDs := make([]int64, 0)
	accountIndex := make(map[int64]int)
	for rows.Next() {
		var account Account
		var email, password, phone, paymentTag sql.NullString
		var lastHealthCheck sql.NullTime
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&account.ID, &account.Provider, &account.Category, &account.PaymentPriority, &account.IsActive, &email, &password, &phone, &paymentTag, &account.NotificationChannels, &account.IsHealthy, &lastHealthCheck, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		account.Email = nullStringPtr(email)
		account.Password = nullStringPtr(password)
		account.Phone = nullStringPtr(phone)
		account.PaymentTag = nullStringPtr(paymentTag)
		for name, value := range map[string]*string{"email": account.Email, "password": account.Password, "phone": account.Phone, "payment tag": account.PaymentTag} {
			if err := decryptOptionalSecret(value); err != nil {
				return nil, fmt.Errorf("decrypt account %s: %w", name, err)
			}
		}
		account.LastHealthCheck = nullTimePtr(lastHealthCheck)
		account.CreatedAt = formatTime(createdAt)
		account.UpdatedAt = formatTime(updatedAt)
		account.TOTPSecrets = []TOTPSecret{}
		account.PasskeyCredentials = []Passkey{}
		account.Seeds = []Seed{}
		account.APIKeys = []APIKey{}
		account.BankAccounts = []BankAccount{}
		accounts = append(accounts, account)
		accountIDs = append(accountIDs, account.ID)
		accountIndex[account.ID] = len(accounts) - 1
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(accountIDs) == 0 {
		return accounts, nil
	}

	if err := r.appendTOTPSecrets(ctx, accounts, accountIndex, accountIDs); err != nil {
		return nil, err
	}
	if err := r.appendPasskeys(ctx, accounts, accountIndex, accountIDs); err != nil {
		return nil, err
	}
	if err := r.appendSeeds(ctx, accounts, accountIndex, accountIDs); err != nil {
		return nil, err
	}
	if err := r.appendLatestAccountFileBackups(ctx, accounts, accountIndex, accountIDs); err != nil {
		return nil, err
	}
	if err := r.appendLatestLNDChannelBackups(ctx, accounts, accountIndex, accountIDs); err != nil {
		return nil, err
	}
	if err := r.appendAPIKeys(ctx, accounts, accountIndex, accountIDs); err != nil {
		return nil, err
	}
	if err := r.appendBankAccounts(ctx, accounts, accountIndex, accountIDs); err != nil {
		return nil, err
	}

	return accounts, nil
}

// Get retrieves value.
func (r Repository) Get(ctx context.Context, id int64) (*Account, error) {
	accounts, err := r.List(ctx)
	if err != nil {
		return nil, err
	}
	for i := range accounts {
		if accounts[i].ID == id {
			return &accounts[i], nil
		}
	}
	return nil, sql.ErrNoRows
}

// RevealCredentials decrypts the account credential fields for an explicit
// authenticated reveal request. Legacy plaintext rows are returned unchanged.
func (r Repository) RevealCredentials(ctx context.Context, id int64) (CredentialReveal, error) {
	var reveal CredentialReveal
	if err := r.DB.QueryRowContext(ctx, `
		SELECT COALESCE(email, ''), COALESCE(password, ''), COALESCE(phone, '')
		FROM accounts WHERE id = $1`, id).Scan(&reveal.Email, &reveal.Password, &reveal.Phone); err != nil {
		return CredentialReveal{}, err
	}
	var err error
	if reveal.Email, err = credentialcrypto.Decrypt(reveal.Email); err != nil {
		return CredentialReveal{}, fmt.Errorf("decrypt account email: %w", err)
	}
	if reveal.Password, err = credentialcrypto.Decrypt(reveal.Password); err != nil {
		return CredentialReveal{}, fmt.Errorf("decrypt account password: %w", err)
	}
	if reveal.Phone, err = credentialcrypto.Decrypt(reveal.Phone); err != nil {
		return CredentialReveal{}, fmt.Errorf("decrypt account phone: %w", err)
	}
	var paymentTag string
	if err := r.DB.QueryRowContext(ctx, `SELECT COALESCE(payment_tag, '') FROM accounts WHERE id = $1`, id).Scan(&paymentTag); err != nil {
		return CredentialReveal{}, err
	}
	if reveal.PaymentTag, err = credentialcrypto.Decrypt(paymentTag); err != nil {
		return CredentialReveal{}, fmt.Errorf("decrypt account payment tag: %w", err)
	}
	return reveal, nil
}

// RevealAccountSecrets returns the fully decrypted account record for an
// explicit authenticated reveal request. Ordinary list/get API paths mask it.
func (r Repository) RevealAccountSecrets(ctx context.Context, id int64) (*Account, error) {
	return r.Get(ctx, id)
}

// Create creates value.
func (r Repository) Create(ctx context.Context, payload AccountPayload) (int64, error) {
	provider := NormalizeProvider(payload.Provider)
	category := strings.TrimSpace(payload.Category)
	if category == "" {
		category = accounts.CategoryForProvider(provider)
	}
	email := strings.TrimSpace(payload.Email)
	if email != "" && email != MaskedSecret {
		if err := validateEmail(ctx, email); err != nil {
			return 0, err
		}
	}
	password, err := encryptSecret(payload.Password)
	if err != nil {
		return 0, fmt.Errorf("encrypt account password: %w", err)
	}
	phone, err := encryptSecret(payload.Phone)
	if err != nil {
		return 0, fmt.Errorf("encrypt account phone: %w", err)
	}
	paymentTag, err := encryptSecret(payload.PaymentTag)
	if err != nil {
		return 0, fmt.Errorf("encrypt account payment tag: %w", err)
	}
	if email != "" {
		email, err = encryptSecret(email)
		if err != nil {
			return 0, fmt.Errorf("encrypt account email: %w", err)
		}
	}
	var notificationChannels NotificationChannels
	if payload.NotificationChannels != nil {
		notificationChannels, err = normalizeNotificationChannels(*payload.NotificationChannels)
		if err != nil {
			return 0, err
		}
	}
	var id int64
	err = r.DB.QueryRowContext(ctx, `
		INSERT INTO accounts (provider, category, email, password, phone, payment_tag, notification_channels, payment_priority, is_active)
		VALUES (
			$1, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), $7,
			CASE WHEN $2 IN ('Fiat Transmitter', 'Bank', 'Wallet addresses')
				THEN (SELECT COALESCE(MAX(payment_priority), 0) + 1 FROM accounts WHERE category IN ('Fiat Transmitter', 'Bank', 'Wallet addresses'))
				ELSE NULL END,
			TRUE
		)
		RETURNING id
	`, provider, category, email, password, phone, paymentTag, notificationChannels).Scan(&id)
	return id, err
}

// ReorderPaymentAccounts persists the supplied payment-account order. The
// first id receives priority one, which is the highest priority.
func (r Repository) ReorderPaymentAccounts(ctx context.Context, ids []int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, id := range ids {
		if _, err := tx.ExecContext(ctx, `
			UPDATE accounts
			SET payment_priority = $2, updated_at = CURRENT_TIMESTAMP
			WHERE id = $1 AND category IN ('Fiat Transmitter', 'Bank', 'Wallet addresses')
		`, id, i+1); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// Update replaces an account and its nested credentials.
func (r Repository) Update(ctx context.Context, id int64, payload AccountPayload) error {
	provider := NormalizeProvider(payload.Provider)
	category := strings.TrimSpace(payload.Category)
	if category == "" {
		category = accounts.CategoryForProvider(provider)
	}
	email := strings.TrimSpace(payload.Email)
	if email != "" && email != MaskedSecret {
		if err := validateEmail(ctx, email); err != nil {
			return err
		}
	}
	password := strings.TrimSpace(payload.Password)
	phone := strings.TrimSpace(payload.Phone)
	paymentTag := strings.TrimSpace(payload.PaymentTag)
	var err error
	if password != MaskedSecret {
		password, err = encryptSecret(password)
		if err != nil {
			return fmt.Errorf("encrypt account password: %w", err)
		}
	}
	if phone != MaskedSecret {
		phone, err = encryptSecret(phone)
		if err != nil {
			return fmt.Errorf("encrypt account phone: %w", err)
		}
	}
	if paymentTag != MaskedSecret {
		paymentTag, err = encryptSecret(paymentTag)
		if err != nil {
			return fmt.Errorf("encrypt account payment tag: %w", err)
		}
	}
	if email != MaskedSecret && email != "" {
		email, err = encryptSecret(email)
		if err != nil {
			return fmt.Errorf("encrypt account email: %w", err)
		}
	}
	var notificationChannels NotificationChannels
	replaceNotificationChannels := payload.NotificationChannels != nil
	if replaceNotificationChannels {
		notificationChannels, err = normalizeNotificationChannels(*payload.NotificationChannels)
		if err != nil {
			return err
		}
	}
	active := payload.IsActive != nil
	_, err = r.DB.ExecContext(ctx, `
		UPDATE accounts
		SET provider = $2,
		    category = NULLIF($3, ''),
		    email = CASE WHEN $4 = '`+MaskedSecret+`' THEN email ELSE NULLIF($4, '') END,
		    password = CASE WHEN $5 = '`+MaskedSecret+`' THEN password ELSE NULLIF($5, '') END,
		    phone = CASE WHEN $6 = '`+MaskedSecret+`' THEN phone ELSE NULLIF($6, '') END,
		    payment_tag = CASE WHEN $7 = '`+MaskedSecret+`' THEN payment_tag ELSE NULLIF($7, '') END,
		    notification_channels = CASE WHEN $9 THEN $8 ELSE notification_channels END,
		    is_active = CASE WHEN $10 THEN $11 ELSE is_active END,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, provider, category, email, password, phone, paymentTag, notificationChannels, replaceNotificationChannels, active, payload.IsActive)
	return err
}

// Delete removes an account by provider and category.
func (r Repository) Delete(ctx context.Context, id int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM accounts WHERE id = $1`, id)
	return err
}

// CreateTOTPSecret creates a totpsecret.
func (r Repository) CreateTOTPSecret(ctx context.Context, accountID int64, payload TOTPSecretPayload) (int64, error) {
	secret, err := encryptSecret(payload.Secret)
	if err != nil {
		return 0, fmt.Errorf("encrypt totp secret: %w", err)
	}
	var id int64
	err = r.DB.QueryRowContext(ctx, `
		INSERT INTO totp_secrets (account_id, secret, is_active)
		VALUES ($1, $2, $3)
		RETURNING id
	`, accountID, secret, payload.IsActive).Scan(&id)
	return id, err
}

// UpdateTOTPSecret stores a TOTP secret for an account.
func (r Repository) UpdateTOTPSecret(ctx context.Context, id int64, payload TOTPSecretPayload) error {
	secret := strings.TrimSpace(payload.Secret)
	var err error
	if secret != MaskedSecret {
		secret, err = encryptSecret(secret)
		if err != nil {
			return fmt.Errorf("encrypt totp secret: %w", err)
		}
	}
	_, err = r.DB.ExecContext(ctx, `
		UPDATE totp_secrets
		SET secret = CASE WHEN $2 = '`+MaskedSecret+`' THEN secret ELSE $2 END,
		    is_active = $3
		WHERE id = $1
	`, id, secret, payload.IsActive)
	return err
}

// DeleteTOTPSecret removes a TOTP secret from an account.
func (r Repository) DeleteTOTPSecret(ctx context.Context, id int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM totp_secrets WHERE id = $1`, id)
	return err
}

// GetTOTPSecret retrieves a totpsecret.
func (r Repository) GetTOTPSecret(ctx context.Context, id int64) (*TOTPSecret, error) {
	var item TOTPSecret
	var createdAt time.Time
	var rotatedAt sql.NullTime
	err := r.DB.QueryRowContext(ctx, `
		SELECT id, account_id, secret, is_active, created_at, rotated_at
		FROM totp_secrets
		WHERE id = $1
	`, id).Scan(&item.ID, &item.AccountID, &item.Secret, &item.IsActive, &createdAt, &rotatedAt)
	if err != nil {
		return nil, err
	}
	if item.Secret, err = decryptSecret(item.Secret); err != nil {
		return nil, err
	}
	item.CreatedAt = formatTime(createdAt)
	item.RotatedAt = nullTimePtr(rotatedAt)
	return &item, nil
}

// CreatePasskey creates a passkey.
func (r Repository) CreatePasskey(ctx context.Context, accountID int64, payload PasskeyPayload) (int64, error) {
	privateKey, err := encryptSecret(payload.PrivateKeyPKCS8)
	if err != nil {
		return 0, fmt.Errorf("encrypt passkey private key: %w", err)
	}
	var id int64
	err = r.DB.QueryRowContext(ctx, `
		INSERT INTO passkey_credentials (
			account_id, credential_id, rp_id, private_key_pkcs8, user_handle, sign_count, is_active, last_used_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, '')::timestamptz)
		RETURNING id
	`, accountID, payload.CredentialID, payload.RPID, privateKey, payload.UserHandle, payload.SignCount, payload.IsActive, stringOrEmpty(payload.LastUsedAt)).Scan(&id)
	return id, err
}

// UpdatePasskey stores a passkey credential for an account.
func (r Repository) UpdatePasskey(ctx context.Context, id int64, payload PasskeyPayload) error {
	privateKey := strings.TrimSpace(payload.PrivateKeyPKCS8)
	var err error
	if privateKey != MaskedSecret {
		privateKey, err = encryptSecret(privateKey)
		if err != nil {
			return fmt.Errorf("encrypt passkey private key: %w", err)
		}
	}
	_, err = r.DB.ExecContext(ctx, `
		UPDATE passkey_credentials
		SET credential_id = $2,
		    rp_id = $3,
		    private_key_pkcs8 = CASE WHEN $4 = '`+MaskedSecret+`' THEN private_key_pkcs8 ELSE $4 END,
		    user_handle = $5,
		    sign_count = $6,
		    is_active = $7,
		    last_used_at = NULLIF($8, '')::timestamptz
		WHERE id = $1
	`, id, payload.CredentialID, payload.RPID, privateKey, payload.UserHandle, payload.SignCount, payload.IsActive, stringOrEmpty(payload.LastUsedAt))
	return err
}

// DeletePasskey removes a passkey credential from an account.
func (r Repository) DeletePasskey(ctx context.Context, id int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM passkey_credentials WHERE id = $1`, id)
	return err
}

// GetPasskey retrieves a passkey.
func (r Repository) GetPasskey(ctx context.Context, id int64) (*Passkey, error) {
	var item Passkey
	var createdAt time.Time
	var lastUsedAt sql.NullTime
	err := r.DB.QueryRowContext(ctx, `
		SELECT id, account_id, credential_id, rp_id, private_key_pkcs8, user_handle, sign_count, is_active, created_at, last_used_at
		FROM passkey_credentials
		WHERE id = $1
	`, id).Scan(&item.ID, &item.AccountID, &item.CredentialID, &item.RPID, &item.PrivateKeyPKCS8, &item.UserHandle, &item.SignCount, &item.IsActive, &createdAt, &lastUsedAt)
	if err != nil {
		return nil, err
	}
	if item.PrivateKeyPKCS8, err = decryptSecret(item.PrivateKeyPKCS8); err != nil {
		return nil, err
	}
	item.CreatedAt = formatTime(createdAt)
	item.LastUsedAt = nullTimePtr(lastUsedAt)
	return &item, nil
}

// CreateSeed creates a seed.
func (r Repository) CreateSeed(ctx context.Context, accountID int64, payload SeedPayload) (int64, error) {
	seedPhrase, err := encryptSecret(payload.SeedPhrase)
	if err != nil {
		return 0, fmt.Errorf("encrypt seed phrase: %w", err)
	}
	var id int64
	err = r.DB.QueryRowContext(ctx, `
		INSERT INTO seeds (account_id, seed_phrase, wallet_created_at)
		VALUES ($1, $2, NULLIF($3, '')::timestamptz)
		RETURNING id
	`, accountID, seedPhrase, stringOrEmpty(payload.WalletCreatedAt)).Scan(&id)
	return id, err
}

// UpdateSeed stores a recovery seed for an account.
func (r Repository) UpdateSeed(ctx context.Context, id int64, payload SeedPayload) error {
	seedPhrase := strings.TrimSpace(payload.SeedPhrase)
	var err error
	if seedPhrase != MaskedSecret {
		seedPhrase, err = encryptSecret(seedPhrase)
		if err != nil {
			return fmt.Errorf("encrypt seed phrase: %w", err)
		}
	}
	_, err = r.DB.ExecContext(ctx, `
		UPDATE seeds
		SET seed_phrase = CASE WHEN $2 = '`+MaskedSecret+`' THEN seed_phrase ELSE $2 END,
		    wallet_created_at = NULLIF($3, '')::timestamptz
		WHERE id = $1
	`, id, seedPhrase, stringOrEmpty(payload.WalletCreatedAt))
	return err
}

// DeleteSeed removes a recovery seed from an account.
func (r Repository) DeleteSeed(ctx context.Context, id int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM seeds WHERE id = $1`, id)
	return err
}

// GetSeed retrieves a seed.
func (r Repository) GetSeed(ctx context.Context, id int64) (*Seed, error) {
	var item Seed
	var walletCreatedAt sql.NullTime
	var createdAt time.Time
	err := r.DB.QueryRowContext(ctx, `
		SELECT id, account_id, seed_phrase, wallet_created_at, created_at
		FROM seeds
		WHERE id = $1
	`, id).Scan(&item.ID, &item.AccountID, &item.SeedPhrase, &walletCreatedAt, &createdAt)
	if err != nil {
		return nil, err
	}
	if item.SeedPhrase, err = decryptSecret(item.SeedPhrase); err != nil {
		return nil, err
	}
	item.WalletCreatedAt = nullTimePtr(walletCreatedAt)
	item.CreatedAt = formatTime(createdAt)
	return &item, nil
}

// CreateAPIKey creates an apikey.
func (r Repository) CreateAPIKey(ctx context.Context, accountID int64, payload APIKeyPayload) (int64, error) {
	if robosats, err := r.IsRobosatsAccount(ctx, accountID); err != nil {
		return 0, err
	} else if robosats {
		payload.APISecret = nil
		payload.Passphrase = nil
	}
	apiKey, err := encryptSecret(payload.APIKey)
	if err != nil {
		return 0, fmt.Errorf("encrypt api key: %w", err)
	}
	apiSecret, err := encryptOptionalSecret(payload.APISecret)
	if err != nil {
		return 0, fmt.Errorf("encrypt api secret: %w", err)
	}
	passphrase, err := encryptOptionalSecret(payload.Passphrase)
	if err != nil {
		return 0, fmt.Errorf("encrypt api passphrase: %w", err)
	}
	var id int64
	err = r.DB.QueryRowContext(ctx, `
		INSERT INTO api_keys (account_id, name, api_key, api_secret, passphrase, is_active)
		VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6)
		RETURNING id
	`, accountID, payload.Name, apiKey, stringOrEmpty(apiSecret), stringOrEmpty(passphrase), payload.IsActive).Scan(&id)
	return id, err
}

// UpdateAPIKey stores an API key for an account.
func (r Repository) UpdateAPIKey(ctx context.Context, id int64, payload APIKeyPayload) error {
	if robosats, err := r.IsRobosatsAPIKey(ctx, id); err != nil {
		return err
	} else if robosats {
		payload.APISecret = nil
		payload.Passphrase = nil
	}
	apiKey := strings.TrimSpace(payload.APIKey)
	apiSecret := stringOrEmpty(payload.APISecret)
	passphrase := stringOrEmpty(payload.Passphrase)
	var err error
	if apiKey != MaskedSecret {
		apiKey, err = encryptSecret(apiKey)
		if err != nil {
			return fmt.Errorf("encrypt api key: %w", err)
		}
	}
	if apiSecret != MaskedSecret {
		apiSecret, err = encryptSecret(apiSecret)
		if err != nil {
			return fmt.Errorf("encrypt api secret: %w", err)
		}
	}
	if passphrase != MaskedSecret {
		passphrase, err = encryptSecret(passphrase)
		if err != nil {
			return fmt.Errorf("encrypt api passphrase: %w", err)
		}
	}
	_, err = r.DB.ExecContext(ctx, `
		UPDATE api_keys
		SET name = $2,
		    api_key = CASE WHEN $3 = '`+MaskedSecret+`' THEN api_key ELSE $3 END,
		    api_secret = CASE WHEN $4 = '`+MaskedSecret+`' THEN api_secret ELSE NULLIF($4, '') END,
		    passphrase = CASE WHEN $5 = '`+MaskedSecret+`' THEN passphrase ELSE NULLIF($5, '') END,
		    is_active = $6,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, payload.Name, apiKey, apiSecret, passphrase, payload.IsActive)
	return err
}

// DeleteAPIKey removes an API key from an account.
func (r Repository) DeleteAPIKey(ctx context.Context, id int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM api_keys WHERE id = $1`, id)
	return err
}

// GetAPIKey retrieves an apikey.
func (r Repository) GetAPIKey(ctx context.Context, id int64) (*APIKey, error) {
	var item APIKey
	var apiSecret, passphrase sql.NullString
	var createdAt, updatedAt time.Time
	var permissionsJSON []byte
	var permissionsCheckedAt sql.NullTime
	err := r.DB.QueryRowContext(ctx, `
		SELECT id, account_id, name, api_key, api_secret, passphrase, is_active, permissions, permissions_checked_at, created_at, updated_at
		FROM api_keys
		WHERE id = $1
	`, id).Scan(
		&item.ID, &item.AccountID, &item.Name, &item.APIKey, &apiSecret, &passphrase, &item.IsActive,
		&permissionsJSON, &permissionsCheckedAt, &createdAt, &updatedAt,
	)
	if err != nil {
		return nil, err
	}
	item.APISecret = nullStringPtr(apiSecret)
	item.Passphrase = nullStringPtr(passphrase)
	if item.APIKey, err = decryptSecret(item.APIKey); err != nil {
		return nil, err
	}
	if err := decryptOptionalSecret(item.APISecret); err != nil {
		return nil, err
	}
	if err := decryptOptionalSecret(item.Passphrase); err != nil {
		return nil, err
	}
	item.Permissions = decodePermissionsJSON(permissionsJSON)
	item.PermissionsCheckedAt = nullTimePtr(permissionsCheckedAt)
	item.CreatedAt = formatTime(createdAt)
	item.UpdatedAt = formatTime(updatedAt)
	return &item, nil
}

// IsRobosatsAccount reports whether the account belongs to RoboSats.
func (r Repository) IsRobosatsAccount(ctx context.Context, accountID int64) (bool, error) {
	var provider string
	if err := r.DB.QueryRowContext(ctx, `SELECT provider FROM accounts WHERE id = $1`, accountID).Scan(&provider); err != nil {
		return false, err
	}
	return NormalizeProvider(provider) == "Robosats", nil
}

// IsRobosatsAPIKey reports whether the API key is a RoboSats credential.
func (r Repository) IsRobosatsAPIKey(ctx context.Context, apiKeyID int64) (bool, error) {
	var provider string
	if err := r.DB.QueryRowContext(ctx, `
		SELECT accounts.provider
		FROM api_keys
		JOIN accounts ON accounts.id = api_keys.account_id
		WHERE api_keys.id = $1
	`, apiKeyID).Scan(&provider); err != nil {
		return false, err
	}
	return NormalizeProvider(provider) == "Robosats", nil
}

func (r Repository) appendTOTPSecrets(ctx context.Context, accounts []Account, accountIndex map[int64]int, accountIDs []int64) error {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id, account_id, secret, is_active, created_at, rotated_at
		FROM totp_secrets
		WHERE account_id = ANY($1)
		ORDER BY created_at DESC, id DESC
	`, accountIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item TOTPSecret
		var createdAt time.Time
		var rotatedAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.AccountID, &item.Secret, &item.IsActive, &createdAt, &rotatedAt); err != nil {
			return err
		}
		if item.Secret, err = decryptSecret(item.Secret); err != nil {
			return err
		}
		item.CreatedAt = formatTime(createdAt)
		item.RotatedAt = nullTimePtr(rotatedAt)
		if index, ok := accountIndex[item.AccountID]; ok {
			accounts[index].TOTPSecrets = append(accounts[index].TOTPSecrets, item)
		}
	}
	return rows.Err()
}

func (r Repository) appendPasskeys(ctx context.Context, accounts []Account, accountIndex map[int64]int, accountIDs []int64) error {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id, account_id, credential_id, rp_id, private_key_pkcs8, user_handle, sign_count, is_active, created_at, last_used_at
		FROM passkey_credentials
		WHERE account_id = ANY($1)
		ORDER BY created_at DESC, id DESC
	`, accountIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item Passkey
		var createdAt time.Time
		var lastUsedAt sql.NullTime
		if err := rows.Scan(&item.ID, &item.AccountID, &item.CredentialID, &item.RPID, &item.PrivateKeyPKCS8, &item.UserHandle, &item.SignCount, &item.IsActive, &createdAt, &lastUsedAt); err != nil {
			return err
		}
		if item.PrivateKeyPKCS8, err = decryptSecret(item.PrivateKeyPKCS8); err != nil {
			return err
		}
		item.CreatedAt = formatTime(createdAt)
		item.LastUsedAt = nullTimePtr(lastUsedAt)
		if index, ok := accountIndex[item.AccountID]; ok {
			accounts[index].PasskeyCredentials = append(accounts[index].PasskeyCredentials, item)
		}
	}
	return rows.Err()
}

func (r Repository) appendSeeds(ctx context.Context, accounts []Account, accountIndex map[int64]int, accountIDs []int64) error {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id, account_id, seed_phrase, wallet_created_at, created_at
		FROM seeds
		WHERE account_id = ANY($1)
		ORDER BY created_at DESC, id DESC
	`, accountIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item Seed
		var walletCreatedAt sql.NullTime
		var createdAt time.Time
		if err := rows.Scan(&item.ID, &item.AccountID, &item.SeedPhrase, &walletCreatedAt, &createdAt); err != nil {
			return err
		}
		if item.SeedPhrase, err = decryptSecret(item.SeedPhrase); err != nil {
			return err
		}
		item.WalletCreatedAt = nullTimePtr(walletCreatedAt)
		item.CreatedAt = formatTime(createdAt)
		if index, ok := accountIndex[item.AccountID]; ok {
			accounts[index].Seeds = append(accounts[index].Seeds, item)
		}
	}
	return rows.Err()
}

func (r Repository) appendLatestAccountFileBackups(ctx context.Context, accounts []Account, accountIndex map[int64]int, accountIDs []int64) error {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT DISTINCT ON (account_id)
			id, account_id, file_name, file_sha256, file_size_bytes, modified_at, created_at
		FROM bisq_account_file_backups
		WHERE account_id = ANY($1)
		ORDER BY account_id, created_at DESC, id DESC
	`, accountIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item AccountFileBackup
		var modifiedAt sql.NullTime
		var createdAt time.Time
		if err := rows.Scan(&item.ID, &item.AccountID, &item.FileName, &item.FileSHA256, &item.FileSizeBytes, &modifiedAt, &createdAt); err != nil {
			return err
		}
		item.ModifiedAt = nullTimePtr(modifiedAt)
		item.CreatedAt = formatTime(createdAt)
		if index, ok := accountIndex[item.AccountID]; ok {
			accounts[index].AccountFileBackup = &item
		}
	}
	return rows.Err()
}

func (r Repository) appendLatestLNDChannelBackups(ctx context.Context, accounts []Account, accountIndex map[int64]int, accountIDs []int64) error {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT DISTINCT ON (account_id)
			id, account_id, backup_sha256, backup_size_bytes, channel_count, created_at
		FROM lnd_channel_backups
		WHERE account_id = ANY($1)
		ORDER BY account_id, created_at DESC, id DESC
	`, accountIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item LNDChannelBackup
		var createdAt time.Time
		if err := rows.Scan(&item.ID, &item.AccountID, &item.BackupSHA256, &item.BackupSizeBytes, &item.ChannelCount, &createdAt); err != nil {
			return err
		}
		item.CreatedAt = formatTime(createdAt)
		if index, ok := accountIndex[item.AccountID]; ok {
			accounts[index].LNDChannelBackup = &item
		}
	}
	return rows.Err()
}

func (r Repository) appendAPIKeys(ctx context.Context, accounts []Account, accountIndex map[int64]int, accountIDs []int64) error {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id, account_id, name, api_key, api_secret, passphrase, is_active, permissions, permissions_checked_at, created_at, updated_at
		FROM api_keys
		WHERE account_id = ANY($1)
		ORDER BY updated_at DESC, id DESC
	`, accountIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item APIKey
		var apiSecret, passphrase sql.NullString
		var permissionsJSON []byte
		var permissionsCheckedAt sql.NullTime
		var createdAt, updatedAt time.Time
		if err := rows.Scan(
			&item.ID, &item.AccountID, &item.Name, &item.APIKey, &apiSecret, &passphrase, &item.IsActive,
			&permissionsJSON, &permissionsCheckedAt, &createdAt, &updatedAt,
		); err != nil {
			return err
		}
		decryptedAPIKey, err := decryptSecret(item.APIKey)
		if err != nil {
			return err
		}
		decryptedAPISecret, err := decryptSecret(apiSecret.String)
		if err != nil && apiSecret.Valid {
			return err
		}
		decryptedPassphrase, err := decryptSecret(passphrase.String)
		if err != nil && passphrase.Valid {
			return err
		}
		item.APIKey = decryptedAPIKey
		if apiSecret.Valid {
			apiSecret.String = decryptedAPISecret
		}
		if passphrase.Valid {
			passphrase.String = decryptedPassphrase
		}
		item.APISecret = nullStringPtr(apiSecret)
		item.Passphrase = nullStringPtr(passphrase)
		item.Permissions = decodePermissionsJSON(permissionsJSON)
		item.PermissionsCheckedAt = nullTimePtr(permissionsCheckedAt)
		item.CreatedAt = formatTime(createdAt)
		item.UpdatedAt = formatTime(updatedAt)
		if index, ok := accountIndex[item.AccountID]; ok {
			accounts[index].APIKeys = append(accounts[index].APIKeys, item)
		}
	}
	return rows.Err()
}

// CreateBankAccount creates a bank account under the given account.
func (r Repository) CreateBankAccount(ctx context.Context, accountID int64, payload BankAccountPayload) (int64, error) {
	if err := validateIBAN(payload.Details); err != nil {
		return 0, err
	}
	detailsJSON, err := json.Marshal(payload.Details)
	if err != nil {
		return 0, err
	}
	encryptedDetails, err := encryptSecret(string(detailsJSON))
	if err != nil {
		return 0, fmt.Errorf("encrypt bank account details: %w", err)
	}
	ownerName, err := encryptSecret(strings.TrimSpace(payload.OwnerName))
	if err != nil {
		return 0, fmt.Errorf("encrypt bank account owner name: %w", err)
	}
	var id int64
	err = r.DB.QueryRowContext(ctx, `
		INSERT INTO bank_accounts (account_id, label, owner_name, currency, country, scheme, details, details_encrypted, is_active)
		VALUES ($1, NULLIF($2, ''), $3, $4, NULLIF($5, ''), $6, '{}'::jsonb, $7, $8)
		RETURNING id
	`, accountID, strings.TrimSpace(payload.Label), ownerName,
		strings.ToUpper(strings.TrimSpace(payload.Currency)), strings.ToUpper(strings.TrimSpace(payload.Country)),
		strings.TrimSpace(payload.Scheme), encryptedDetails, payload.IsActive).Scan(&id)
	return id, err
}

// UpdateBankAccount replaces a bank account.
func (r Repository) UpdateBankAccount(ctx context.Context, id int64, payload BankAccountPayload) error {
	details, err := r.resolveBankDetails(ctx, id, payload.Details)
	if err != nil {
		return err
	}
	if err := validateIBAN(details); err != nil {
		return err
	}
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		return err
	}
	encryptedDetails, err := encryptSecret(string(detailsJSON))
	if err != nil {
		return fmt.Errorf("encrypt bank account details: %w", err)
	}
	ownerName := strings.TrimSpace(payload.OwnerName)
	if ownerName != MaskedSecret {
		ownerName, err = encryptSecret(ownerName)
		if err != nil {
			return fmt.Errorf("encrypt bank account owner name: %w", err)
		}
	}
	_, err = r.DB.ExecContext(ctx, `
		UPDATE bank_accounts
		SET label      = NULLIF($2, ''),
		    owner_name = CASE WHEN $3 = '`+MaskedSecret+`' THEN owner_name ELSE $3 END,
		    currency   = $4,
		    country    = NULLIF($5, ''),
		    scheme     = $6,
		    details    = '{}'::jsonb,
		    details_encrypted = $7,
		    is_active  = $8,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, strings.TrimSpace(payload.Label), ownerName,
		strings.ToUpper(strings.TrimSpace(payload.Currency)), strings.ToUpper(strings.TrimSpace(payload.Country)),
		strings.TrimSpace(payload.Scheme), encryptedDetails, payload.IsActive)
	return err
}

// resolveBankDetails merges masked fields from an edit round-trip with the
// stored plaintext before writing the new encrypted blob.
func (r Repository) resolveBankDetails(ctx context.Context, id int64, incoming map[string]string) (map[string]string, error) {
	needsStoredValue := false
	for _, value := range incoming {
		if value == MaskedSecret {
			needsStoredValue = true
			break
		}
	}
	if !needsStoredValue {
		return incoming, nil
	}
	var legacy, encrypted []byte
	if err := r.DB.QueryRowContext(ctx, `SELECT details, details_encrypted FROM bank_accounts WHERE id = $1`, id).Scan(&legacy, &encrypted); err != nil {
		return nil, err
	}
	stored, err := decryptBankDetails(encrypted, legacy)
	if err != nil {
		return nil, err
	}
	merged := make(map[string]string, len(incoming))
	for key, value := range incoming {
		if value == MaskedSecret {
			merged[key] = stored[key]
			continue
		}
		merged[key] = value
	}
	return merged, nil
}

// DeleteBankAccount removes a bank account.
func (r Repository) DeleteBankAccount(ctx context.Context, id int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM bank_accounts WHERE id = $1`, id)
	return err
}

// GetBankAccount retrieves a single bank account by id.
func (r Repository) GetBankAccount(ctx context.Context, id int64) (*BankAccount, error) {
	var item BankAccount
	var label, country sql.NullString
	var detailsJSON, encryptedDetails []byte
	var createdAt, updatedAt time.Time
	err := r.DB.QueryRowContext(ctx, `
		SELECT id, account_id, label, owner_name, currency, country, scheme, details, details_encrypted, is_active, created_at, updated_at
		FROM bank_accounts
		WHERE id = $1
	`, id).Scan(&item.ID, &item.AccountID, &label, &item.OwnerName, &item.Currency, &country,
		&item.Scheme, &detailsJSON, &encryptedDetails, &item.IsActive, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	item.Label = nullStringPtr(label)
	item.Country = nullStringPtr(country)
	item.OwnerName, err = decryptSecret(item.OwnerName)
	if err != nil {
		return nil, fmt.Errorf("decrypt bank account owner name: %w", err)
	}
	item.Details, err = decryptBankDetails(encryptedDetails, detailsJSON)
	if err != nil {
		return nil, err
	}
	item.CreatedAt = formatTime(createdAt)
	item.UpdatedAt = formatTime(updatedAt)
	return &item, nil
}

func (r Repository) appendBankAccounts(ctx context.Context, accs []Account, accountIndex map[int64]int, accountIDs []int64) error {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id, account_id, label, owner_name, currency, country, scheme, details, details_encrypted, is_active, created_at, updated_at
		FROM bank_accounts
		WHERE account_id = ANY($1)
		ORDER BY created_at ASC, id ASC
	`, accountIDs)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item BankAccount
		var label, country sql.NullString
		var detailsJSON, encryptedDetails []byte
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&item.ID, &item.AccountID, &label, &item.OwnerName, &item.Currency, &country,
			&item.Scheme, &detailsJSON, &encryptedDetails, &item.IsActive, &createdAt, &updatedAt); err != nil {
			return err
		}
		item.Label = nullStringPtr(label)
		item.Country = nullStringPtr(country)
		item.OwnerName, err = decryptSecret(item.OwnerName)
		if err != nil {
			return fmt.Errorf("decrypt bank account owner name: %w", err)
		}
		item.Details, err = decryptBankDetails(encryptedDetails, detailsJSON)
		if err != nil {
			return err
		}
		item.CreatedAt = formatTime(createdAt)
		item.UpdatedAt = formatTime(updatedAt)
		if index, ok := accountIndex[item.AccountID]; ok {
			accs[index].BankAccounts = append(accs[index].BankAccounts, item)
		}
	}
	return rows.Err()
}

func decodeBankDetailsJSON(raw []byte) map[string]string {
	if len(raw) == 0 {
		return map[string]string{}
	}
	var m map[string]string
	if err := json.Unmarshal(raw, &m); err != nil {
		return map[string]string{}
	}
	return m
}

func decryptBankDetails(encrypted, legacy []byte) (map[string]string, error) {
	if len(encrypted) > 0 {
		plain, err := decryptSecret(string(encrypted))
		if err != nil {
			return nil, fmt.Errorf("decrypt bank account details: %w", err)
		}
		return decodeBankDetailsJSON([]byte(plain)), nil
	}
	return decodeBankDetailsJSON(legacy), nil
}

// decodePermissionsJSON reads the stored permissions JSONB into the tri-state
// schema. It tolerates legacy rows whose values were booleans (written before the
// schema change) by coercing true→"granted" and false→"denied".
func decodePermissionsJSON(raw []byte) map[string]string {
	if len(raw) == 0 {
		return nil
	}
	var values map[string]json.RawMessage
	if err := json.Unmarshal(raw, &values); err != nil || len(values) == 0 {
		return nil
	}
	permissions := make(map[string]string, len(values))
	for name, value := range values {
		var status string
		if err := json.Unmarshal(value, &status); err == nil {
			permissions[name] = status
			continue
		}
		var granted bool
		if err := json.Unmarshal(value, &granted); err == nil {
			if granted {
				permissions[name] = "granted"
			} else {
				permissions[name] = "denied"
			}
		}
	}
	if len(permissions) == 0 {
		return nil
	}
	return permissions
}

// NormalizeProvider returns the canonical provider name used by storage and UI code.
func NormalizeProvider(value string) string {
	trimmed := strings.TrimSpace(value)
	switch strings.ToLower(trimmed) {
	case "wise":
		return "WISE"
	case "paypal":
		return "PayPal"
	case "revolut":
		return "Revolut"
	case "n26":
		return "N26"
	case "robosats":
		return "Robosats"
	case "bisq":
		return "Bisq"
	case "bisq2":
		return "Bisq2"
	case "hodlhodl":
		return "HodlHodl"
	case "peach", "peach bitcoin", "peachbitcoin":
		return "Peach"
	case "kraken":
		return "Kraken"
	case "coinbase":
		return "Coinbase"
	case "bitstamp":
		return "Bitstamp"
	case "binance":
		return "Binance"
	case "bybit":
		return "ByBit"
	case "kucoin":
		return "KuCoin"
	case "huobi":
		return "Huobi"
	case "lnd", "lnd wallet", "lnd_wallet":
		return "LND wallet"
	default:
		return trimmed
	}
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	v := value.String
	return &v
}

func nullTimePtr(value sql.NullTime) *string {
	if !value.Valid {
		return nil
	}
	v := formatTime(value.Time)
	return &v
}

func formatTime(value time.Time) string {
	return value.UTC().Format(time.RFC3339)
}

func stringOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}
