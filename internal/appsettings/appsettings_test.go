package appsettings

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func testFields(t *testing.T) map[string]Field {
	t.Helper()
	fields, err := FieldsByKey()
	if err != nil {
		t.Fatalf("FieldsByKey: %v", err)
	}
	if len(fields) == 0 {
		t.Fatal("schema has no fields")
	}
	return fields
}

func TestValidate(t *testing.T) {
	fields := testFields(t)
	cases := []struct {
		key     string
		value   string
		wantErr bool
	}{
		{"PUBLIC_HOSTNAME", "dexmonitor.live", false},
		{"PUBLIC_HOSTNAME", "not a host!", true},
		{"PUBLIC_HOSTNAME", "", true}, // required
		{"LETSENCRYPT_EMAIL", "ops@example.com", false},
		{"LETSENCRYPT_EMAIL", "not-an-email", true},
		{"DEXMM_TELEGRAM_WEBHOOK_URL", "https://example.com/hook", false},
		{"DEXMM_TELEGRAM_WEBHOOK_URL", "ftp://example.com/hook", true},
		{"SESSION_COOKIE_SECURE", "true", false},
		{"SESSION_COOKIE_SECURE", "yes", true},
		{"PAYMENT_EMAIL_MODE", "shadow", false},
		{"PAYMENT_EMAIL_MODE", "yolo", true},
		{"PAYMENT_EMAIL_ACTIVATION_UID", "42", false},
		{"PAYMENT_EMAIL_ACTIVATION_UID", "-1", true},
		{"PAYMENT_EMAIL_POLL_INTERVAL", "5m", false},
		{"PAYMENT_EMAIL_POLL_INTERVAL", "five", true},
		{"TELEGRAM_BOT_TOKEN", "anything-goes", false},
		{"TELEGRAM_BOT_TOKEN", "line\nbreak", true},
		{"NOPE_UNKNOWN", "x", true},
	}
	for _, tc := range cases {
		if err := Validate(tc.key, tc.value, fields); (err != nil) != tc.wantErr {
			t.Errorf("Validate(%q, %q) err=%v wantErr=%v", tc.key, tc.value, err, tc.wantErr)
		} else if err != nil {
			var validationErr ValidationError
			if !errors.As(err, &validationErr) {
				t.Errorf("Validate(%q, %q) err is not a ValidationError: %T", tc.key, tc.value, err)
			}
		}
	}
}

func TestApplyPreservesFile(t *testing.T) {
	fields := testFields(t)
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	original := "# comment\nPUBLIC_HOSTNAME=old.example.com\n\n# trailing note\nEMPTY=\n"
	if err := os.WriteFile(path, []byte(original), 0o600); err != nil {
		t.Fatal(err)
	}

	result, err := Apply(path, map[string]string{
		"PUBLIC_HOSTNAME":    "new.example.com",
		"LETSENCRYPT_EMAIL":  "ops@example.com",
		"TELEGRAM_BOT_TOKEN": MaskedSecret, // unchanged sentinel
	}, fields)
	if err != nil {
		t.Fatalf("Apply: %v", err)
	}
	if !reflect.DeepEqual(result.Updated, []string{"LETSENCRYPT_EMAIL", "PUBLIC_HOSTNAME"}) {
		t.Errorf("updated = %v", result.Updated)
	}
	if len(result.Restart) == 0 {
		t.Error("expected restart services")
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	content := string(raw)
	for _, want := range []string{
		"# comment",
		"PUBLIC_HOSTNAME=new.example.com",
		"# trailing note",
		"EMPTY=",
		"LETSENCRYPT_EMAIL=ops@example.com",
	} {
		if !strings.Contains(content, want) {
			t.Errorf("result missing %q:\n%s", want, content)
		}
	}
	if strings.Contains(content, "TELEGRAM_BOT_TOKEN") {
		t.Errorf("masked secret must not be written:\n%s", content)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("mode = %o, want 600", info.Mode().Perm())
	}
}

func TestApplyRejectsUnknownAndBadValues(t *testing.T) {
	fields := testFields(t)
	dir := t.TempDir()
	path := filepath.Join(dir, ".env")
	if err := os.WriteFile(path, []byte("PUBLIC_HOSTNAME=a.example.com\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)

	for name, values := range map[string]map[string]string{
		"unknown key": {"NOPE_UNKNOWN": "x"},
		"bad value":   {"PAYMENT_EMAIL_MODE": "yolo"},
	} {
		if _, err := Apply(path, values, fields); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Errorf("file changed on rejected apply:\n%s", string(after))
	}
}

func TestDisplayValues(t *testing.T) {
	fields := testFields(t)
	getenv := func(key string) string {
		switch key {
		case "TELEGRAM_BOT_TOKEN":
			return "real-secret"
		case "PUBLIC_HOSTNAME":
			return "host.example.com"
		default:
			return ""
		}
	}
	values := DisplayValues(fields, getenv)
	if values["TELEGRAM_BOT_TOKEN"] != MaskedSecret {
		t.Errorf("secret not masked: %q", values["TELEGRAM_BOT_TOKEN"])
	}
	if values["PUBLIC_HOSTNAME"] != "host.example.com" {
		t.Errorf("value = %q", values["PUBLIC_HOSTNAME"])
	}
	if values["PAYMENT_EMAIL_MODE"] != "capture" {
		t.Errorf("default not applied: %q", values["PAYMENT_EMAIL_MODE"])
	}
}
