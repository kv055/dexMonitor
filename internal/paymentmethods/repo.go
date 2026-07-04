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
	ID              int64   `json:"id"`
	Name            string  `json:"name"`
	MergeRegex      *string `json:"merge_regex"`
	Category        string  `json:"category"`
	BankAccountID   *int64  `json:"bank_account_id"`
	AccountID       *int64  `json:"account_id"`
	WalletAddressID *int64  `json:"wallet_address_id"`
	IsActive        bool    `json:"is_active"`
	IsLinked        bool    `json:"is_linked"`
	Priority        int     `json:"priority"`
	MatchOrder      int     `json:"match_order"`
	LinkLabel       *string `json:"link_label"`
	CreatedAt       string  `json:"created_at"`
	UpdatedAt       string  `json:"updated_at"`
}

// UpdatePayload is the editable subset of a payment_methods row. Name,
// match_order and is_linked are deliberately not editable: renaming a method
// would orphan the names already stored in offers.payment_methods, match_order
// is seeded matching data, and is_linked is a generated column.
type UpdatePayload struct {
	MergeRegex      *string `json:"merge_regex"`
	Category        string  `json:"category"`
	BankAccountID   *int64  `json:"bank_account_id"`
	AccountID       *int64  `json:"account_id"`
	WalletAddressID *int64  `json:"wallet_address_id"`
	IsActive        bool    `json:"is_active"`
	Priority        int     `json:"priority"`
}

// WalletAddressRow is a wallet_addresses row for the Crypto link dropdown.
// dexMonitor only reads this table; writes stay with dexMmController.
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
// entity's label resolved (bank account nickname / owner + IBAN tail,
// account provider, wallet address label).
func (r *Repo) List(ctx context.Context) ([]AdminRow, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT pm.id, pm.name, pm.merge_regex, pm.category,
		       pm.bank_account_id, pm.account_id, pm.wallet_address_id,
		       pm.is_active, pm.is_linked, pm.priority, pm.match_order,
		       CASE
		           WHEN pm.bank_account_id IS NOT NULL THEN
		               COALESCE(NULLIF(ba.label, ''), ba.owner_name || ' …' || right(ba.details->>'iban', 4))
		           WHEN pm.account_id IS NOT NULL THEN a.provider
		           WHEN pm.wallet_address_id IS NOT NULL THEN wa.label
		       END AS link_label,
		       to_char(pm.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS'),
		       to_char(pm.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
		FROM payment_methods pm
		LEFT JOIN bank_accounts ba ON ba.id = pm.bank_account_id
		LEFT JOIN accounts a ON a.id = pm.account_id
		LEFT JOIN wallet_addresses wa ON wa.id = pm.wallet_address_id
		ORDER BY pm.category, pm.priority DESC, pm.name`)
	if err != nil {
		return nil, fmt.Errorf("list payment methods: %w", err)
	}
	defer rows.Close()

	out := make([]AdminRow, 0)
	for rows.Next() {
		var row AdminRow
		if err := rows.Scan(&row.ID, &row.Name, &row.MergeRegex, &row.Category,
			&row.BankAccountID, &row.AccountID, &row.WalletAddressID,
			&row.IsActive, &row.IsLinked, &row.Priority, &row.MatchOrder,
			&row.LinkLabel, &row.CreatedAt, &row.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan payment method: %w", err)
		}
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

	links := 0
	for _, l := range []*int64{p.BankAccountID, p.AccountID, p.WalletAddressID} {
		if l != nil {
			links++
		}
	}
	if links > 1 {
		return ValidationError{fmt.Errorf("a payment method can link to at most one payment solution")}
	}
	if p.BankAccountID != nil && category != "Bank Transfer" {
		return ValidationError{fmt.Errorf("only Bank Transfer methods can link to a bank account")}
	}
	if p.AccountID != nil && category != "Fiat Transmitter" {
		return ValidationError{fmt.Errorf("only Fiat Transmitter methods can link to an account")}
	}
	if p.WalletAddressID != nil && category != "Crypto" {
		return ValidationError{fmt.Errorf("only Crypto methods can link to a wallet address")}
	}

	res, err := r.DB.ExecContext(ctx, `
		UPDATE payment_methods SET
			merge_regex = $1,
			category = $2,
			bank_account_id = $3,
			account_id = $4,
			wallet_address_id = $5,
			is_active = $6,
			priority = $7,
			updated_at = CURRENT_TIMESTAMP
		WHERE id = $8`,
		p.MergeRegex, category, p.BankAccountID, p.AccountID, p.WalletAddressID,
		p.IsActive, p.Priority, id)
	if err != nil {
		return fmt.Errorf("update payment method %d: %w", id, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ValidationError{fmt.Errorf("payment method %d does not exist", id)}
	}
	return nil
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

// ListWalletAddresses returns wallet_addresses for the Crypto link dropdown.
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
