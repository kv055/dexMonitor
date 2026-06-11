package mmproxy

import (
	"commons/tracing"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Proxy represents a proxy.
type Proxy struct {
	// BaseURL is the base url value for the proxy.
	BaseURL string
	// Client is the client value for the proxy.
	Client *http.Client
}

// New creates value. The client's transport is trace-instrumented so forwarded
// requests start a client span and carry the inbound trace context to the
// market-maker controller.
func New(baseURL string) *Proxy {
	return &Proxy{BaseURL: baseURL, Client: tracing.Client(10 * time.Second)}
}

// ForwardJSON proxies a JSON request to the market-maker controller.
func (p *Proxy) ForwardJSON(w http.ResponseWriter, r *http.Request, path string) {
	baseURL, err := url.Parse(p.BaseURL)
	if err != nil {
		http.Error(w, "mm controller api url is invalid", http.StatusInternalServerError)
		return
	}
	targetURL, err := baseURL.Parse(path)
	if err != nil {
		http.Error(w, "mm controller request path is invalid", http.StatusInternalServerError)
		return
	}
	targetURL.RawQuery = r.URL.RawQuery

	var body io.Reader
	if r.Body != nil && r.Method != http.MethodGet && r.Method != http.MethodHead {
		body = r.Body
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL.String(), body)
	if err != nil {
		http.Error(w, "failed to create mm controller request", http.StatusInternalServerError)
		return
	}
	req.Header.Set("Accept", "application/json")
	if contentType := r.Header.Get("Content-Type"); contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}

	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, "mm controller request failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	for key, values := range resp.Header {
		if strings.EqualFold(key, "Content-Length") {
			continue
		}
		for _, value := range values {
			w.Header().Add(key, value)
		}
	}
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
