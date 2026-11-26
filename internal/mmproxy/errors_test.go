package mmproxy

import (
	"commons/apierror"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func proxyBody(t *testing.T, rec *httptest.ResponseRecorder) apierror.Body {
	t.Helper()
	var body apierror.Body
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return body
}

func TestProxyExplainsAnUnreachableTakerController(t *testing.T) {
	rec := httptest.NewRecorder()
	(&Proxy{BaseURL: "http://127.0.0.1:1"}).ForwardJSON(rec, httptest.NewRequest(http.MethodGet, "/api/mm-controller/x", nil), "/api/x")
	body := proxyBody(t, rec)
	if rec.Code != http.StatusBadGateway || body.Code != "taker_controller_unreachable" || !strings.Contains(body.Error, "isn't reachable right now") || body.Detail == "" {
		t.Fatalf("status %d body %+v", rec.Code, body)
	}
}

func TestProxyExplainsASlowTakerController(t *testing.T) {
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { time.Sleep(200 * time.Millisecond) }))
	defer slow.Close()
	rec := httptest.NewRecorder()
	p := &Proxy{BaseURL: slow.URL, Client: &http.Client{Timeout: 50 * time.Millisecond}}
	p.ForwardJSON(rec, httptest.NewRequest(http.MethodGet, "/api/mm-controller/x", nil), "/api/x")
	body := proxyBody(t, rec)
	if rec.Code != http.StatusGatewayTimeout || body.Code != apierror.CodeTimeout || !strings.Contains(body.Error, "didn't answer within 50ms") {
		t.Fatalf("status %d body %+v", rec.Code, body)
	}
}

func TestProxyExplainsRejectedInternalCredentials(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusUnauthorized) }))
	defer upstream.Close()
	rec := httptest.NewRecorder()
	(&Proxy{BaseURL: upstream.URL}).ForwardJSON(rec, httptest.NewRequest(http.MethodGet, "/api/mm-controller/x", nil), "/api/x")
	body := proxyBody(t, rec)
	if rec.Code != http.StatusBadGateway || body.Code != "internal_auth_failed" || !strings.Contains(body.Error, "INTERNAL_API_SECRET") {
		t.Fatalf("status %d body %+v", rec.Code, body)
	}
}
