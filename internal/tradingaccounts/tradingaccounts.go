package tradingaccounts

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

type Account struct {
	ID                 int64        `json:"id"`
	Provider           string       `json:"provider"`
	Category           string       `json:"category"`
	Email              *string      `json:"email"`
	Password           *string      `json:"password"`
	Phone              *string      `json:"phone"`
	IsHealthy          bool         `json:"is_healthy"`
	LastHealthCheck    *string      `json:"last_health_check"`
	CreatedAt          string       `json:"created_at"`
	UpdatedAt          string       `json:"updated_at"`
	TOTPSecrets        []TOTPSecret `json:"totp_secrets"`
	PasskeyCredentials []Passkey    `json:"passkey_credentials"`
	Seeds              []Seed       `json:"seeds"`
	APIKeys            []APIKey     `json:"api_keys"`
}

type TOTPSecret struct {
	ID        int64   `json:"id"`
	AccountID int64   `json:"account_id"`
	Secret    string  `json:"secret"`
	IsActive  bool    `json:"is_active"`
	CreatedAt string  `json:"created_at"`
	RotatedAt *string `json:"rotated_at"`
}

type Passkey struct {
	ID              int64   `json:"id"`
	AccountID       int64   `json:"account_id"`
	CredentialID    string  `json:"credential_id"`
	RPID            string  `json:"rp_id"`
	PrivateKeyPKCS8 string  `json:"private_key_pkcs8"`
	UserHandle      string  `json:"user_handle"`
	SignCount       int64   `json:"sign_count"`
	IsActive        bool    `json:"is_active"`
	CreatedAt       string  `json:"created_at"`
	LastUsedAt      *string `json:"last_used_at"`
}

type Seed struct {
	ID              int64   `json:"id"`
	AccountID       int64   `json:"account_id"`
	SeedPhrase      string  `json:"seed_phrase"`
	WalletCreatedAt *string `json:"wallet_created_at"`
	CreatedAt       string  `json:"created_at"`
}

type APIKey struct {
	ID         int64   `json:"id"`
	AccountID  int64   `json:"account_id"`
	Name       string  `json:"name"`
	APIKey     string  `json:"api_key"`
	APISecret  *string `json:"api_secret"`
	Passphrase *string `json:"passphrase"`
	IsActive   bool    `json:"is_active"`
	CreatedAt  string  `json:"created_at"`
	UpdatedAt  string  `json:"updated_at"`
}

type AccountPayload struct {
	Provider string `json:"provider"`
	Email    string `json:"email"`
	Password string `json:"password"`
	Phone    string `json:"phone"`
}

type TOTPSecretPayload struct {
	Secret   string `json:"secret"`
	IsActive bool   `json:"is_active"`
}

type PasskeyPayload struct {
	CredentialID    string  `json:"credential_id"`
	RPID            string  `json:"rp_id"`
	PrivateKeyPKCS8 string  `json:"private_key_pkcs8"`
	UserHandle      string  `json:"user_handle"`
	SignCount       int64   `json:"sign_count"`
	IsActive        bool    `json:"is_active"`
	LastUsedAt      *string `json:"last_used_at"`
}

type SeedPayload struct {
	SeedPhrase      string  `json:"seed_phrase"`
	WalletCreatedAt *string `json:"wallet_created_at"`
}

type APIKeyPayload struct {
	Name       string  `json:"name"`
	APIKey     string  `json:"api_key"`
	APISecret  *string `json:"api_secret"`
	Passphrase *string `json:"passphrase"`
	IsActive   bool    `json:"is_active"`
}

type Repository struct {
	DB *sql.DB
}

func NewRepository(db *sql.DB) Repository {
	return Repository{DB: db}
}

func (r Repository) List(ctx context.Context) ([]Account, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id,
		       provider,
		       CASE
		           WHEN lower(provider) IN ('wise', 'paypal', 'revolut', 'n26') THEN 'Fiat Transmitter'
		           WHEN lower(provider) IN ('robosats', 'bisq', 'hodlhodl') THEN 'DEX'
		           WHEN lower(provider) IN ('kraken', 'coinbase', 'bitstamp', 'binance', 'bybit', 'kucoin', 'huobi') THEN 'CEX'
		           WHEN lower(provider) IN ('lnd', 'lnd wallet', 'lnd_wallet') THEN 'Internal Infrastructure'
		           ELSE 'Uncategorized'
		       END AS category,
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
	if err := r.appendAPIKeys(ctx, accounts, accountIndex, accountIDs); err != nil {
		return nil, err
	}

	return accounts, nil
}

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

func (r Repository) Create(ctx context.Context, payload AccountPayload) (int64, error) {
	provider := NormalizeProvider(payload.Provider)
	var id int64
	err := r.DB.QueryRowContext(ctx, `
		INSERT INTO accounts (provider, email, password, phone)
		VALUES ($1, NULLIF($2, ''), NULLIF($3, ''), NULLIF($4, ''))
		RETURNING id
	`, provider, strings.TrimSpace(payload.Email), strings.TrimSpace(payload.Password), strings.TrimSpace(payload.Phone)).Scan(&id)
	return id, err
}

