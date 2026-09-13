package appsettings

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
)

// SettingsEnvFile is the process env var pointing at the writable root .env.
// Empty (the default) means read-only mode: values are served from the process
// environment but PUT is rejected. The dexmonitor compose service does not
// mount the root .env by default; operators enable writes by mounting it, e.g.
// volumes: ["./.env:/settings/root.env:rw"] with SETTINGS_ENV_FILE=/settings/root.env.
const SettingsEnvFile = "SETTINGS_ENV_FILE"

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
func Apply(path string, values map[string]string, fields map[string]Field) (ApplyResult, error) {
	for key, value := range values {
		if err := Validate(key, value, fields); err != nil {
			return ApplyResult{}, err
		}
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		return ApplyResult{}, fmt.Errorf("read settings file: %w", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		return ApplyResult{}, fmt.Errorf("stat settings file: %w", err)
	}
	if !info.Mode().IsRegular() {
		return ApplyResult{}, fmt.Errorf("settings file is not a regular file")
	}

	pending := make(map[string]string, len(values))
	for key, value := range values {
		if fields[key].Type == "secret" && value == MaskedSecret {
			continue
		}
		pending[key] = value
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
	if err := os.WriteFile(path, []byte(out), info.Mode().Perm()); err != nil {
		return ApplyResult{}, fmt.Errorf("write settings file: %w", err)
	}
	return ApplyResult{Updated: updated, Restart: RestartServicesFor(updated, fields)}, nil
}
