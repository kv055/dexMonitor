package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func decodeAppSettingsBody(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	return decoded
}

func TestHandleAppSettingsGetReadOnly(t *testing.T) {
	t.Setenv("SETTINGS_ENV_FILE", "")
	t.Setenv("PUBLIC_HOSTNAME", "host.example.com")
	t.Setenv("TELEGRAM_BOT_TOKEN", "shh")

	req := httptest.NewRequest(http.MethodGet, "/api/app-settings", nil)
	recorder := httptest.NewRecorder()
	handleAppSettings(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	decoded := decodeAppSettingsBody(t, recorder.Body.Bytes())
	if decoded["writable"] != false {
		t.Errorf("writable = %v, want false", decoded["writable"])
	}
	values, ok := decoded["values"].(map[string]any)
	if !ok {
		t.Fatalf("values missing: %v", decoded)
	}
	if values["PUBLIC_HOSTNAME"] != "host.example.com" {
		t.Errorf("PUBLIC_HOSTNAME = %v", values["PUBLIC_HOSTNAME"])
	}
	if values["TELEGRAM_BOT_TOKEN"] != "***" {
		t.Errorf("secret not masked: %v", values["TELEGRAM_BOT_TOKEN"])
	}
	schema, ok := decoded["schema"].(map[string]any)
	if !ok || len(schema) == 0 {
		t.Errorf("schema missing: %v", decoded)
	}
}

func TestHandleAppSettingsPutRoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if err := os.WriteFile(path, []byte("PUBLIC_HOSTNAME=old.example.com\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SETTINGS_ENV_FILE", path)

	req := httptest.NewRequest(http.MethodPut, "/api/app-settings",
		strings.NewReader(`{"values":{"PUBLIC_HOSTNAME":"new.example.com"}}`))
	recorder := httptest.NewRecorder()
	handleAppSettings(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body.String())
	}
	decoded := decodeAppSettingsBody(t, recorder.Body.Bytes())
	updated, _ := decoded["updated"].([]any)
	if len(updated) != 1 || updated[0] != "PUBLIC_HOSTNAME" {
		t.Errorf("updated = %v", decoded["updated"])
	}
	restart, _ := decoded["restart"].([]any)
	if len(restart) == 0 {
		t.Errorf("restart empty: %v", decoded)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "PUBLIC_HOSTNAME=new.example.com") {
		t.Errorf("file not updated:\n%s", raw)
	}
}

func TestHandleAppSettingsPutRejects(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if err := os.WriteFile(path, []byte("PUBLIC_HOSTNAME=a.example.com\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("SETTINGS_ENV_FILE", path)

	for name, body := range map[string]string{
		"unknown key":  `{"values":{"NOPE_UNKNOWN":"x"}}`,
		"bad value":    `{"values":{"PAYMENT_EMAIL_MODE":"yolo"}}`,
		"empty values": `{"values":{}}`,
	} {
		req := httptest.NewRequest(http.MethodPut, "/api/app-settings", strings.NewReader(body))
		recorder := httptest.NewRecorder()
		handleAppSettings(recorder, req)
		if recorder.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", name, recorder.Code)
		}
	}

	// Unconfigured file → 501, not 500.
	t.Setenv("SETTINGS_ENV_FILE", "")
	req := httptest.NewRequest(http.MethodPut, "/api/app-settings",
		strings.NewReader(`{"values":{"PUBLIC_HOSTNAME":"x.example.com"}}`))
	recorder := httptest.NewRecorder()
	handleAppSettings(recorder, req)
	if recorder.Code != http.StatusNotImplemented {
		t.Errorf("unconfigured: status = %d, want 501", recorder.Code)
	}
}

func TestHandleAppSettingsReveal(t *testing.T) {
	t.Setenv("TELEGRAM_BOT_TOKEN", "real-secret")

	req := httptest.NewRequest(http.MethodPost, "/api/app-settings/reveal",
		strings.NewReader(`{"key":"TELEGRAM_BOT_TOKEN"}`))
	recorder := httptest.NewRecorder()
	handleAppSettingsReveal(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	decoded := decodeAppSettingsBody(t, recorder.Body.Bytes())
	if decoded["value"] != "real-secret" {
		t.Errorf("value = %v", decoded["value"])
	}

	for name, body := range map[string]string{
		"non-secret": `{"key":"PUBLIC_HOSTNAME"}`,
		"unknown":    `{"key":"NOPE_UNKNOWN"}`,
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/app-settings/reveal", strings.NewReader(body))
		recorder := httptest.NewRecorder()
		handleAppSettingsReveal(recorder, req)
		if recorder.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404", name, recorder.Code)
		}
	}
}
