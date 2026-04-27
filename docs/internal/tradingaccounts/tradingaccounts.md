# `internal/tradingaccounts/tradingaccounts.go`

Source package: `tradingaccounts`  
Source lines: `715`

## Package Purpose

This file contributes to the `tradingaccounts` package.

## File Role

This file defines 11 type(s), implements 33 function or method entry point(s).

## Runtime Behavior

- Reads from or writes to persistent storage.
- Serializes or deserializes JSON payloads.
- Uses time windows, timestamps, or duration calculations.
- Accepts context for cancellation, deadlines, or request scoping.

## Types

### `Account`

Account is a stored trading-account profile and its credential metadata.

Fields:

- `ID` `int64`: ID identifies the account.
- `Provider` `string`: Provider is the provider value for the account.
- `Category` `string`: Category is the category value for the account.
- `Email` `*string`: Email is the email value for the account.
- `Password` `*string`: Password is the password value for the account.
- `Phone` `*string`: Phone is the phone value for the account.
- `IsHealthy` `bool`: IsHealthy reports whether the account condition is true.
- `LastHealthCheck` `*string`: LastHealthCheck is the last health check value for the account.
- `CreatedAt` `string`: CreatedAt records the relevant time for the account.
- `UpdatedAt` `string`: UpdatedAt records the relevant time for the account.
- `TOTPSecrets` `[]TOTPSecret`: TOTPSecrets is the totpsecrets value for the account.
- `PasskeyCredentials` `[]Passkey`: PasskeyCredentials is the passkey credentials value for the account.
- `Seeds` `[]Seed`: Seeds is the seeds value for the account.
- `APIKeys` `[]APIKey`: APIKeys is the apikeys value for the account.

### `TOTPSecret`

TOTPSecret represents a totpsecret.

Fields:

- `ID` `int64`: ID identifies the totpsecret.
- `AccountID` `int64`: AccountID is the count associated with the totpsecret.
- `Secret` `string`: Secret is the secret value for the totpsecret.
- `IsActive` `bool`: IsActive reports whether the totpsecret condition is true.
- `CreatedAt` `string`: CreatedAt records the relevant time for the totpsecret.
- `RotatedAt` `*string`: RotatedAt records the relevant time for the totpsecret.

### `Passkey`

Passkey represents a passkey.

Fields:

- `ID` `int64`: ID identifies the passkey.
- `AccountID` `int64`: AccountID is the count associated with the passkey.
- `CredentialID` `string`: CredentialID is the credential id value for the passkey.
- `RPID` `string`: RPID is the rpid value for the passkey.
- `PrivateKeyPKCS8` `string`: PrivateKeyPKCS8 is the private key pkcs8 value for the passkey.
- `UserHandle` `string`: UserHandle is the user handle value for the passkey.
- `SignCount` `int64`: SignCount is the count associated with the passkey.
- `IsActive` `bool`: IsActive reports whether the passkey condition is true.
- `CreatedAt` `string`: CreatedAt records the relevant time for the passkey.
- `LastUsedAt` `*string`: LastUsedAt records the relevant time for the passkey.

### `Seed`

Seed represents a seed.

Fields:

- `ID` `int64`: ID identifies the seed.
- `AccountID` `int64`: AccountID is the count associated with the seed.
- `SeedPhrase` `string`: SeedPhrase is the seed phrase value for the seed.
- `WalletCreatedAt` `*string`: WalletCreatedAt records the relevant time for the seed.
- `CreatedAt` `string`: CreatedAt records the relevant time for the seed.

### `APIKey`

APIKey is a stored exchange or DEX API credential.

Fields:

- `ID` `int64`: ID identifies the apikey.
- `AccountID` `int64`: AccountID is the count associated with the apikey.
- `Name` `string`: Name is the name value for the apikey.
- `APIKey` `string`: APIKey is the apikey value for the apikey.
- `APISecret` `*string`: APISecret is the apisecret value for the apikey.
- `Passphrase` `*string`: Passphrase is the passphrase value for the apikey.
- `IsActive` `bool`: IsActive reports whether the apikey condition is true.
- `CreatedAt` `string`: CreatedAt records the relevant time for the apikey.
- `UpdatedAt` `string`: UpdatedAt records the relevant time for the apikey.

### `AccountPayload`

