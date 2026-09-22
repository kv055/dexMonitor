package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestExecutionQuoteProductionProxy(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/api/execution-quotes" || r.Header.Get("X-Internal-Secret") != "test-secret" {
			t.Errorf("unexpected proxy request: %s %s", r.Method, r.URL.Path)
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"amount":"100"`) {
			t.Error("quote input lost")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"quote_id":"q"}`))
	}))
	defer upstream.Close()
	oldURL, oldSecret := unifiedAPIURL, mmInternalSecret
	defer func() { unifiedAPIURL, mmInternalSecret = oldURL, oldSecret }()
	unifiedAPIURL, mmInternalSecret = upstream.URL, "test-secret"
	mux := http.NewServeMux()
	registerRawBackendRoutes(mux)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest("POST", "/api/execution-quotes", strings.NewReader(`{"amount":"100"}`)))
	if w.Code != 200 || w.Body.String() != `{"quote_id":"q"}` {
		t.Fatalf("proxy response: %d %s", w.Code, w.Body.String())
	}
}
