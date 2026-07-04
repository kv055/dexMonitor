package tradingaccounts

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"commons/accounts"
	"commons/paymentmethods"
)

// ValidationError marks an error as rejected user input (mapped to HTTP 400
// by the API handlers), as opposed to an internal/database failure (500).
type ValidationError struct {
	err error
}

func (e ValidationError) Error() string { return e.err.Error() }
func (e ValidationError) Unwrap() error { return e.err }

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
	// Email is the email value for the account.
	Email *string `json:"email"`
	// Password is the password value for the account.
	Password *string `json:"password"`
	// Phone is the phone value for the account.
	Phone *string `json:"phone"`
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

// List returns recent records, capped by the requested limit.
func (r Repository) List(ctx context.Context) ([]Account, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id,
		       provider,
		       COALESCE(category, 'Uncategorized') AS category,
		       email,
		       password,
		       phone,
		       is_healthy,
		       last_health_check,
		       created_at,
		       updated_at
		FROM accounts
		ORDER BY category, provider, id
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
		var email, password, phone sql.NullString
		var lastHealthCheck sql.NullTime
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&account.ID, &account.Provider, &account.Category, &email, &password, &phone, &account.IsHealthy, &lastHealthCheck, &createdAt, &updatedAt); err != nil {
			return nil, err
		}
		account.Email = nullStringPtr(email)
		account.Password = nullStringPtr(password)
		account.Phone = nullStringPtr(phone)
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

// Create creates value.
func (r Repository) Create(ctx context.Context, payload AccountPayload) (int64, error) {
	provider := NormalizeProvider(payload.Provider)
	category := strings.TrimSpace(payload.Category)
	if category == "" {
		category = accounts.CategoryForProvider(provider)
	}
	email := strings.TrimSpace(payload.Email)
	if email != "" {
		if err := validateEmail(ctx, email); err != nil {
			return 0, err
		}
	}
	var id int64
	err := r.DB.QueryRowContext(ctx, `
		INSERT INTO accounts (provider, category, email, password, phone)
		VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''))
		RETURNING id
	`, provider, category, email, strings.TrimSpace(payload.Password), strings.TrimSpace(payload.Phone)).Scan(&id)
	return id, err
}

// Update replaces an account and its nested credentials.
func (r Repository) Update(ctx context.Context, id int64, payload AccountPayload) error {
	provider := NormalizeProvider(payload.Provider)
	category := strings.TrimSpace(payload.Category)
	if category == "" {
		category = accounts.CategoryForProvider(provider)
	}
	email := strings.TrimSpace(payload.Email)
	if email != "" {
		if err := validateEmail(ctx, email); err != nil {
			return err
		}
	}
	_, err := r.DB.ExecContext(ctx, `
		UPDATE accounts
		SET provider = $2,
		    category = NULLIF($3, ''),
		    email = NULLIF($4, ''),
		    password = NULLIF($5, ''),
		    phone = NULLIF($6, ''),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, provider, category, email, strings.TrimSpace(payload.Password), strings.TrimSpace(payload.Phone))
	return err
}

// Delete removes an account by provider and category.
func (r Repository) Delete(ctx context.Context, id int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM accounts WHERE id = $1`, id)
	return err
}

// CreateTOTPSecret creates a totpsecret.
func (r Repository) CreateTOTPSecret(ctx context.Context, accountID int64, payload TOTPSecretPayload) (int64, error) {
	var id int64
	err := r.DB.QueryRowContext(ctx, `
		INSERT INTO totp_secrets (account_id, secret, is_active)
		VALUES ($1, $2, $3)
		RETURNING id
	`, accountID, strings.TrimSpace(payload.Secret), payload.IsActive).Scan(&id)
	return id, err
}

// UpdateTOTPSecret stores a TOTP secret for an account.
func (r Repository) UpdateTOTPSecret(ctx context.Context, id int64, payload TOTPSecretPayload) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE totp_secrets
		SET secret = $2, is_active = $3
		WHERE id = $1
	`, id, strings.TrimSpace(payload.Secret), payload.IsActive)
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
	item.CreatedAt = formatTime(createdAt)
	item.RotatedAt = nullTimePtr(rotatedAt)
	return &item, nil
}

// CreatePasskey creates a passkey.
func (r Repository) CreatePasskey(ctx context.Context, accountID int64, payload PasskeyPayload) (int64, error) {
	var id int64
	err := r.DB.QueryRowContext(ctx, `
		INSERT INTO passkey_credentials (
			account_id, credential_id, rp_id, private_key_pkcs8, user_handle, sign_count, is_active, last_used_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, '')::timestamptz)
		RETURNING id
	`, accountID, payload.CredentialID, payload.RPID, payload.PrivateKeyPKCS8, payload.UserHandle, payload.SignCount, payload.IsActive, stringOrEmpty(payload.LastUsedAt)).Scan(&id)
	return id, err
}

// UpdatePasskey stores a passkey credential for an account.
func (r Repository) UpdatePasskey(ctx context.Context, id int64, payload PasskeyPayload) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE passkey_credentials
		SET credential_id = $2,
		    rp_id = $3,
		    private_key_pkcs8 = $4,
		    user_handle = $5,
		    sign_count = $6,
		    is_active = $7,
		    last_used_at = NULLIF($8, '')::timestamptz
		WHERE id = $1
	`, id, payload.CredentialID, payload.RPID, payload.PrivateKeyPKCS8, payload.UserHandle, payload.SignCount, payload.IsActive, stringOrEmpty(payload.LastUsedAt))
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
	item.CreatedAt = formatTime(createdAt)
	item.LastUsedAt = nullTimePtr(lastUsedAt)
	return &item, nil
}