func (r Repository) Update(ctx context.Context, id int64, payload AccountPayload) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE accounts
		SET provider = $2,
		    email = NULLIF($3, ''),
		    password = NULLIF($4, ''),
		    phone = NULLIF($5, ''),
		    updated_at = CURRENT_TIMESTAMP
		WHERE id = $1
	`, id, NormalizeProvider(payload.Provider), strings.TrimSpace(payload.Email), strings.TrimSpace(payload.Password), strings.TrimSpace(payload.Phone))
	return err
}

func (r Repository) Delete(ctx context.Context, id int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM accounts WHERE id = $1`, id)
	return err
}

func (r Repository) CreateTOTPSecret(ctx context.Context, accountID int64, payload TOTPSecretPayload) (int64, error) {
	var id int64
	err := r.DB.QueryRowContext(ctx, `
		INSERT INTO totp_secrets (account_id, secret, is_active)
		VALUES ($1, $2, $3)
		RETURNING id
	`, accountID, strings.TrimSpace(payload.Secret), payload.IsActive).Scan(&id)
	return id, err
}

func (r Repository) UpdateTOTPSecret(ctx context.Context, id int64, payload TOTPSecretPayload) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE totp_secrets
		SET secret = $2, is_active = $3
		WHERE id = $1
	`, id, strings.TrimSpace(payload.Secret), payload.IsActive)
	return err
}

func (r Repository) DeleteTOTPSecret(ctx context.Context, id int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM totp_secrets WHERE id = $1`, id)
	return err
}

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

func (r Repository) DeletePasskey(ctx context.Context, id int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM passkey_credentials WHERE id = $1`, id)
	return err
}

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

func (r Repository) CreateSeed(ctx context.Context, accountID int64, payload SeedPayload) (int64, error) {
	var id int64
	err := r.DB.QueryRowContext(ctx, `
		INSERT INTO seeds (account_id, seed_phrase, wallet_created_at)
		VALUES ($1, $2, NULLIF($3, '')::timestamptz)
		RETURNING id
	`, accountID, payload.SeedPhrase, stringOrEmpty(payload.WalletCreatedAt)).Scan(&id)
	return id, err
}

func (r Repository) UpdateSeed(ctx context.Context, id int64, payload SeedPayload) error {
	_, err := r.DB.ExecContext(ctx, `
		UPDATE seeds
		SET seed_phrase = $2,
		    wallet_created_at = NULLIF($3, '')::timestamptz
		WHERE id = $1
	`, id, payload.SeedPhrase, stringOrEmpty(payload.WalletCreatedAt))
	return err
}

func (r Repository) DeleteSeed(ctx context.Context, id int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM seeds WHERE id = $1`, id)
	return err
}

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

func (r Repository) DeleteAPIKey(ctx context.Context, id int64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM api_keys WHERE id = $1`, id)
	return err
}

func (r Repository) GetAPIKey(ctx context.Context, id int64) (*APIKey, error) {
	var item APIKey
	var apiSecret, passphrase sql.NullString
	var createdAt, updatedAt time.Time
	err := r.DB.QueryRowContext(ctx, `
		SELECT id, account_id, name, api_key, api_secret, passphrase, is_active, created_at, updated_at
		FROM api_keys
		WHERE id = $1
	`, id).Scan(&item.ID, &item.AccountID, &item.Name, &item.APIKey, &apiSecret, &passphrase, &item.IsActive, &createdAt, &updatedAt)
	if err != nil {
		return nil, err
	}
	item.APISecret = nullStringPtr(apiSecret)
	item.Passphrase = nullStringPtr(passphrase)
	item.CreatedAt = formatTime(createdAt)
	item.UpdatedAt = formatTime(updatedAt)
	return &item, nil
}

func (r Repository) IsRobosatsAccount(ctx context.Context, accountID int64) (bool, error) {
	var provider string
	if err := r.DB.QueryRowContext(ctx, `SELECT provider FROM accounts WHERE id = $1`, accountID).Scan(&provider); err != nil {
		return false, err
	}
	return NormalizeProvider(provider) == "Robosats", nil
}

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

func (r Repository) appendAPIKeys(ctx context.Context, accounts []Account, accountIndex map[int64]int, accountIDs []int64) error {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id, account_id, name, api_key, api_secret, passphrase, is_active, created_at, updated_at
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
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&item.ID, &item.AccountID, &item.Name, &item.APIKey, &apiSecret, &passphrase, &item.IsActive, &createdAt, &updatedAt); err != nil {
			return err
		}
		item.APISecret = nullStringPtr(apiSecret)
		item.Passphrase = nullStringPtr(passphrase)
		item.CreatedAt = formatTime(createdAt)
		item.UpdatedAt = formatTime(updatedAt)
		if index, ok := accountIndex[item.AccountID]; ok {
			accounts[index].APIKeys = append(accounts[index].APIKeys, item)
		}
	}
	return rows.Err()
}

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
	case "hodlhodl":
		return "HodlHodl"
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
