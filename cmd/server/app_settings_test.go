package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"dexmonitor/internal/appsettings"
)

// fakeSettingsStore is an in-memory appsettings.Store. Secrets are stored
// with an "enc:" prefix to prove the handler requested encryption.
type fakeSettingsStore struct {
	rows   map[string]appsettings.Setting
	setErr error
	getErr error
}

func newFakeSettingsStore() *fakeSettingsStore {
	return &fakeSettingsStore{rows: map[string]appsettings.Setting{}}
}

func (f *fakeSettingsStore) EnsureSchema(ctx context.Context) error { return nil }

func (f *fakeSettingsStore) GetAll(ctx context.Context) (map[string]appsettings.Setting, error) {
	if f.getErr != nil {
		return nil, f.getErr
	}
	out := make(map[string]appsettings.Setting, len(f.rows))
	for k, v := range f.rows {
		out[k] = v
	}
	return out, nil
}

func (f *fakeSettingsStore) Set(ctx context.Context, key, value string, encrypt bool, actor string) error {
	if f.setErr != nil {
		return f.setErr
	}
	if encrypt {
		value = "enc:" + value
	}
	f.rows[key] = appsettings.Setting{Value: value, Encrypted: encrypt, UpdatedBy: actor}
	return nil
}

func (f *fakeSettingsStore) SeedMissing(ctx context.Context, fields map[string]appsettings.Field, getenv func(string) string, actor string) (int, error) {
	return 0, nil
}

