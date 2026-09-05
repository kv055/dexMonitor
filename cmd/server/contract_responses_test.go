package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestOpenAPIAnalyticsListResponses(t *testing.T) {
	withTempOrdersDB(t)
	legacy := http.NewServeMux()
	registerLegacyBackendRoutes(legacy)
	mux := http.NewServeMux()
	registerOpenAPIRoutes(mux, legacy)
	for _, population := range []string{"populated", "empty"} {
		if population == "empty" {
			if _, err := db.Exec("DELETE FROM offers"); err != nil {
				t.Fatal(err)
			}
			resetAnalyticsCaches()
		}
		for _, path := range []string{"/api/general_stats/past_premiums", "/api/general_stats/payment_methods", "/api/past_offers", "/api/past_offers/1/lifecycle", "/api/past_profitable_orders"} {
			t.Run(population+path, func(t *testing.T) {
				rec := httptest.NewRecorder()
				mux.ServeHTTP(rec, httptest.NewRequest("GET", path+"?hours=24", nil))
				if rec.Code != 200 {
					t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
				}
				var items []json.RawMessage
				if err := json.Unmarshal(rec.Body.Bytes(), &items); err != nil || items == nil {
					t.Fatalf("expected non-null array: %s (%v)", rec.Body.String(), err)
				}
			})
		}
	}
}
