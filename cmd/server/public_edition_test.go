package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"commons/mmcapabilities"
)

func withPublicEdition(t *testing.T, enabled bool) {
	t.Helper()
	previous := publicEdition
	publicEdition = enabled
	t.Cleanup(func() { publicEdition = previous })
}

func TestServeFrontendPublicEditionMeta(t *testing.T) {
	root := t.TempDir()
	index := "<!doctype html><html lang=\"en\">\n  <head>\n    <meta charset=\"UTF-8\" />\n  </head><body></body></html>"
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte(index), 0o644); err != nil {
		t.Fatalf("write index: %v", err)
	}
	previousDir := frontendDir
	frontendDir = root
	t.Cleanup(func() { frontendDir = previousDir })

	serve := func() *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		serveFrontend(rec, httptest.NewRequest(http.MethodGet, "/", nil))
		return rec
	}

	withPublicEdition(t, false)
	if body := serve().Body.String(); strings.Contains(body, "dexpendulum-edition") {
		t.Fatalf("trading edition index carries the public meta tag: %s", body)
	}

	withPublicEdition(t, true)
	rec := serve()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("Cache-Control = %q, want no-cache", got)
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
		t.Fatalf("Content-Type = %q, want text/html", got)
	}
	if body := rec.Body.String(); !strings.Contains(body, "<head>"+publicEditionMeta) {
		t.Fatalf("public index lacks the meta tag right after <head>: %s", body)
	}
}

func TestWithPublicEditionMetaWithoutHead(t *testing.T) {
	got := string(withPublicEditionMeta([]byte("<html></html>")))
	if !strings.HasPrefix(got, publicEditionMeta) {
		t.Fatalf("meta tag not prepended: %s", got)
	}
}

func TestLoadPublicRuntimeConfigReadsEnvironment(t *testing.T) {
	previousInterval, previousMaxAge := snapshotIntervalMin, capabilityMaxAge
	t.Cleanup(func() { snapshotIntervalMin, capabilityMaxAge = previousInterval, previousMaxAge })

	t.Setenv("SNAPSHOT_INTERVAL_MIN", "3")
	t.Setenv("MM_CEX_CAPABILITY_MAX_AGE", "45m")
	loadPublicRuntimeConfig()
	if snapshotIntervalMin != 3 || capabilityMaxAge != 45*time.Minute {
		t.Fatalf("got interval %d, max age %s", snapshotIntervalMin, capabilityMaxAge)
	}

	t.Setenv("SNAPSHOT_INTERVAL_MIN", "")
	t.Setenv("MM_CEX_CAPABILITY_MAX_AGE", "")
	loadPublicRuntimeConfig()
	if snapshotIntervalMin != 1 || capabilityMaxAge != mmcapabilities.DefaultMaxAge {
		t.Fatalf("defaults: got interval %d, max age %s", snapshotIntervalMin, capabilityMaxAge)
	}
}

func TestGatePredicateFollowsPublicEdition(t *testing.T) {
	withPublicEdition(t, false)
	if !gatePredicate()("/api/ohlc") {
		t.Fatal("trading edition must require a session for /api/ohlc")
	}
	withPublicEdition(t, true)
	if gatePredicate()("/api/ohlc") {
		t.Fatal("public edition must serve /api/ohlc without a session")
	}
	if !gatePredicate()("/api/trading/accounts") {
		t.Fatal("public edition must keep /api/trading/accounts behind a session")
	}
}
