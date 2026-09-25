package appsettings

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
)

// SettingsEnvFile is the process env var pointing at the writable root .env.
// Empty (the default) means read-only mode: values are served from the process
// environment but PUT is rejected. The dexmonitor compose service does not
// mount the root .env by default; operators enable writes with two changes
// (root .env values are only compose interpolation and are NOT auto-injected
// into containers):
// volumes: ["./.env:/settings/root.env:rw"] (dexmonitor service) plus
// environment: ["SETTINGS_ENV_FILE=/settings/root.env"] (dexmonitor service).
const SettingsEnvFile = "SETTINGS_ENV_FILE"

// backupPath is the rotating pre-write backup kept next to the settings file.
func backupPath(path string) string { return path + ".bak" }

// lockPath is the sidecar file guarding read-modify-write cycles. The lock
// lives in its own file (rather than on the settings file itself) so it stays
// valid across the atomic rename used for the write.
func lockPath(path string) string { return path + ".lock" }

// dotenvLine matches an active KEY=value assignment, preserving any leading
// whitespace and everything after the raw value (trailing comments are kept
// verbatim on update).
var dotenvLine = regexp.MustCompile(`^(\s*)([A-Za-z_][A-Za-z0-9_]*)=(.*)$`)

// DisplayValue returns the value shown to operators: schema default when the
// process env is empty, MaskedSecret for set secrets.
func DisplayValue(field Field, getenv func(string) string) string {
	value := strings.TrimSpace(getenv(field.Key))
	if value == "" {
		return field.Default
	}
	if field.Type == "secret" {
		return MaskedSecret
	}
	return value
}

// DisplayValues returns display values for every schema field.
func DisplayValues(fields map[string]Field, getenv func(string) string) map[string]string {
	values := make(map[string]string, len(fields))
	for key, field := range fields {
		values[key] = DisplayValue(field, getenv)
	}
	return values
}

// SecretSet reports whether a secret has a non-empty process env value.
func SecretSet(key string, getenv func(string) string) bool {
	fields, err := FieldsByKey()
	if err != nil {
		return false
	}
	field, ok := fields[key]
	if !ok || field.Type != "secret" {
		return false
	}
	return strings.TrimSpace(getenv(key)) != ""
}

// formatValue renders a value for dotenv output, quoting only when needed.
func formatValue(value string) string {
	if value == "" {
		return ""
	}
	if strings.ContainsAny(value, " \t#\"'") {
		return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(value) + `"`
	}
	return value
}

// ApplyResult describes one successful settings write.
type ApplyResult struct {
	Updated []string `json:"updated"`
	// Restart lists compose services to recreate, e.g. `docker compose up -d`.
	Restart []string `json:"restart"`
}

// Apply validates values against the schema and writes them into the dotenv
// file at path, preserving comments, order and quoting style of untouched
// lines. Keys missing from the file are appended. The MaskedSecret sentinel
// on a secret means "leave unchanged" and is skipped.
//
// The write is serialized with an exclusive flock on a sidecar lock file, so
// concurrent saves cannot interleave read-modify-write cycles and lose edits.
// Before replacing the file, the previous content is copied to "<path>.bak"
// (same permissions, rotating) and the new content is written to a temp file
// and atomically renamed, so a crash cannot leave a truncated settings file.
// When nothing would change, the file (and its backup) is left untouched.
func Apply(path string, values map[string]string, fields map[string]Field) (ApplyResult, error) {
	for key, value := range values {
		if err := Validate(key, value, fields); err != nil {
			return ApplyResult{}, err
		}
	}

	pending := make(map[string]string, len(values))
	for key, value := range values {
		if fields[key].Type == "secret" && value == MaskedSecret {
			continue
		}
		pending[key] = value
	}
	if len(pending) == 0 {
		return ApplyResult{}, nil
	}

	lock, err := os.OpenFile(lockPath(path), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return ApplyResult{}, fmt.Errorf("open settings lock: %w", err)
	}
	defer func() { _ = lock.Close() }()
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return ApplyResult{}, fmt.Errorf("lock settings file: %w", err)
	}
	defer func() { _ = syscall.Flock(int(lock.Fd()), syscall.LOCK_UN) }()

	info, err := os.Stat(path)
	if err != nil {
		return ApplyResult{}, fmt.Errorf("stat settings file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return ApplyResult{}, fmt.Errorf("settings file is not a regular file")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return ApplyResult{}, fmt.Errorf("read settings file: %w", err)
	}

	lines := strings.Split(string(raw), "\n")
	seen := make(map[string]bool, len(pending))
	for i, line := range lines {
		match := dotenvLine.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		key := match[2]
		value, ok := pending[key]
		if !ok || seen[key] {
			continue
		}
		seen[key] = true
		lines[i] = match[1] + key + "=" + formatValue(value)
	}

	var appended []string
	for key := range pending {
		if !seen[key] {
			appended = append(appended, key)
		}
	}
	sort.Strings(appended)
	for _, key := range appended {
		lines = append(lines, key+"="+formatValue(pending[key]))
	}

	updated := make([]string, 0, len(pending))
	for key := range pending {
		updated = append(updated, key)
	}
	sort.Strings(updated)

	out := strings.Join(lines, "\n")
	if out == string(raw) {
		return ApplyResult{Updated: updated, Restart: RestartServicesFor(updated, fields)}, nil
	}

	perm := info.Mode().Perm()
	if err := os.WriteFile(backupPath(path), raw, perm); err != nil {
		return ApplyResult{}, fmt.Errorf("write settings backup: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".env.tmp-*")
	if err != nil {
		return ApplyResult{}, fmt.Errorf("create settings temp file: %w", err)
	}
	tmpName := tmp.Name()
	defer func() {
		if tmpName != "" {
			_ = os.Remove(tmpName)
		}
	}()
	if err := tmp.Chmod(perm); err != nil {
		_ = tmp.Close()
		return ApplyResult{}, fmt.Errorf("chmod settings temp file: %w", err)
	}
	if _, err := tmp.WriteString(out); err != nil {
		_ = tmp.Close()
		return ApplyResult{}, fmt.Errorf("write settings temp file: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return ApplyResult{}, fmt.Errorf("sync settings temp file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return ApplyResult{}, fmt.Errorf("close settings temp file: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return ApplyResult{}, fmt.Errorf("replace settings file: %w", err)
	}
	tmpName = ""
	return ApplyResult{Updated: updated, Restart: RestartServicesFor(updated, fields)}, nil
}
