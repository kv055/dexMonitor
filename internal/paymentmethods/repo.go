package paymentmethods

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"strings"

	commonpm "commons/paymentmethods"
)

// ValidationError marks an error as rejected user input (mapped to HTTP 400
// by the API handlers), as opposed to an internal/database failure (500).
type ValidationError struct {
	err error
}

func (e ValidationError) Error() string { return e.err.Error() }
func (e ValidationError) Unwrap() error { return e.err }

// AdminRow is one payment_methods catalog row as served to the categorization
// panel, including a human-readable label for whatever the row links to.
type AdminRow struct {
	ID         int64    `json:"id"`
	Name       string   `json:"name"`
	MergeRegex *string  `json:"merge_regex"`
	AliasList  []string `json:"alias_list"`
	Sources    []string `json:"sources"`
	Currencies []string `json:"currencies"`
	Category   string   `json:"category"`
	AccountID  *int64   `json:"account_id"`
	IsActive   bool     `json:"is_active"`
	IsLinked   bool     `json:"is_linked"`
	Priority   int      `json:"priority"`
	MatchOrder int      `json:"match_order"`
	Popularity int      `json:"popularity"`
	LinkLabel  *string  `json:"link_label"`
	CreatedAt  string   `json:"created_at"`
	UpdatedAt  string   `json:"updated_at"`
}

// LinkedActivePaymentMethod is a compact view of one payment_methods row that
// is both linked to a saved payment account and active. It feeds the PushPush
// Relay pairing QR payload, so it deliberately omits panel-only fields such as
// merge_regex and match bookkeeping to keep the QR payload small.
type LinkedActivePaymentMethod struct {
	ID         int64    `json:"id"`
	Name       string   `json:"name"`
	Category   string   `json:"category"`
	AliasList  []string `json:"alias_list"`
	Sources    []string `json:"sources"`
	Currencies []string `json:"currencies"`
}

// ListLinkedActive returns every payment method that is linked to a saved
// payment account (is_linked is generated from account_id) and active — the
// set of fiat rails the PushPush Relay phone app should treat as authorized.
func (r *Repo) ListLinkedActive(ctx context.Context) ([]LinkedActivePaymentMethod, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT pm.id, pm.name, pm.category, pm.alias_list, pm.sources, pm.currencies
		FROM payment_methods pm
		WHERE pm.is_linked AND pm.is_active
		ORDER BY pm.category, pm.priority DESC, pm.name`)
	if err != nil {
		return nil, fmt.Errorf("list linked active payment methods: %w", err)
	}
	defer rows.Close()

	out := make([]LinkedActivePaymentMethod, 0)
	for rows.Next() {
		var row LinkedActivePaymentMethod
		var aliases, sources, currencies commonpm.TextArray
		if err := rows.Scan(&row.ID, &row.Name, &row.Category, &aliases, &sources, &currencies); err != nil {
			return nil, fmt.Errorf("scan linked active payment method: %w", err)
		}
		row.AliasList = nonNilStrings(aliases)
		row.Sources = nonNilStrings(sources)
		row.Currencies = nonNilStrings(currencies)
		out = append(out, row)
	}
	return out, rows.Err()
}

// UpdatePayload is the editable subset of a payment_methods row. Name,
// match_order, is_linked, is_active, sources, and currencies are deliberately
// not editable: renaming a method would orphan the names already stored in
// offers.payment_methods, match_order is seeded matching data, is_linked is
// generated, a payment method becomes active only when it is linked to a saved
// payment account, and sources/currencies are observed fields owned by the
// snapshot service.
type UpdatePayload struct {
	MergeRegex *string  `json:"merge_regex"`
	AliasList  []string `json:"alias_list"`
	// Sources and Currencies are accepted for API compatibility with older
	// clients but ignored on write — the snapshot service owns those columns.
	Sources    []string `json:"sources"`
	Currencies []string `json:"currencies"`
	Category   string   `json:"category"`
	AccountID  *int64   `json:"account_id"`
	Priority   int      `json:"priority"`
}

// WalletAddressRow is a wallet_addresses row (CEX/hop deposit addresses).
// dexMonitor only reads this table; writes stay with dexTakerController.
type WalletAddressRow struct {
	ID      int64  `json:"id"`
	Label   string `json:"label"`
	Address string `json:"address"`
}

// Repo provides categorization-panel CRUD over the payment_methods table.
type Repo struct {
	DB *sql.DB
}

// List returns every catalog row ordered for panel display, with the linked
// account's provider as the human-readable link label.
func (r *Repo) List(ctx context.Context) ([]AdminRow, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT pm.id, pm.name, pm.merge_regex, pm.alias_list, pm.sources, pm.currencies,
		       pm.category,
		       pm.account_id,
		       pm.is_active, pm.is_linked, pm.priority, pm.match_order, pm.popularity,
		       a.provider AS link_label,
		       to_char(pm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
		       to_char(pm.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
		FROM payment_methods pm
		LEFT JOIN accounts a ON a.id = pm.account_id
		ORDER BY pm.category, pm.priority DESC, pm.name`)
	if err != nil {
		return nil, fmt.Errorf("list payment methods: %w", err)
	}
	defer rows.Close()

	out := make([]AdminRow, 0)
	for rows.Next() {
		var row AdminRow
		var aliases, sources, currencies commonpm.TextArray
		if err := rows.Scan(&row.ID, &row.Name, &row.MergeRegex, &aliases, &sources, &currencies,
			&row.Category,
			&row.AccountID,
			&row.IsActive, &row.IsLinked, &row.Priority, &row.MatchOrder, &row.Popularity,
			&row.LinkLabel, &row.CreatedAt, &row.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan payment method: %w", err)
		}
		row.AliasList = nonNilStrings(aliases)
		row.Sources = nonNilStrings(sources)
		row.Currencies = nonNilStrings(currencies)
		out = append(out, row)
	}
	return out, rows.Err()
}

