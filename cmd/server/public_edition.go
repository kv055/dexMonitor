package main

import (
	"bytes"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"commons/mmcapabilities"
	"dexmonitor/internal/auth"
)

// publicEdition marks the public monitor instance (the dexmonitor-public
// service, PUBLIC_EDITION=true). It runs next to the operator's dexmonitor on
// the same database, as the read-only dex_monitor_public role and without any
// secrets: it opens only the read routes of the dex Monitor and Statistics
// tabs, does no startup writes, and tells the frontend to hide everything else.
var publicEdition bool

// publicMaxOpenConns caps the public instance's share of Postgres connections.
const publicMaxOpenConns = 6

// loadPublicRuntimeConfig sets the runtime keys the operator instance reads
// from app_settings (which dex_monitor_public cannot read) from the
// environment instead. The defaults match the operator instance's.
func loadPublicRuntimeConfig() {
	snapshotIntervalMin = 1
	if v, err := strconv.Atoi(strings.TrimSpace(os.Getenv("SNAPSHOT_INTERVAL_MIN"))); err == nil && v > 0 {
		snapshotIntervalMin = v
	}
	capabilityMaxAge = mmcapabilities.ParseMaxAge(os.Getenv("MM_CEX_CAPABILITY_MAX_AGE"))
}

// publicEditionMeta tells the frontend it runs in the public monitor. A meta
// tag rather than an inline script keeps the page CSP (default-src 'self').
const publicEditionMeta = `<meta name="dexpendulum-edition" content="public">`

func readPublicEdition() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("PUBLIC_EDITION")), "true")
}

// gatePredicate picks which /api and /ws paths need a login session.
func gatePredicate() func(path string) bool {
	if publicEdition {
		return auth.PublicProtected
	}
	return auth.Protected
}

// withPublicEditionMeta inserts publicEditionMeta right after <head>.
func withPublicEditionMeta(html []byte) []byte {
	head := []byte("<head>")
	i := bytes.Index(html, head)
	if i < 0 {
		return append([]byte(publicEditionMeta), html...)
	}
	i += len(head)
	out := make([]byte, 0, len(html)+len(publicEditionMeta))
	out = append(out, html[:i]...)
	out = append(out, publicEditionMeta...)
	return append(out, html[i:]...)
}

func servePublicIndex(w http.ResponseWriter, r *http.Request) {
	html, err := os.ReadFile(filepath.Join(frontendDir, "index.html"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(withPublicEditionMeta(html))
}