func useFakeSettingsStore(t *testing.T, store *fakeSettingsStore) {
	t.Helper()
	appSettingsStore = store
	t.Cleanup(func() { appSettingsStore = nil })
}

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
	if decoded["writableFile"] != false {
		t.Errorf("writableFile = %v, want false", decoded["writableFile"])
	}
	if decoded["db"] != false {
		t.Errorf("db = %v, want false without store", decoded["db"])
	}
	fileKeys, _ := decoded["fileKeys"].([]any)
	found := false
	for _, k := range fileKeys {
		if k == "PUBLIC_HOSTNAME" {
			found = true
		}
	}
	if !found {
		t.Errorf("fileKeys missing PUBLIC_HOSTNAME: %v", decoded["fileKeys"])
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
	if decoded["fileSynced"] != true {
		t.Errorf("fileSynced = %v, want true with mount", decoded["fileSynced"])
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

func TestHandleAppSettingsPutWritesBackup(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	original := "PUBLIC_HOSTNAME=old.example.com\n"
	if err := os.WriteFile(path, []byte(original), 0o600); err != nil {
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
	backup, err := os.ReadFile(path + ".bak")
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if string(backup) != original {
		t.Errorf("backup = %q, want original %q", backup, original)
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

func TestHandleAppSettingsPutDBKeysWithoutMount(t *testing.T) {
	// Db-stored keys persist without any file mount: the read-only panel
	// becomes editable for them.
	t.Setenv("SETTINGS_ENV_FILE", "")
	store := newFakeSettingsStore()
	useFakeSettingsStore(t, store)

	req := httptest.NewRequest(http.MethodPut, "/api/app-settings",
		strings.NewReader(`{"values":{"SCRAPING_ENABLED":"true","SNAPSHOT_INTERVAL_MIN":"3"}}`))
	recorder := httptest.NewRecorder()
	handleAppSettings(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body.String())
	}
	decoded := decodeAppSettingsBody(t, recorder.Body.Bytes())
	updated, _ := decoded["updated"].([]any)
	if len(updated) != 2 {
		t.Errorf("updated = %v, want 2 keys", decoded["updated"])
	}
	if decoded["fileSynced"] != false {
		t.Errorf("fileSynced = %v, want false without mount", decoded["fileSynced"])
	}
	if store.rows["SCRAPING_ENABLED"].Value != "true" {
		t.Errorf("SCRAPING_ENABLED not stored: %+v", store.rows["SCRAPING_ENABLED"])
	}
	if store.rows["SNAPSHOT_INTERVAL_MIN"].Value != "3" {
		t.Errorf("SNAPSHOT_INTERVAL_MIN not stored: %+v", store.rows["SNAPSHOT_INTERVAL_MIN"])
	}
	values, _ := decoded["values"].(map[string]any)
	if values["SCRAPING_ENABLED"] != "true" {
		t.Errorf("response values not refreshed from db: %v", values["SCRAPING_ENABLED"])
	}
}

func TestHandleAppSettingsPutMixedWithoutMountLeavesDBUntouched(t *testing.T) {
	// File-backed keys without a mount reject the whole request before any
	// database write, so a mixed payload is all-or-nothing.
	t.Setenv("SETTINGS_ENV_FILE", "")
	store := newFakeSettingsStore()
	useFakeSettingsStore(t, store)

	req := httptest.NewRequest(http.MethodPut, "/api/app-settings",
		strings.NewReader(`{"values":{"SCRAPING_ENABLED":"true","PUBLIC_HOSTNAME":"x.example.com"}}`))
	recorder := httptest.NewRecorder()
	handleAppSettings(recorder, req)

	if recorder.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want 501", recorder.Code)
	}
	if len(store.rows) != 0 {
		t.Errorf("db written despite file rejection: %v", store.rows)
	}
}

func TestHandleAppSettingsPutDBSecret(t *testing.T) {
	t.Setenv("SETTINGS_ENV_FILE", "")
	store := newFakeSettingsStore()
	store.rows["TELEGRAM_BOT_TOKEN"] = appsettings.Setting{Value: "old", Encrypted: true}
	useFakeSettingsStore(t, store)

	// Masked sentinel leaves the stored secret unchanged.
	req := httptest.NewRequest(http.MethodPut, "/api/app-settings",
		strings.NewReader(`{"values":{"TELEGRAM_BOT_TOKEN":"***"}}`))
	recorder := httptest.NewRecorder()
	handleAppSettings(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body.String())
	}
	if store.rows["TELEGRAM_BOT_TOKEN"].Value != "old" {
		t.Errorf("masked save overwrote secret: %+v", store.rows["TELEGRAM_BOT_TOKEN"])
	}

	// A real value is stored encrypted.
	req = httptest.NewRequest(http.MethodPut, "/api/app-settings",
		strings.NewReader(`{"values":{"TELEGRAM_BOT_TOKEN":"new-secret"}}`))
	recorder = httptest.NewRecorder()
	handleAppSettings(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", recorder.Code, recorder.Body.String())
	}
	got := store.rows["TELEGRAM_BOT_TOKEN"]
	if got.Value != "enc:new-secret" || !got.Encrypted {
		t.Errorf("secret not stored encrypted: %+v", got)
	}
}

func TestHandleAppSettingsPutDBKeysWithoutStore(t *testing.T) {
	// No database configured: db-key writes fail closed, not silently.
	t.Setenv("SETTINGS_ENV_FILE", "")
	req := httptest.NewRequest(http.MethodPut, "/api/app-settings",
		strings.NewReader(`{"values":{"SCRAPING_ENABLED":"true"}}`))
	recorder := httptest.NewRecorder()
	handleAppSettings(recorder, req)
	if recorder.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500", recorder.Code)
	}
}

func TestHandleAppSettingsGetShowsDBValues(t *testing.T) {
	t.Setenv("SETTINGS_ENV_FILE", "")
	store := newFakeSettingsStore()
	store.rows["SCRAPING_ENABLED"] = appsettings.Setting{Value: "true"}
	store.rows["TELEGRAM_BOT_TOKEN"] = appsettings.Setting{Value: "enc:shh", Encrypted: true}
	useFakeSettingsStore(t, store)

	req := httptest.NewRequest(http.MethodGet, "/api/app-settings", nil)
	recorder := httptest.NewRecorder()
	handleAppSettings(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	decoded := decodeAppSettingsBody(t, recorder.Body.Bytes())
	if decoded["db"] != true {
		t.Errorf("db = %v, want true with store", decoded["db"])
	}
	values, _ := decoded["values"].(map[string]any)
	if values["SCRAPING_ENABLED"] != "true" {
		t.Errorf("db value not shown: %v", values["SCRAPING_ENABLED"])
	}
	if values["TELEGRAM_BOT_TOKEN"] != "***" {
		t.Errorf("db secret not masked: %v", values["TELEGRAM_BOT_TOKEN"])
	}
}

func TestHandleAppSettingsRevealDBSecret(t *testing.T) {
	store := newFakeSettingsStore()
	store.rows["TELEGRAM_BOT_TOKEN"] = appsettings.Setting{Value: "real-secret", Encrypted: true}
	useFakeSettingsStore(t, store)

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
}

func TestLoadDBBackedRuntimeConfig(t *testing.T) {
	store := newFakeSettingsStore()
	store.rows["SNAPSHOT_INTERVAL_MIN"] = appsettings.Setting{Value: "7"}
	store.rows["PUSHPUSH_NOTIFY_SECRET"] = appsettings.Setting{Value: "enc:sekret", Encrypted: true}
	store.rows["PUSHPUSH_HEARTBEAT_MAX_AGE"] = appsettings.Setting{Value: "20m"}
	store.rows["MM_CEX_CAPABILITY_MAX_AGE"] = appsettings.Setting{Value: "45m"}
	useFakeSettingsStore(t, store)

	oldInterval, oldSecret, oldHeartbeat, oldCap := snapshotIntervalMin, pushpushNotifySecret, pushpushHeartbeatMaxAge, capabilityMaxAge
	defer func() {
		snapshotIntervalMin, pushpushNotifySecret, pushpushHeartbeatMaxAge, capabilityMaxAge =
			oldInterval, oldSecret, oldHeartbeat, oldCap
	}()

	if err := loadDBBackedRuntimeConfig(context.Background()); err != nil {
		t.Fatalf("loadDBBackedRuntimeConfig: %v", err)
	}
	if snapshotIntervalMin != 7 {
		t.Errorf("snapshotIntervalMin = %d, want 7", snapshotIntervalMin)
	}
	if pushpushNotifySecret != "enc:sekret" {
		t.Errorf("pushpushNotifySecret = %q", pushpushNotifySecret)
	}
	if pushpushHeartbeatMaxAge.String() != "20m0s" {
		t.Errorf("pushpushHeartbeatMaxAge = %v", pushpushHeartbeatMaxAge)
	}
	if capabilityMaxAge.String() != "45m0s" {
		t.Errorf("capabilityMaxAge = %v", capabilityMaxAge)
	}
}

func TestSettingsActorUnknownWithoutAuth(t *testing.T) {
	// settingsAuth is only set in main; handlers in tests attribute to unknown.
	req := httptest.NewRequest(http.MethodPut, "/api/app-settings", nil)
	if got := settingsActor(req); got != "unknown" {
		t.Errorf("actor = %q, want unknown", got)
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
