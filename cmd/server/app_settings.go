package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"commons/mmcapabilities"
	"commons/session"
	"dexmonitor/internal/appsettings"
	"dexmonitor/internal/auth"
)

// settingsAuth exposes the session manager to the settings handler so
// successful writes can be attributed in the audit log. Set in main; nil in
// tests, where the actor is reported as "unknown".
var settingsAuth *auth.Service

// loadDBBackedRuntimeConfig seeds absent db-stored keys from the deploy
// bundle and loads this process's own runtime keys DB-first (DB row, then
// process environment, then code default). Seeding never overwrites existing
// rows, so operator edits made through the Settings page survive deploys that
// replace the .env files.
func loadDBBackedRuntimeConfig(ctx context.Context) error {
	if appSettingsStore == nil {
		// Deploy-managed table unavailable at startup: environment-only
		// settings (defaults already apply).
		return nil
	}
	fields, err := appsettings.FieldsByKey()
	if err != nil {
		return err
	}
	seeded, err := appSettingsStore.SeedMissing(ctx, fields, os.Getenv, "system")
	if err != nil {
		return err
	}
	if seeded > 0 {
		slog.Info("app-settings seeded from environment", "keys", seeded)
	}
	rows, err := appSettingsStore.GetAll(ctx)
	if err != nil {
		return err
	}
	get := func(key string) string {
		field, ok := fields[key]
		if !ok {
			return strings.TrimSpace(os.Getenv(key))
		}
		return appsettings.EffectiveValue(field, rows, os.Getenv)
	}
	if interval := get("SNAPSHOT_INTERVAL_MIN"); interval == "" {
		snapshotIntervalMin = 1
	} else if v, err := strconv.Atoi(interval); err != nil {
		snapshotIntervalMin = 1
	} else {
		snapshotIntervalMin = v
	}
	pushpushNotifySecret = strings.TrimSpace(get("PUSHPUSH_NOTIFY_SECRET"))
	if configured, err := time.ParseDuration(get("PUSHPUSH_HEARTBEAT_MAX_AGE")); err == nil && configured > 0 {
		pushpushHeartbeatMaxAge = configured
	}
	capabilityMaxAge = mmcapabilities.ParseMaxAge(get("MM_CEX_CAPABILITY_MAX_AGE"))
	return nil
}

// settingsActor returns the login name behind the request, or "unknown" when
// unavailable (no auth service, no session, or anonymous). Values are never
// logged — only the actor name and the changed keys.
func settingsActor(r *http.Request) (username string) {
	username = "unknown"
	if settingsAuth == nil {
		return username
	}
	defer func() {
		// scs panics without a session in the request context (unit tests).
		_ = recover()
	}()
	if name := strings.TrimSpace(settingsAuth.GetString(r.Context(), session.KeyUsername)); name != "" {
		username = name
	}
	return username
}

type appSettingsValuesPayload struct {
	Values map[string]string `json:"values"`
}

type appSettingsRevealPayload struct {
	Key string `json:"key"`
}

// settingsFileStatus reports whether PUT /api/app-settings can persist.
// Writes need SETTINGS_ENV_FILE pointing at a writable regular file (the
// dexmonitor compose service does not mount the root .env by default).
func settingsFileStatus() (path string, writable bool) {
	path = os.Getenv(appsettings.SettingsEnvFile)
	if path == "" {
		return "", false
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return path, false
	}
	return path, info.Mode().Perm()&0o200 != 0
}

// appSettingsStore persists db-stored settings. Set in main; tests substitute
// a fake. Nil means database persistence is unavailable (unit tests only);
// db-stored keys then fall back to process-environment display and PUTs for
// them fail closed.
var appSettingsStore appsettings.Store

// fileBackedKeys lists schema keys still stored in the dotenv file, for
// clients to disable those inputs when the file is not mounted.
func fileBackedKeys(fields map[string]appsettings.Field) []string {
	var out []string
	for key, field := range fields {
		if !field.StoredInDB() {
			out = append(out, key)
		}
	}
	sort.Strings(out)
	return out
}

// settingsRows returns persisted db rows, or an empty map when the store is
// unavailable (tests). A database error fails the request.
func settingsRows(w http.ResponseWriter) (map[string]appsettings.Setting, bool) {
	if appSettingsStore == nil {
		return map[string]appsettings.Setting{}, true
	}
	rows, err := appSettingsStore.GetAll(context.Background())
	if err != nil {
		writeError(w, err)
		return nil, false
	}
	return rows, true
}