AccountPayload is the editable account payload accepted by monitor handlers.

Fields:

- `Provider` `string`: Provider is the provider value for the account payload.
- `Email` `string`: Email is the email value for the account payload.
- `Password` `string`: Password is the password value for the account payload.
- `Phone` `string`: Phone is the phone value for the account payload.

### `TOTPSecretPayload`

TOTPSecretPayload represents a totpsecret payload.

Fields:

- `Secret` `string`: Secret is the secret value for the totpsecret payload.
- `IsActive` `bool`: IsActive reports whether the totpsecret payload condition is true.

### `PasskeyPayload`

PasskeyPayload represents a passkey payload.

Fields:

- `CredentialID` `string`: CredentialID is the credential id value for the passkey payload.
- `RPID` `string`: RPID is the rpid value for the passkey payload.
- `PrivateKeyPKCS8` `string`: PrivateKeyPKCS8 is the private key pkcs8 value for the passkey payload.
- `UserHandle` `string`: UserHandle is the user handle value for the passkey payload.
- `SignCount` `int64`: SignCount is the count associated with the passkey payload.
- `IsActive` `bool`: IsActive reports whether the passkey payload condition is true.
- `LastUsedAt` `*string`: LastUsedAt records the relevant time for the passkey payload.

### `SeedPayload`

SeedPayload represents a seed payload.

Fields:

- `SeedPhrase` `string`: SeedPhrase is the seed phrase value for the seed payload.
- `WalletCreatedAt` `*string`: WalletCreatedAt records the relevant time for the seed payload.

### `APIKeyPayload`

APIKeyPayload is the editable API-key payload accepted by monitor handlers.

Fields:

- `Name` `string`: Name is the name value for the apikey payload.
- `APIKey` `string`: APIKey is the apikey value for the apikey payload.
- `APISecret` `*string`: APISecret is the apisecret value for the apikey payload.
- `Passphrase` `*string`: Passphrase is the passphrase value for the apikey payload.
- `IsActive` `bool`: IsActive reports whether the apikey payload condition is true.

### `Repository`

Repository represents a repository.

Fields:

- `DB` `*sql.DB`: DB is the database handle used by the repository.

## Functions and Methods

### `NewRepository`

NewRepository creates a repository.

Signature: `func NewRepository(db *sql.DB) Repository`

### `(Repository).List`

List returns recent records, capped by the requested limit.

Signature: `func (r Repository) List(ctx context.Context) ([]Account, error)`

### `(Repository).Get`

Get retrieves value.

Signature: `func (r Repository) Get(ctx context.Context, id int64) (*Account, error)`

### `(Repository).Create`

Create creates value.

Signature: `func (r Repository) Create(ctx context.Context, payload AccountPayload) (int64, error)`

### `(Repository).Update`

Update replaces an account and its nested credentials.

Signature: `func (r Repository) Update(ctx context.Context, id int64, payload AccountPayload) error`

### `(Repository).Delete`

Delete removes an account by provider and category.

Signature: `func (r Repository) Delete(ctx context.Context, id int64) error`

### `(Repository).CreateTOTPSecret`

CreateTOTPSecret creates a totpsecret.

Signature: `func (r Repository) CreateTOTPSecret(ctx context.Context, accountID int64, payload TOTPSecretPayload) (int64, error)`

### `(Repository).UpdateTOTPSecret`

UpdateTOTPSecret stores a TOTP secret for an account.

Signature: `func (r Repository) UpdateTOTPSecret(ctx context.Context, id int64, payload TOTPSecretPayload) error`

### `(Repository).DeleteTOTPSecret`

DeleteTOTPSecret removes a TOTP secret from an account.

Signature: `func (r Repository) DeleteTOTPSecret(ctx context.Context, id int64) error`

### `(Repository).GetTOTPSecret`

GetTOTPSecret retrieves a totpsecret.

Signature: `func (r Repository) GetTOTPSecret(ctx context.Context, id int64) (*TOTPSecret, error)`

### `(Repository).CreatePasskey`

CreatePasskey creates a passkey.

Signature: `func (r Repository) CreatePasskey(ctx context.Context, accountID int64, payload PasskeyPayload) (int64, error)`

### `(Repository).UpdatePasskey`

UpdatePasskey stores a passkey credential for an account.

