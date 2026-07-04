// Package auth provides application-level username/password login for the
// dexMonitor dashboard: first-user-only registration, bcrypt password hashing,
// and the login/logout/me HTTP handlers. The cookie-session machinery itself
// lives in the shared commons/session package so other services (unified-api)
// validate the same session; this package owns identity (the app_users table).
package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"commons/session"

	"golang.org/x/crypto/bcrypt"
)

const (
	minUsernameLen = 3
	minPasswordLen = 8
)

// Service owns the dashboard login: it embeds the shared session manager (so the
// handlers can renew/store/read the session) and holds the user repository.
type Service struct {
	*session.Manager
	repo *userRepo
}

// Config configures the session cookie.
type Config struct {
	// CookieSecure sets the Secure attribute on the session cookie. Keep true in
	// prod (HTTPS); set false only for local HTTP dev, where browsers drop Secure
	// cookies served over http:// and the session would never persist.
	CookieSecure bool
}

// New builds the auth Service: the shared Postgres-backed session manager plus
// the user repository on the same *sql.DB.
func New(db *sql.DB, cfg Config) *Service {
	return &Service{
		Manager: session.NewManager(db, session.Config{CookieSecure: cfg.CookieSecure}),
		repo:    &userRepo{db: db},
	}
}

// Protected is dexMonitor's gate predicate: require a session for everything
// under /api/ or /ws/ except the auth endpoints (which must stay reachable while
// logged out). Static SPA assets, /health and /metrics pass through.
func Protected(path string) bool {
	if strings.HasPrefix(path, "/api/auth/") {
		return false
	}
	return strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/ws/")
}

// RegisterRoutes wires the five /api/auth/* endpoints onto the mux. These must be
// registered before any catch-all/static route and are exempt from Protected so
// the login page can reach them while unauthenticated.
func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/auth/register", s.handleRegister)
	mux.HandleFunc("POST /api/auth/login", s.handleLogin)
	mux.HandleFunc("POST /api/auth/logout", s.handleLogout)
	mux.HandleFunc("GET /api/auth/me", s.handleMe)
	mux.HandleFunc("GET /api/auth/registration_available", s.handleRegistrationAvailable)
}

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// handleRegister creates the first (and only bootstrap) account. It is a no-op
// once any account exists, which is how registration "closes" itself.
func (s *Service) handleRegister(w http.ResponseWriter, r *http.Request) {
	n, err := s.repo.Count(r.Context())
	if err != nil {
		slog.ErrorContext(r.Context(), "auth: count users", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	if n > 0 {
		writeErr(w, http.StatusForbidden, "registration is closed")
		return
	}

	var body credentials
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}
	username := strings.TrimSpace(body.Username)
	if len([]rune(username)) < minUsernameLen {
		writeErr(w, http.StatusBadRequest, "username too short")
		return
	}
	if len(body.Password) < minPasswordLen {
		writeErr(w, http.StatusBadRequest, "password too short")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(body.Password), bcrypt.DefaultCost)
	if err != nil {
		slog.ErrorContext(r.Context(), "auth: hash password", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	id, err := s.repo.CreateInitial(r.Context(), username, string(hash))
	if err != nil {
		if errors.Is(err, errRegistrationClosed) {
			writeErr(w, http.StatusForbidden, "registration is closed")
			return
		}
		slog.ErrorContext(r.Context(), "auth: create user", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}

	if err := s.startSession(r.Context(), id, username); err != nil {
		slog.ErrorContext(r.Context(), "auth: start session", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"username": username})
}

// handleLogin verifies credentials and, on success, starts a fresh session.
// Lookup miss and bad password return the same 401 to avoid leaking which usernames exist.
func (s *Service) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body credentials
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid request body")
		return
	}

	u, err := s.repo.GetByUsername(r.Context(), strings.TrimSpace(body.Username))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			writeErr(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
		slog.ErrorContext(r.Context(), "auth: lookup user", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(body.Password)) != nil {
		writeErr(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	if err := s.startSession(r.Context(), u.ID, u.Username); err != nil {
		slog.ErrorContext(r.Context(), "auth: start session", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	if err := s.repo.TouchLastLogin(r.Context(), u.ID); err != nil {
		slog.WarnContext(r.Context(), "auth: touch last_login", "err", err)
	}
	writeJSON(w, http.StatusOK, map[string]string{"username": u.Username})
}

// handleLogout destroys the current session (and its store row + cookie).
func (s *Service) handleLogout(w http.ResponseWriter, r *http.Request) {
	if err := s.Destroy(r.Context()); err != nil {
		slog.ErrorContext(r.Context(), "auth: destroy session", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	// Return a JSON body (not a bare 200): the SPA's request() helper always
	// parses the response as JSON.
	writeJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// handleMe reports the current user, or 401 if there is no session. The SPA calls
// this on load to decide between the login page and the dashboard.
func (s *Service) handleMe(w http.ResponseWriter, r *http.Request) {
	if s.GetInt(r.Context(), session.KeyUserID) == 0 {
		writeErr(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	username := s.GetString(r.Context(), session.KeyUsername)
	writeJSON(w, http.StatusOK, map[string]string{"username": username})
}

// handleRegistrationAvailable drives the Register toggle in the UI: true only
// while zero accounts exist.
func (s *Service) handleRegistrationAvailable(w http.ResponseWriter, r *http.Request) {
	n, err := s.repo.Count(r.Context())
	if err != nil {
		slog.ErrorContext(r.Context(), "auth: count users", "err", err)
		writeErr(w, http.StatusInternalServerError, "internal error")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"available": n == 0})
}

// startSession renews the session token (defeats fixation) and stores identity.
func (s *Service) startSession(ctx context.Context, id int64, username string) error {
	if err := s.RenewToken(ctx); err != nil {
		return err
	}
	s.Put(ctx, session.KeyUserID, int(id))
	s.Put(ctx, session.KeyUsername, username)
	return nil
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
