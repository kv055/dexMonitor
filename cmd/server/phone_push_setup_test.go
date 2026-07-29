package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPhonePushPublicBaseURL(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://dexmonitor/api/phone-push/setup", nil)
	req.Host = "100.79.182.16"
	req.Header.Set("X-Forwarded-Proto", "https")
	if got, want := phonePushPublicBaseURL(req), "https://100.79.182.16"; got != want {
		t.Fatalf("phone callback base URL = %q, want %q", got, want)
	}
}