// handleAppSettings serves GET (schema + effective values) and PUT for the
// user-facing settings in settings.schema.json. Db-stored keys persist in
// the app_settings table (deploy-proof, audited) and are always writable;
// file-stored keys need the SETTINGS_ENV_FILE mount and return 501 without
// it. Secrets are masked as "***"; echoing "***" back on PUT leaves them
// unchanged.
func handleAppSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		fields, err := appsettings.FieldsByKey()
		if err != nil {
			writeError(w, err)
			return
		}
		schema, err := appsettings.Load()
		if err != nil {
			writeError(w, err)
			return
		}
		rows, ok := settingsRows(w)
		if !ok {
			return
		}
		path, writableFile := settingsFileStatus()
		writeJSON(w, map[string]any{
			"writableFile": writableFile,
			"db":           appSettingsStore != nil,
			"file":         path,
			"fileKeys":     fileBackedKeys(fields),
			"schema":       schema,
			"values":       appsettings.DisplayValuesWithRow(fields, rows, os.Getenv),
		})
	case http.MethodPut:
		var payload appSettingsValuesPayload
		if err := decodeJSON(r, &payload); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if len(payload.Values) == 0 {
			http.Error(w, "no settings provided", http.StatusBadRequest)
			return
		}
		fields, err := appsettings.FieldsByKey()
		if err != nil {
			writeError(w, err)
			return
		}
		for key, value := range payload.Values {
			if err := appsettings.Validate(key, value, fields); err != nil {
				var validationErr appsettings.ValidationError
				if errors.As(err, &validationErr) {
					http.Error(w, validationErr.Error(), http.StatusBadRequest)
					return
				}
				writeError(w, err)
				return
			}
		}
		keys := make([]string, 0, len(payload.Values))
		for key := range payload.Values {
			keys = append(keys, key)
		}
		dbKeys, fileKeys := appsettings.PartitionKeys(keys, fields)

		updated := []string{}
		actor := settingsActor(r)
		path, writableFile := settingsFileStatus()
		fileSynced := false
		if len(fileKeys) > 0 {
			if !writableFile {
				http.Error(w, fmt.Sprintf("settings file is not configured or not writable (keys: %s)", strings.Join(fileKeys, ", ")), http.StatusNotImplemented)
				return
			}
			fileValues := make(map[string]string, len(fileKeys))
			for _, key := range fileKeys {
				fileValues[key] = payload.Values[key]
			}
			if _, err := appsettings.Apply(path, fileValues, fields); err != nil {
				writeError(w, err)
				return
			}
			fileSynced = true
		}
		if len(dbKeys) > 0 {
			if appSettingsStore == nil {
				http.Error(w, "settings database is not configured", http.StatusInternalServerError)
				return
			}
			// Dual-write db keys into the mounted file when available so
			// services that still read the dotenv (mm-controller,
			// fiat-controller, …) pick them up on recreate exactly as before.
			if writableFile {
				dbFileValues := make(map[string]string, len(dbKeys))
				for _, key := range dbKeys {
					dbFileValues[key] = payload.Values[key]
				}
				if _, err := appsettings.Apply(path, dbFileValues, fields); err != nil {
					writeError(w, err)
					return
				}
				fileSynced = true
			}
			for _, key := range dbKeys {
				value := payload.Values[key]
				if fields[key].Type == "secret" && value == appsettings.MaskedSecret {
					continue
				}
				if err := appSettingsStore.Set(context.Background(), key, value, fields[key].Type == "secret", actor); err != nil {
					writeError(w, err)
					return
				}
				updated = append(updated, key)
			}
		}
		updated = append(updated, fileKeys...)
		sort.Strings(updated)
		rows, ok := settingsRows(w)
		if !ok {
			return
		}
		slog.Info("app-settings updated",
			"actor", actor,
			"keys", updated,
			"restart", appsettings.RestartServicesFor(updated, fields),
			"fileSynced", fileSynced,
			"file", path)
		writeJSON(w, map[string]any{
			"updated":    updated,
			"restart":    appsettings.RestartServicesFor(updated, fields),
			"fileSynced": fileSynced,
			"values":     appsettings.DisplayValuesWithRow(fields, rows, os.Getenv),
		})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

// handleAppSettingsReveal returns the real value of one secret-type setting.
// Mirrors POST /api/phone-push/setup/reveal: authenticated operators only.
func handleAppSettingsReveal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var payload appSettingsRevealPayload
	if err := decodeJSON(r, &payload); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	fields, err := appsettings.FieldsByKey()
	if err != nil {
		writeError(w, err)
		return
	}
	field, ok := fields[payload.Key]
	if !ok || field.Type != "secret" {
		http.Error(w, "no such secret", http.StatusNotFound)
		return
	}
	rows, ok := settingsRows(w)
	if !ok {
		return
	}
	if field.StoredInDB() {
		if row, ok := rows[payload.Key]; ok && strings.TrimSpace(row.Value) != "" {
			writeJSON(w, map[string]string{"key": payload.Key, "value": row.Value})
			return
		}
	}
	if !appsettings.SecretSetWithRow(payload.Key, fields, rows, os.Getenv) {
		http.Error(w, "secret not set", http.StatusNotFound)
		return
	}
	writeJSON(w, map[string]string{"key": payload.Key, "value": os.Getenv(payload.Key)})
}
