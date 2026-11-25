package main

import (
	"dexmonitor/internal/mmproxy"
	"net/http"
	"time"
)

// handleExecutionQuoteProxy forwards to unified-api's secret-gated internal
// route. This handler is already behind dexMonitor's session gate. The
// unified-api /api/execution-quotes route checks the session cookie, which a
// server-to-server call does not carry, so it would always answer 401.
func handleExecutionQuoteProxy(w http.ResponseWriter, r *http.Request) {
	proxy := mmproxy.New(unifiedAPIURL).WithInternalSecret(mmInternalSecret)
	proxy.Client.Timeout = 30 * time.Second
	proxy.ForwardJSON(w, r, "/internal/execution-quotes")
}