Signature: `func (r Repository) UpdatePasskey(ctx context.Context, id int64, payload PasskeyPayload) error`

### `(Repository).DeletePasskey`

DeletePasskey removes a passkey credential from an account.

Signature: `func (r Repository) DeletePasskey(ctx context.Context, id int64) error`

### `(Repository).GetPasskey`

GetPasskey retrieves a passkey.

Signature: `func (r Repository) GetPasskey(ctx context.Context, id int64) (*Passkey, error)`

### `(Repository).CreateSeed`

CreateSeed creates a seed.

Signature: `func (r Repository) CreateSeed(ctx context.Context, accountID int64, payload SeedPayload) (int64, error)`

### `(Repository).UpdateSeed`

UpdateSeed stores a recovery seed for an account.

Signature: `func (r Repository) UpdateSeed(ctx context.Context, id int64, payload SeedPayload) error`

### `(Repository).DeleteSeed`

DeleteSeed removes a recovery seed from an account.

Signature: `func (r Repository) DeleteSeed(ctx context.Context, id int64) error`

### `(Repository).GetSeed`

GetSeed retrieves a seed.

Signature: `func (r Repository) GetSeed(ctx context.Context, id int64) (*Seed, error)`

### `(Repository).CreateAPIKey`

CreateAPIKey creates an apikey.

Signature: `func (r Repository) CreateAPIKey(ctx context.Context, accountID int64, payload APIKeyPayload) (int64, error)`

### `(Repository).UpdateAPIKey`

UpdateAPIKey stores an API key for an account.

Signature: `func (r Repository) UpdateAPIKey(ctx context.Context, id int64, payload APIKeyPayload) error`

### `(Repository).DeleteAPIKey`

DeleteAPIKey removes an API key from an account.

Signature: `func (r Repository) DeleteAPIKey(ctx context.Context, id int64) error`

### `(Repository).GetAPIKey`

GetAPIKey retrieves an apikey.

Signature: `func (r Repository) GetAPIKey(ctx context.Context, id int64) (*APIKey, error)`

### `(Repository).IsRobosatsAccount`

IsRobosatsAccount reports whether the account belongs to RoboSats.

Signature: `func (r Repository) IsRobosatsAccount(ctx context.Context, accountID int64) (bool, error)`

### `(Repository).IsRobosatsAPIKey`

IsRobosatsAPIKey reports whether the API key is a RoboSats credential.

Signature: `func (r Repository) IsRobosatsAPIKey(ctx context.Context, apiKeyID int64) (bool, error)`

### `(Repository).appendTOTPSecrets`

This function is part of the `tradingaccounts` package implementation.

Signature: `func (r Repository) appendTOTPSecrets(ctx context.Context, accounts []Account, accountIndex map[int64]int, accountIDs []int64) error`

### `(Repository).appendPasskeys`

This function is part of the `tradingaccounts` package implementation.

Signature: `func (r Repository) appendPasskeys(ctx context.Context, accounts []Account, accountIndex map[int64]int, accountIDs []int64) error`

### `(Repository).appendSeeds`

This function is part of the `tradingaccounts` package implementation.

Signature: `func (r Repository) appendSeeds(ctx context.Context, accounts []Account, accountIndex map[int64]int, accountIDs []int64) error`

### `(Repository).appendAPIKeys`

This function is part of the `tradingaccounts` package implementation.

Signature: `func (r Repository) appendAPIKeys(ctx context.Context, accounts []Account, accountIndex map[int64]int, accountIDs []int64) error`

### `NormalizeProvider`

NormalizeProvider returns the canonical provider name used by storage and UI code.

Signature: `func NormalizeProvider(value string) string`

### `nullStringPtr`

This function is part of the `tradingaccounts` package implementation.

Signature: `func nullStringPtr(value sql.NullString) *string`

### `nullTimePtr`

This function is part of the `tradingaccounts` package implementation.

Signature: `func nullTimePtr(value sql.NullTime) *string`

### `formatTime`

This function is part of the `tradingaccounts` package implementation.

Signature: `func formatTime(value time.Time) string`

### `stringOrEmpty`

This function is part of the `tradingaccounts` package implementation.

Signature: `func stringOrEmpty(value *string) string`

## Key Dependencies

- `context`
- `database/sql`
- `strings`
- `time`