// Update applies an UpdatePayload to one row. Validation mirrors the table's
// CHECK constraints so the panel gets a 400 with a readable message instead
// of a raw constraint violation.
func (r *Repo) Update(ctx context.Context, id int64, p UpdatePayload) error {
	category := strings.TrimSpace(p.Category)
	validCategory := false
	for _, c := range commonpm.CategoryDisplayNames() {
		if category == c {
			validCategory = true
			break
		}
	}
	if !validCategory {
		return ValidationError{fmt.Errorf("category %q is not one of: %s",
			category, strings.Join(commonpm.CategoryDisplayNames(), ", "))}
	}

	if p.MergeRegex != nil {
		trimmed := strings.TrimSpace(*p.MergeRegex)
		if trimmed == "" {
			p.MergeRegex = nil
		} else {
			if _, err := regexp.Compile(trimmed); err != nil {
				return ValidationError{fmt.Errorf("merge_regex does not compile: %v", err)}
			}
			p.MergeRegex = &trimmed
		}
	}
	aliasList := cleanAliasList(p.AliasList)

	if p.AccountID != nil && category != "Bank" && category != "Fiat Transmitter" {
		return ValidationError{fmt.Errorf("only Bank and Fiat Transmitter methods can link to an account")}
	}
	// A method is usable only after a payment account has been assigned. Keep
	// this derived server-side so clients cannot activate a method directly.
	isActive := p.AccountID != nil

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin update payment method %d: %w", id, err)
	}
	defer tx.Rollback()

	res, err := tx.ExecContext(ctx, `
		UPDATE payment_methods SET
			merge_regex = $1,
			category = $2,
			account_id = $3,
			is_active = $4,
			priority = $5,
			alias_list = $6,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $7`,
		p.MergeRegex, category, p.AccountID,
		isActive, p.Priority, commonpm.TextArray(aliasList), id)
	if err != nil {
		return fmt.Errorf("update payment method %d: %w", id, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ValidationError{fmt.Errorf("payment method %d does not exist", id)}
	}

	// An alias is the canonical replacement for a provider name. Remove any
	// catalog rows whose names are now represented by this provider's aliases,
	// including linked rows the operator folded into this provider's aliases.
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM payment_methods candidate
		WHERE candidate.id <> $1
		  AND EXISTS (
			SELECT 1
			FROM unnest($2::text[]) AS alias_name
			WHERE lower(trim(replace(candidate.name, '_', ' '))) =
			      lower(trim(replace(alias_name, '_', ' ')))
		  )`, id, commonpm.TextArray(aliasList)); err != nil {
		return fmt.Errorf("remove payment methods promoted to aliases of %d: %w", id, err)
	}

	// Payment accounts may only be active while linked to at least one catalog
	// method. Clear active when this update (or alias cleanup) leaves none.
	if err := deactivateOrphanedPaymentAccounts(ctx, tx); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit update payment method %d: %w", id, err)
	}
	return nil
}

// deactivateOrphanedPaymentAccounts clears is_active on payment accounts that
// no longer have any payment_methods.account_id links.
func deactivateOrphanedPaymentAccounts(ctx context.Context, tx *sql.Tx) error {
	_, err := tx.ExecContext(ctx, `
		UPDATE accounts
		SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
		WHERE category IN ('Fiat Transmitter', 'Bank', 'Wallet addresses')
		  AND is_active = TRUE
		  AND NOT EXISTS (
			SELECT 1 FROM payment_methods WHERE account_id = accounts.id
		  )`)
	if err != nil {
		return fmt.Errorf("deactivate unlinked payment accounts: %w", err)
	}
	return nil
}

func cleanAliasList(in []string) []string {
	out := make([]string, 0, len(in))
	seen := make(map[string]bool, len(in))
	for _, alias := range in {
		trimmed := strings.TrimSpace(alias)
		if trimmed == "" {
			continue
		}
		norm := normalizeAlias(trimmed)
		if norm == "" || seen[norm] {
			continue
		}
		seen[norm] = true
		out = append(out, trimmed)
	}
	return out
}

func nonNilStrings(in []string) []string {
	if in == nil {
		return []string{}
	}
	return in
}

func normalizeAlias(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.ReplaceAll(s, "_", " ")
	return strings.Join(strings.Fields(s), " ")
}

// Delete removes a row — only inactive Others rows (junk from the unknown-
// method auto-insert) may be deleted; seeded/categorized methods are the
// catalog and should be deactivated instead. The snapshot writer may re-insert
// a deleted name if offers still carry it, which is fine.
func (r *Repo) Delete(ctx context.Context, id int64) error {
	res, err := r.DB.ExecContext(ctx, `
		DELETE FROM payment_methods
		WHERE id = $1 AND category = 'Others' AND is_active = FALSE`, id)
	if err != nil {
		return fmt.Errorf("delete payment method %d: %w", id, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ValidationError{fmt.Errorf("payment method %d does not exist or is not an inactive Others row (deactivate it instead of deleting)", id)}
	}
	return nil
}

// DegradeToAlias moves a payment-method name into another provider's alias
// list and removes the source row in one transaction.
func (r *Repo) DegradeToAlias(ctx context.Context, aliasID, providerID int64) error {
	if aliasID == providerID {
		return ValidationError{fmt.Errorf("a payment method cannot be degraded to itself")}
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin degrade payment method transaction: %w", err)
	}
	defer tx.Rollback()

	var aliasName string
	if err := tx.QueryRowContext(ctx, `
		SELECT name
		FROM payment_methods
		WHERE id = $1
		FOR UPDATE`, aliasID).Scan(&aliasName); err != nil {
		if err == sql.ErrNoRows {
			return ValidationError{fmt.Errorf("payment method %d does not exist", aliasID)}
		}
		return fmt.Errorf("load payment method %d for alias degradation: %w", aliasID, err)
	}
	var aliases commonpm.TextArray
	if err := tx.QueryRowContext(ctx, `
		SELECT alias_list
		FROM payment_methods
		WHERE id = $1
		FOR UPDATE`, providerID).Scan(&aliases); err != nil {
		if err == sql.ErrNoRows {
			return ValidationError{fmt.Errorf("provider payment method %d does not exist", providerID)}
		}
		return fmt.Errorf("load provider payment method %d for alias degradation: %w", providerID, err)
	}

	aliases = commonpm.TextArray(cleanAliasList(append([]string(aliases), aliasName)))
	if _, err := tx.ExecContext(ctx, `
		UPDATE payment_methods SET alias_list = $1, updated_at = CURRENT_TIMESTAMP
		WHERE id = $2`, aliases, providerID); err != nil {
		return fmt.Errorf("add payment method %d as alias to provider %d: %w", aliasID, providerID, err)
	}

	// Drop the degraded row and any other catalog rows whose names are now
	// covered by this provider's aliases (including leftover rows from older
	// edits that only stored the alias text).
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM payment_methods candidate
		WHERE candidate.id = $1
		   OR (
			candidate.id <> $2
			AND EXISTS (
				SELECT 1
				FROM unnest($3::text[]) AS alias_name
				WHERE lower(trim(replace(candidate.name, '_', ' '))) =
				      lower(trim(replace(alias_name, '_', ' ')))
			)
		   )`, aliasID, providerID, aliases); err != nil {
		return fmt.Errorf("delete degraded payment method %d: %w", aliasID, err)
	}

	var stillExists bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS(SELECT 1 FROM payment_methods WHERE id = $1)`, aliasID).Scan(&stillExists); err != nil {
		return fmt.Errorf("verify degraded payment method %d deleted: %w", aliasID, err)
	}
	if stillExists {
		return ValidationError{fmt.Errorf("payment method %d could not be deleted after alias degradation", aliasID)}
	}

	if err := deactivateOrphanedPaymentAccounts(ctx, tx); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit alias degradation for payment method %d: %w", aliasID, err)
	}
	return nil
}

// PromoteAlias turns one exact alias back into its own catalog row. The new
// method keeps the provider's category and priority but deliberately starts
// inactive and unlinked: promoting a label must not silently authorize it for
// trading or attach it to a payment account.
func (r *Repo) PromoteAlias(ctx context.Context, providerID int64, alias string) error {
	alias = strings.TrimSpace(alias)
	normalized := normalizeAlias(alias)
	if normalized == "" {
		return ValidationError{fmt.Errorf("alias is required")}
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin promote alias transaction: %w", err)
	}
	defer tx.Rollback()

	var category string
	var priority int
	var aliases commonpm.TextArray
	if err := tx.QueryRowContext(ctx, `
		SELECT category, priority, alias_list
		FROM payment_methods
		WHERE id = $1
		FOR UPDATE`, providerID).Scan(&category, &priority, &aliases); err != nil {
		if err == sql.ErrNoRows {
			return ValidationError{fmt.Errorf("provider payment method %d does not exist", providerID)}
		}
		return fmt.Errorf("load provider payment method %d for alias promotion: %w", providerID, err)
	}

	remaining := make([]string, 0, len(aliases))
	found := false
	for _, candidate := range aliases {
		if normalizeAlias(candidate) == normalized {
			if !found {
				found = true
				continue
			}
		}
		remaining = append(remaining, candidate)
	}
	if !found {
		return ValidationError{fmt.Errorf("%q is not an alias of payment method %d", alias, providerID)}
	}

	var exists bool
	if err := tx.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM payment_methods
			WHERE lower(trim(replace(name, '_', ' '))) = $1
		)`, normalized).Scan(&exists); err != nil {
		return fmt.Errorf("check promoted payment method name: %w", err)
	}
	if exists {
		return ValidationError{fmt.Errorf("a payment method named %q already exists", alias)}
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE payment_methods SET alias_list = $1, updated_at = CURRENT_TIMESTAMP
		WHERE id = $2`, commonpm.TextArray(cleanAliasList(remaining)), providerID); err != nil {
		return fmt.Errorf("remove alias from payment method %d: %w", providerID, err)
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO payment_methods (name, category, is_active, priority, alias_list)
		VALUES ($1, $2, FALSE, $3, '{}'::text[])`, alias, category, priority); err != nil {
		return fmt.Errorf("create payment method from alias %q: %w", alias, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit alias promotion for payment method %d: %w", providerID, err)
	}
	return nil
}

