package appsettings

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/mail"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed schema.json
var schemaJSON []byte

// MaskedSecret is the sentinel for a set secret, mirroring the "***"
// convention of the trading-accounts masking. Clients send it back to mean
// "leave unchanged".
const MaskedSecret = "***"

// Field is one user-facing setting backed by a root .env key.
type Field struct {
	Key             string   `json:"key"`
	Label           string   `json:"label"`
	Description     string   `json:"description,omitempty"`
	Type            string   `json:"type"`
	Owner           string   `json:"owner,omitempty"`
	Default         string   `json:"default,omitempty"`
	Required        bool     `json:"required,omitempty"`
	Enum            []string `json:"enum,omitempty"`
	RestartServices []string `json:"restartServices,omitempty"`
}

// Section groups fields for the Settings page.
type Section struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Description string  `json:"description,omitempty"`
	Fields      []Field `json:"fields"`
}

// Schema is the parsed settings.schema.json whitelist.
type Schema struct {
	Sections []Section `json:"sections"`
}

var (
	loadOnce   sync.Once
	loaded     *Schema
	loadedErr  error
	fieldsOnce sync.Once
	byKey      map[string]Field
)

// Load parses the embedded schema whitelist.
func Load() (*Schema, error) {
	loadOnce.Do(func() {
		var schema Schema
		if err := json.Unmarshal(schemaJSON, &schema); err != nil {
			loadedErr = fmt.Errorf("parse settings schema: %w", err)
			return
		}
		if len(schema.Sections) == 0 {
			loadedErr = fmt.Errorf("settings schema has no sections")
			return
		}
		loaded = &schema
	})
	return loaded, loadedErr
}

// FieldsByKey indexes every schema field by env key.
func FieldsByKey() (map[string]Field, error) {
	fieldsOnce.Do(func() {
		schema, err := Load()
		if err != nil {
			return
		}
		byKey = make(map[string]Field)
		for _, section := range schema.Sections {
			for _, field := range section.Fields {
				byKey[field.Key] = field
			}
		}
	})
	if byKey == nil {
		return nil, fmt.Errorf("settings schema unavailable")
	}
	return byKey, nil
}

// ValidationError marks rejected user input (mapped to HTTP 400 by handlers).
type ValidationError struct {
	err error
}

func (e ValidationError) Error() string { return e.err.Error() }
func (e ValidationError) Unwrap() error { return e.err }

func validationErrorf(format string, args ...any) ValidationError {
	return ValidationError{err: fmt.Errorf(format, args...)}
}

var hostnamePattern = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$`)

// Validate checks one KEY=value pair against the schema whitelist.
// It rejects unknown keys, control characters and type violations.
// An empty value is allowed unless the field is required.
func Validate(key, value string, fields map[string]Field) error {
	field, ok := fields[key]
	if !ok {
		return validationErrorf("unknown setting %q", key)
	}
	if strings.ContainsAny(value, "\n\r") {
		return validationErrorf("%s must not contain line breaks", key)
	}
	if value == "" {
		if field.Required {
			return validationErrorf("%s is required", key)
		}
		return nil
	}
	switch field.Type {
	case "bool":
		if _, err := strconv.ParseBool(value); err != nil {
			return validationErrorf("%s must be true or false", key)
		}
	case "int":
		n, err := strconv.Atoi(value)
		if err != nil || n < 0 {
			return validationErrorf("%s must be a non-negative integer", key)
		}
	case "duration":
		d, err := time.ParseDuration(value)
		if err != nil || d < 0 {
			return validationErrorf("%s must be a duration like 30s, 5m or 2h", key)
		}
	case "enum":
		for _, allowed := range field.Enum {
			if value == allowed {
				return nil
			}
		}
		return validationErrorf("%s must be one of: %s", key, strings.Join(field.Enum, ", "))
	case "email":
		if _, err := mail.ParseAddress(value); err != nil {
			return validationErrorf("%s must be an email address", key)
		}
	case "url":
		parsed, err := url.ParseRequestURI(value)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
			return validationErrorf("%s must be an http(s) URL", key)
		}
	case "hostname":
		if !hostnamePattern.MatchString(value) {
			return validationErrorf("%s must be a hostname", key)
		}
	case "string", "secret":
		return nil
	default:
		return validationErrorf("%s has unknown type %q", key, field.Type)
	}
	return nil
}

// RestartServicesFor returns the sorted union of services to recreate after
// changing the given keys (e.g. via `docker compose up -d <services>`).
func RestartServicesFor(keys []string, fields map[string]Field) []string {
	seen := make(map[string]struct{})
	for _, key := range keys {
		for _, service := range fields[key].RestartServices {
			seen[service] = struct{}{}
		}
	}
	services := make([]string, 0, len(seen))
	for service := range seen {
		services = append(services, service)
	}
	sort.Strings(services)
	return services
}
