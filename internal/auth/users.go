package auth

import (
	"context"
	"database/sql"
)

// user is a stored login account (the app_users table, migration 025).
type user struct {
	ID           int64
	Username     string
	PasswordHash string
}

// userRepo is the data access for app_users on the shared *sql.DB, using $1
// placeholders like the other dexMonitor repositories.
type userRepo struct {
	db *sql.DB
}

// Count returns the number of registered accounts. Zero means registration is
// still open (bootstrap).
func (r *userRepo) Count(ctx context.Context) (int, error) {
	var n int
	err := r.db.QueryRowContext(ctx, `SELECT count(*) FROM app_users`).Scan(&n)
	return n, err
}

// GetByUsername returns the account for a username, or sql.ErrNoRows if absent.
func (r *userRepo) GetByUsername(ctx context.Context, username string) (user, error) {
	var u user
	err := r.db.QueryRowContext(ctx,
		`SELECT id, username, password_hash FROM app_users WHERE username = $1`,
		username,
	).Scan(&u.ID, &u.Username, &u.PasswordHash)
	return u, err
}

// Create inserts a new account and returns its id.
func (r *userRepo) Create(ctx context.Context, username, passwordHash string) (int64, error) {
	var id int64
	err := r.db.QueryRowContext(ctx,
		`INSERT INTO app_users (username, password_hash) VALUES ($1, $2) RETURNING id`,
		username, passwordHash,
	).Scan(&id)
	return id, err
}

// TouchLastLogin stamps the last successful login time.
func (r *userRepo) TouchLastLogin(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `UPDATE app_users SET last_login = now() WHERE id = $1`, id)
	return err
}
