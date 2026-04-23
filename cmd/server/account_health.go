package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

type tradingAccountHealthCheckResult struct {
	Account   *tradingAccount `json:"account"`
	Status    string          `json:"status"`
	Healthy   *bool           `json:"healthy"`
	Message   string          `json:"message"`
	CheckedAt string          `json:"checked_at"`
}

type mmAccountHealthResponse struct {
	Provider  string `json:"provider"`
	Status    string `json:"status"`
	Healthy   bool   `json:"healthy"`
	Message   string `json:"message"`
	CheckedAt string `json:"checked_at"`
}

func handleTradingAccountHealthCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	account, err := loadTradingAccountByID(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}

	result, status, err := requestMMControllerAccountHealth(r, account.Provider)
	if err != nil {
		http.Error(w, err.Error(), status)
		return
	}

	account, err = loadTradingAccountByID(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}

	healthy := result.Healthy
	writeJSON(w, tradingAccountHealthCheckResult{
		Account:   account,
		Status:    result.Status,
		Healthy:   &healthy,
		Message:   result.Message,
		CheckedAt: result.CheckedAt,
	})
}

func requestMMControllerAccountHealth(r *http.Request, provider string) (*mmAccountHealthResponse, int, error) {
	baseURL, err := url.Parse(mmControllerAPIURL)
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

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, targetURL.String(), nil)
	if err != nil {
		return nil, http.StatusInternalServerError, fmt.Errorf("failed to create mm controller health request")
	}
	resp, err := (&http.Client{Timeout: 30 * time.Second}).Do(req)
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

	var result mmAccountHealthResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, http.StatusBadGateway, fmt.Errorf("decode mm controller health response: %w", err)
	}
	return &result, http.StatusOK, nil
}
