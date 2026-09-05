package mmproxy

import (
	publicapi "dexmonitor/internal/api/gen/public"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Exercise the real HTTP proxy through the same generated response validator
// used in production. The upstream is deterministic and needs no exchange keys.
func TestOpenAPIProxyListResponses(t *testing.T) {
	for _, endpoint := range []string{"deposit-addresses", "withdrawal-addresses", "spot-trades"} {
		for _, scenario := range []struct {
			name, body   string
			status, want int
		}{
			{"empty", "[]", 200, 200},
			{"populated", listFixture(endpoint), 200, 200},
			{"wrong-shape", "{}", 200, 500},
			{"missing-fields", "[{}]", 200, 500},
			{"upstream-error", "{\"error\":\"unavailable\"}", 502, 502},
		} {
			t.Run(endpoint+"/"+scenario.name, func(t *testing.T) {
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.URL.Path != "/api/cex/"+endpoint {
						t.Errorf("unexpected upstream path: %s", r.URL.Path)
					}
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(scenario.status)
					_, _ = w.Write([]byte(scenario.body))
				}))
				defer upstream.Close()
				proxy := New(upstream.URL)
				legacy := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					proxy.ForwardJSON(w, r, "/api/cex/"+endpoint)
				})
				mux := http.NewServeMux()
				publicapi.RegisterLegacyStrictHandler(legacy, mux)
				rec := httptest.NewRecorder()
				mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/trading/accounts/17/cex/"+endpoint, nil))
				if rec.Code != scenario.want {
					t.Fatalf("status=%d want=%d body=%s", rec.Code, scenario.want, rec.Body.String())
				}
				if scenario.want != 500 && strings.TrimSpace(rec.Body.String()) != scenario.body {
					t.Fatalf("response changed: %s", rec.Body.String())
				}
			})
		}
	}
}

func listFixture(endpoint string) string {
	if endpoint == "spot-trades" {
		return `[{"trade_id":"test","trading_pair":"BTCEUR","trade_type":"buy","price":1,"amount":1,"fee":0,"timestamp":"2026-09-05T00:00:00Z"}]`
	}
	return `[{"asset":"BTC","network":"Bitcoin","address":"fixture-address"}]`
}
