package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRegisterBackendRoutes(t *testing.T) {
	mux := http.NewServeMux()
	registerBackendRoutes(mux)

	tests := []struct {
		method  string
		path    string
		pattern string
	}{
		{http.MethodGet, "/api/past_offers", "GET /api/past_offers"},
		{http.MethodGet, "/api/past_offers/42/lifecycle", "GET /api/past_offers/{id}/lifecycle"},
		{http.MethodPost, "/api/dashboard/analytics", "POST /api/dashboard/analytics"},
		{http.MethodGet, "/api/trading/payment_methods", "GET /api/trading/payment_methods"},
		{http.MethodDelete, "/api/trading/payment_methods/7", "DELETE /api/trading/payment_methods/{id}"},
		{http.MethodPost, "/api/trading/payment_methods/7/degrade-to-alias/9", "POST /api/trading/payment_methods/{id}/degrade-to-alias/{provider_id}"},
		{http.MethodGet, "/api/mm-controller/transactions/5", "GET /api/mm-controller/transactions/{id}"},
		{http.MethodPost, "/api/mm-controller/cex/tradeflow", "POST /api/mm-controller/cex/tradeflow"},
		{http.MethodGet, "/api/mm-controller/transactional-liquidity", "GET /api/mm-controller/transactional-liquidity"},
		{http.MethodGet, "/ws/cex/hedge-stream", "GET /ws/cex/hedge-stream"},
		{http.MethodGet, "/api/trading/accounts", "GET /api/trading/accounts"},
		{http.MethodPost, "/api/trading/accounts/3/api_keys", "POST /api/trading/accounts/{id}/api_keys"},
		{http.MethodDelete, "/api/trading/bank_accounts/11", "DELETE /api/trading/bank_accounts/{id}"},
		{http.MethodGet, "/health", "GET /health"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, nil)
			_, got := mux.Handler(req)
			if got != tt.pattern {
				t.Fatalf("matched pattern %q, want %q", got, tt.pattern)
			}
		})
	}
}
