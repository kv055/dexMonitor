package accounthealth

import (
	"commons/apierror"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// KeyPermissionResult reports normalized permissions for one API key.
type KeyPermissionResult struct {
	KeyID       uint              `json:"key_id"`
	Name        string            `json:"name"`
	Permissions map[string]string `json:"permissions"`
	Error       string            `json:"error,omitempty"`
}

// MMControllerResponse represents a mmcontroller response.
type MMControllerResponse struct {
	// Provider is the provider value for the mmcontroller response.
	Provider string `json:"provider"`
	// Status is the current status of the mmcontroller response.
	Status string `json:"status"`
	// Healthy reports whether the mmcontroller response condition is true.
	Healthy bool `json:"healthy"`
	// Message carries a human-readable message for the mmcontroller response.
	Message string `json:"message"`
	// Keys reports per-key permission details for CEX providers.
	Keys []KeyPermissionResult `json:"keys,omitempty"`
	// CheckedAt records the relevant time for the mmcontroller response.
	CheckedAt string `json:"checked_at"`
}

// Service represents a service.
type Service struct {
	// BaseURL is the base url value for the service.
	BaseURL string
	// Client is the client value for the service.
	Client *http.Client
	// InternalSecret is sent as X-Internal-Secret; mm-controller rejects the
	// health-check call without it.
	InternalSecret string
	// Name is the checked service in operator messages, e.g. "the Taker Controller".
	Name string
}

// NewService creates a service.
func NewService(baseURL string) *Service {
	return &Service{
		BaseURL: baseURL,
		Client:  &http.Client{Timeout: 30 * time.Second},
	}
}

// WithInternalSecret sets the shared secret sent to mm-controller.
func (s *Service) WithInternalSecret(secret string) *Service {
	s.InternalSecret = secret
	return s
}

// WithName sets the service name used in error messages.
func (s *Service) WithName(name string) *Service {
	s.Name = name
	return s
}

func (s *Service) name() string {
	if s.Name == "" {
		return "the Taker Controller"
	}
	return s.Name
}

// Check checks value.
func (s *Service) Check(ctx context.Context, provider string) (*MMControllerResponse, int, error) {
	baseURL, err := url.Parse(s.BaseURL)
	if err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("mm controller api url is invalid")
	}
	targetURL, err := baseURL.Parse("/api/accounts/health_check")
	if err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("failed to build mm controller health request")
	}
	q := targetURL.Query()
	q.Set("provider", provider)
	targetURL.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, targetURL.String(), nil)
	if err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("failed to create mm controller health request")
	}
	if s.InternalSecret != "" {
		req.Header.Set("X-Internal-Secret", s.InternalSecret)
	}
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, apierror.Wrapf(err, "health_service_unreachable", "Couldn't reach %s to check this account's health. It may be restarting; try again in a moment.", s.name())
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var body map[string]string
		if err := json.NewDecoder(resp.Body).Decode(&body); err == nil && body["error"] != "" {
			return nil, resp.StatusCode, errors.New(body["error"])
		}
		return nil, resp.StatusCode, apierror.Wrapf(apierror.FromBody(resp.StatusCode, nil, s.name()), "account_health_failed", "%s couldn't check this account's health (HTTP %d) and didn't say why. Check its log.", capitalizeFirst(s.name()), resp.StatusCode)
	}

	var result MMControllerResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, http.StatusBadGateway, apierror.Wrapf(err, "account_health_failed", "%s sent an account-health answer the dashboard can't read. Make sure both services run the same release.", capitalizeFirst(s.name()))
	}
	return &result, http.StatusOK, nil
}

func capitalizeFirst(v string) string {
	if v == "" {
		return v
	}
	return strings.ToUpper(v[:1]) + v[1:]
}
