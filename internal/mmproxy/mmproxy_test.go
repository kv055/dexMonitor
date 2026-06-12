package mmproxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestForwardJSONPreservesPathQueryParams(t *testing.T) {
	var gotPath string
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotQuery = r.URL.RawQuery
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	t.Cleanup(srv.Close)

	proxy := New(srv.URL)
	req := httptest.NewRequest(http.MethodGet, "/api/trading/accounts/1/cex/balances", nil)
	rec := httptest.NewRecorder()
	proxy.ForwardJSON(rec, req, "/api/cex/balances?provider=Binance")

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if gotPath != "/api/cex/balances" {
		t.Fatalf("path = %q, want /api/cex/balances", gotPath)
	}
	if gotQuery != "provider=Binance" {
		t.Fatalf("query = %q, want provider=Binance", gotQuery)
	}
}

func TestForwardJSONMergesIncomingQueryParams(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	proxy := New(srv.URL)
	req := httptest.NewRequest(http.MethodGet, "/api/trading/accounts/1/cex/spot-trades?limit=25", nil)
	rec := httptest.NewRecorder()
	proxy.ForwardJSON(rec, req, "/api/cex/spot-trades?provider=Kraken")

	if gotQuery != "limit=25&provider=Kraken" && gotQuery != "provider=Kraken&limit=25" {
		t.Fatalf("query = %q, want provider and limit merged", gotQuery)
	}
}

func TestForwardJSONForwardsResponseBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = io.WriteString(w, `{"error":"upstream failed"}`)
	}))
	t.Cleanup(srv.Close)

	proxy := New(srv.URL)
	req := httptest.NewRequest(http.MethodGet, "/api/trading/accounts/1/cex/deposit-addresses", nil)
	rec := httptest.NewRecorder()
	proxy.ForwardJSON(rec, req, "/api/cex/deposit-addresses?provider=Kraken")

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", rec.Code)
	}
	body := strings.TrimSpace(rec.Body.String())
	if body != `{"error":"upstream failed"}` {
		t.Fatalf("body = %q", body)
	}
}