// ListWalletAddresses returns wallet_addresses rows for the trading UI.
func (r *Repo) ListWalletAddresses(ctx context.Context) ([]WalletAddressRow, error) {
	rows, err := r.DB.QueryContext(ctx, `SELECT id, label, address FROM wallet_addresses ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("list wallet addresses: %w", err)
	}
	defer rows.Close()

	out := make([]WalletAddressRow, 0)
	for rows.Next() {
		var row WalletAddressRow
		if err := rows.Scan(&row.ID, &row.Label, &row.Address); err != nil {
			return nil, fmt.Errorf("scan wallet address: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// ChatTemplateRow is one chat-template row for a payment method / exchange / direction.
type ChatTemplateRow struct {
	ID              int64  `json:"id"`
	Exchange        string `json:"exchange"`
	TradeDirection  string `json:"trade_direction"`
	PaymentMethodID int64  `json:"payment_method_id"`
	Template        string `json:"template"`
	IsActive        bool   `json:"is_active"`
	CreatedAt       string `json:"created_at"`
	UpdatedAt       string `json:"updated_at"`
}

// ChatTemplatePayload is the body used to create or update a chat template.
type ChatTemplatePayload struct {
	Template       string `json:"template"`
	IsActive       bool   `json:"is_active"`
	TradeDirection string `json:"trade_direction"`
}

func normalizeChatTradeDirection(direction string) (string, error) {
	direction = strings.ToLower(strings.TrimSpace(direction))
	if direction == "" || direction == "bid" {
		return "bid", nil
	}
	if direction != "ask" {
		return "", ValidationError{fmt.Errorf("trade_direction %q is invalid (allowed: bid, ask)", direction)}
	}
	return direction, nil
}

// allowedChatExchanges lists the DEX venues that use the chat-based payment-details flow.
var allowedChatExchanges = map[string]bool{
	"robosats": true,
	"bisq2":    true,
}

// ListChatTemplates returns all chat templates for a single payment method.
func (r *Repo) ListChatTemplates(ctx context.Context, paymentMethodID int64) ([]ChatTemplateRow, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT id, exchange, payment_method_id, trade_direction, template, is_active, created_at, updated_at
		FROM payment_method_chat_templates
		WHERE payment_method_id = $1
		ORDER BY exchange, trade_direction`, paymentMethodID)
	if err != nil {
		return nil, fmt.Errorf("list chat templates for payment method %d: %w", paymentMethodID, err)
	}
	defer rows.Close()

	out := make([]ChatTemplateRow, 0)
	for rows.Next() {
		var row ChatTemplateRow
		if err := rows.Scan(&row.ID, &row.Exchange, &row.PaymentMethodID, &row.TradeDirection, &row.Template,
			&row.IsActive, &row.CreatedAt, &row.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan chat template: %w", err)
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// UpsertChatTemplate creates or updates the chat template for a payment method / exchange pair.
func (r *Repo) UpsertChatTemplate(ctx context.Context, paymentMethodID int64, exchange string, p ChatTemplatePayload) error {
	exchange = strings.TrimSpace(exchange)
	if !allowedChatExchanges[exchange] {
		return ValidationError{fmt.Errorf("exchange %q is not a chat-venue DEX (allowed: robosats, bisq2)", exchange)}
	}
	template := strings.TrimSpace(p.Template)
	if template == "" {
		return ValidationError{fmt.Errorf("template is required")}
	}
	if err := r.validatePaymentMethodExists(ctx, paymentMethodID); err != nil {
		return err
	}
	tradeDirection, err := normalizeChatTradeDirection(p.TradeDirection)
	if err != nil {
		return err
	}

	res, err := r.DB.ExecContext(ctx, `
		INSERT INTO payment_method_chat_templates (exchange, payment_method_id, trade_direction, template, is_active)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (exchange, payment_method_id, trade_direction)
		DO UPDATE SET
			template = EXCLUDED.template,
			is_active = EXCLUDED.is_active,
			updated_at = CURRENT_TIMESTAMP`,
		exchange, paymentMethodID, tradeDirection, template, p.IsActive)
	if err != nil {
		return fmt.Errorf("upsert chat template %s/%d: %w", exchange, paymentMethodID, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ValidationError{fmt.Errorf("payment method %d does not exist", paymentMethodID)}
	}
	return nil
}

// DeleteChatTemplate removes the chat template for a payment method / exchange pair.
func (r *Repo) DeleteChatTemplate(ctx context.Context, paymentMethodID int64, exchange, direction string) error {
	exchange = strings.TrimSpace(exchange)
	if !allowedChatExchanges[exchange] {
		return ValidationError{fmt.Errorf("exchange %q is not a chat-venue DEX (allowed: robosats, bisq2)", exchange)}
	}
	tradeDirection, err := normalizeChatTradeDirection(direction)
	if err != nil {
		return err
	}
	res, err := r.DB.ExecContext(ctx, `
		DELETE FROM payment_method_chat_templates
		WHERE payment_method_id = $1 AND exchange = $2 AND trade_direction = $3`, paymentMethodID, exchange, tradeDirection)
	if err != nil {
		return fmt.Errorf("delete chat template %s/%d: %w", exchange, paymentMethodID, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ValidationError{fmt.Errorf("chat template for %s/%d/%s does not exist", exchange, paymentMethodID, tradeDirection)}
	}
	return nil
}

func (r *Repo) validatePaymentMethodExists(ctx context.Context, id int64) error {
	var exists bool
	if err := r.DB.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM payment_methods WHERE id = $1)`, id).Scan(&exists); err != nil {
		return fmt.Errorf("validate payment method %d: %w", id, err)
	}
	if !exists {
		return ValidationError{fmt.Errorf("payment method %d does not exist", id)}
	}
	return nil
}
