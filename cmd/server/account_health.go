package main

import (
	"net/http"
	"strings"

	"dexmonitor/internal/accounthealth"
)

type tradingAccountHealthCheckResult struct {
	Account   *tradingAccount                     `json:"account"`
	Status    string                              `json:"status"`
	Healthy   *bool                               `json:"healthy"`
	Message   string                              `json:"message"`
	Keys      []accounthealth.KeyPermissionResult `json:"keys,omitempty"`
	CheckedAt string                              `json:"checked_at"`
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

	healthAPIURL := mmControllerAPIURL
	healthService := "the Taker Controller"
	if strings.EqualFold(account.Provider, "Bisq") {
		healthAPIURL = unifiedAPIURL
		healthService = "the Unified API"
	}
	result, status, err := accounthealth.NewService(healthAPIURL).WithInternalSecret(mmInternalSecret).WithName(healthService).Check(r.Context(), account.Provider)
	if err != nil {
		writeAPIError(w, status, err)
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
		Keys:      result.Keys,
		CheckedAt: result.CheckedAt,
	})
}
