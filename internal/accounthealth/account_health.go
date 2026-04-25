package accounthealth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

type MMControllerResponse struct {
	Provider  string `json:"provider"`
	Status    string `json:"status"`
	Healthy   bool   `json:"healthy"`
	Message   string `json:"message"`
	CheckedAt string `json:"checked_at"`
}

type Service struct {
	BaseURL string
	Client  *http.Client
}

func NewService(baseURL string) *Service {
	return &Service{
		BaseURL: baseURL,
		Client:  &http.Client{Timeout: 30 * time.Second},
	}
}

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
	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("mm controller health request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var body map[string]string
		if err := json.NewDecoder(resp.Body).Decode(&body); err == nil && body["error"] != "" {
			return nil, resp.StatusCode, errors.New(body["error"])
		}
		return nil, resp.StatusCode, fmt.Errorf("mm controller health request returned HTTP %d", resp.StatusCode)
	}

	var result MMControllerResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("decode mm controller health response: %w", err)
	}
	return &result, http.StatusOK, nil
}
