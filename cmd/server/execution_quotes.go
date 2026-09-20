package main

import (
	"dexmonitor/internal/mmproxy"
	"net/http"
	"time"
)

func handleExecutionQuoteProxy(w http.ResponseWriter, r *http.Request) {
	proxy := mmproxy.New(unifiedAPIURL).WithInternalSecret(mmInternalSecret)
	proxy.Client.Timeout = 30 * time.Second
	proxy.ForwardJSON(w, r, "/api/execution-quotes")
}
