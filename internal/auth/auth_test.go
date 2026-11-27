package auth

import "testing"

func TestPublicProtected(t *testing.T) {
	public := []string{
		"/api/past_offers",
		"/api/past_offers/123/lifecycle",
		"/api/ohlc",
		"/api/payment_method_groups",
		"/api/dashboard/analytics",
		"/api/statistics",
	}
	for _, path := range public {
		if PublicProtected(path) {
			t.Errorf("%s must be readable without a session", path)
		}
		if !Protected(path) {
			t.Errorf("%s must still require a session in the trading edition", path)
		}
	}

	private := []string{
		"/api/auth/login",
		"/api/auth/register",
		"/api/auth/me",
		"/api/past_offers/123",
		"/api/past_offers//lifecycle",
		"/api/past_offers/123/lifecycle/extra",
		"/api/trading/accounts",
		"/api/app-settings",
		"/api/mm-controller/transactions",
		"/api/execution-quotes",
		"/api/phone-push/setup",
		"/api/past_order_stats",
		"/ws/cex/hedge-stream",
	}
	for _, path := range private {
		if !PublicProtected(path) {
			t.Errorf("%s must require a session in the public edition", path)
		}
	}

	for _, path := range []string{"/", "/assets/index.js", "/health", "/metrics"} {
		if PublicProtected(path) {
			t.Errorf("%s is not an API route and must not be session-gated", path)
		}
	}
}
