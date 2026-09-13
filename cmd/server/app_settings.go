package main

import (
	"errors"
	"net/http"
	"os"

	"dexmonitor/internal/appsettings"
)

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

// handleAppSettings serves GET (schema + effective values) and PUT (whitelisted
// dotenv update) for the user-facing settings in settings.schema.json.
// Secrets are masked as "***"; echoing "***" back on PUT leaves them unchanged.
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
		path, writable := settingsFileStatus()
		writeJSON(w, map[string]any{
			"writable": writable,
			"file":     path,
			"schema":   schema,
			"values":   appsettings.DisplayValues(fields, os.Getenv),
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
		path, writable := settingsFileStatus()
		if !writable {
			http.Error(w, "settings file is not configured or not writable", http.StatusNotImplemented)
			return
		}
		fields, err := appsettings.FieldsByKey()
		if err != nil {
			writeError(w, err)
			return
		}
		result, err := appsettings.Apply(path, payload.Values, fields)
		if err != nil {
			var validationErr appsettings.ValidationError
			if errors.As(err, &validationErr) {
				http.Error(w, validationErr.Error(), http.StatusBadRequest)
				return
			}
			writeError(w, err)
			return
		}
		writeJSON(w, map[string]any{
			"updated": result.Updated,
			"restart": result.Restart,
			"values":  appsettings.DisplayValues(fields, os.Getenv),
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
	if !appsettings.SecretSet(payload.Key, os.Getenv) {
		http.Error(w, "secret not set", http.StatusNotFound)
		return
	}
	writeJSON(w, map[string]string{"key": payload.Key, "value": os.Getenv(payload.Key)})
}