// CreateSeed creates a seed.
func (r Repository) CreateSeed(ctx context.Context, accountID int64, payload SeedPayload) (int64, error) {
	var id int64
	err := r.DB.QueryRowContext(ctx, `
		INSERT INTO seeds (account_id, seed_phrase, wallet_created_at)
		VALUES ($1, $2, NULLIF($3, '')::timestamptz)
		RETURNING id
	`, accountID, payload.SeedPhrase, stringOrEmpty(payload.WalletCreatedAt)).Scan(&id)
	return id, err
}

// UpdateSeed stores a recovery seed for an account.
func (r Repository) UpdateSeed(ctx context.Context, id int64, payload SeedPayload) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE seeds
		SET seed_phrase = $2,
		    wallet_created_at = NULLIF($3, '')::timestamptz
		WHERE id = $1
	`, id, payload.SeedPhrase, stringOrEmpty(payload.WalletCreatedAt))
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
	var id int64
	err := r.DB.QueryRowContext(ctx, `
		INSERT INTO api_keys (account_id, name, api_key, api_secret, passphrase, is_active)
		VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6)
		RETURNING id
	`, accountID, payload.Name, payload.APIKey, stringOrEmpty(payload.APISecret), stringOrEmpty(payload.Passphrase), payload.IsActive).Scan(&id)
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
	_, err := r.DB.ExecContext(ctx, `
		UPDATE api_keys
		SET name = $2,
		    api_key = $3,
		    api_secret = NULLIF($4, ''),
		    passphrase = NULLIF($5, ''),
		    is_active = $6,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, payload.Name, payload.APIKey, stringOrEmpty(payload.APISecret), stringOrEmpty(payload.Passphrase), payload.IsActive)
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
	var id int64
	err = r.DB.QueryRowContext(ctx, `
		INSERT INTO bank_accounts (account_id, label, owner_name, currency, country, scheme, details, is_active)
		VALUES ($1, NULLIF($2, ''), $3, $4, NULLIF($5, ''), $6, $7, $8)
		RETURNING id
	`, accountID, strings.TrimSpace(payload.Label), strings.TrimSpace(payload.OwnerName),
		strings.ToUpper(strings.TrimSpace(payload.Currency)), strings.ToUpper(strings.TrimSpace(payload.Country)),
		strings.TrimSpace(payload.Scheme), detailsJSON, payload.IsActive).Scan(&id)
	return id, err
}

// UpdateBankAccount replaces a bank account.
func (r Repository) UpdateBankAccount(ctx context.Context, id int64, payload BankAccountPayload) error {
	if err := validateIBAN(payload.Details); err != nil {
		return err
	}
	detailsJSON, err := json.Marshal(payload.Details)
	if err != nil {
		return err
	}
	_, err = r.DB.ExecContext(ctx, `
		UPDATE bank_accounts
		SET label      = NULLIF($2, ''),
		    owner_name = $3,
		    currency   = $4,
		    country    = NULLIF($5, ''),
		    scheme     = $6,
		    details    = $7,
		    is_active  = $8,
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, strings.TrimSpace(payload.Label), strings.TrimSpace(payload.OwnerName),
		strings.ToUpper(strings.TrimSpace(payload.Currency)), strings.ToUpper(strings.TrimSpace(payload.Country)),
		strings.TrimSpace(payload.Scheme), detailsJSON, payload.IsActive)
	return err
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
	var detailsJSON []byte
	var createdAt, updatedAt time.Time
	err := r.DB.QueryRowContext(ctx, `
		SELECT id, account_id, label, owner_name, currency, country, scheme, details, is_active, created_at, updated_at
		FROM bank_accounts
		WHERE id = $1
	`, id).Scan(&item.ID, &item.AccountID, &label, &item.OwnerName, &item.Currency, &country,
		&item.Scheme, &detailsJSON, &item.IsActive, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	item.Label = nullStringPtr(label)
	item.Country = nullStringPtr(country)
	item.Details = decodeBankDetailsJSON(detailsJSON)
	item.CreatedAt = formatTime(createdAt)
	item.UpdatedAt = formatTime(updatedAt)
	return &item, nil
}

func (r Repository) appendBankAccounts(ctx context.Context, accs []Account, accountIndex map[int64]int, accountIDs []int64) error {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id, account_id, label, owner_name, currency, country, scheme, details, is_active, created_at, updated_at
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
		var detailsJSON []byte
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&item.ID, &item.AccountID, &label, &item.OwnerName, &item.Currency, &country,
			&item.Scheme, &detailsJSON, &item.IsActive, &createdAt, &updatedAt); err != nil {
			return err
		}
		item.Label = nullStringPtr(label)
		item.Country = nullStringPtr(country)
		item.Details = decodeBankDetailsJSON(detailsJSON)
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
