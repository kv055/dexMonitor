package mmproxy

import (
	"commons/apierror"
	"commons/tracing"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
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
	// InternalSecret is sent as X-Internal-Secret on every forwarded request;
	// mm-controller rejects API/WS calls without it.
	InternalSecret string
}

// New creates value. The client's transport is trace-instrumented so forwarded
// requests start a client span and carry the inbound trace context to the
// market-maker controller.
func New(baseURL string) *Proxy {
	return &Proxy{BaseURL: baseURL, Client: tracing.Client(10 * time.Second)}
}

// WithInternalSecret sets the shared secret forwarded to mm-controller.
func (p *Proxy) WithInternalSecret(secret string) *Proxy {
	p.InternalSecret = secret
	return p
}

// ForwardJSON proxies a JSON request to the market-maker controller.
func (p *Proxy) ForwardJSON(w http.ResponseWriter, r *http.Request, path string) {
	baseURL, err := url.Parse(p.BaseURL)
	if err != nil {
		writeProxyError(w, http.StatusInternalServerError, "taker_controller_misconfigured", "The dashboard server's Taker Controller address (MM_CONTROLLER_API_URL) is invalid, so requests can't be forwarded. Fix it and restart dexMonitor.", err)
		return
	}
	targetURL, err := baseURL.Parse(path)
	if err != nil {
		writeProxyError(w, http.StatusInternalServerError, apierror.CodeInternal, "The dashboard server built an invalid Taker Controller request path. Report this with the technical details.", err)
		return
	}
	if incoming := strings.TrimSpace(r.URL.RawQuery); incoming != "" {
		query, err := url.ParseQuery(incoming)
		if err != nil {
			writeProxyError(w, http.StatusBadRequest, "invalid_request", "The request's query string couldn't be read. Reload the page and try again.", err)
			return
		}
		merged := targetURL.Query()
		for key, values := range query {
			for _, value := range values {
				merged.Add(key, value)
			}
		}
		targetURL.RawQuery = merged.Encode()
	}

	var body io.Reader
	if r.Body != nil && r.Method != http.MethodGet && r.Method != http.MethodHead {
		body = r.Body
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL.String(), body)
	if err != nil {
		writeProxyError(w, http.StatusInternalServerError, apierror.CodeInternal, "The dashboard server couldn't build the request to the Taker Controller. Report this with the technical details.", err)
		return
	}
	req.Header.Set("Accept", "application/json")
	if contentType := r.Header.Get("Content-Type"); contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if p.InternalSecret != "" {
		req.Header.Set("X-Internal-Secret", p.InternalSecret)
	}

	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		writeUnreachable(w, err, client.Timeout)
		return
	}
	defer resp.Body.Close()

	// The browser's session was already checked by dexMonitor's gate before this
	// proxy ran, so an upstream 401 means a service-to-service credential was
	// rejected (missing or wrong X-Internal-Secret, or a route that wants a cookie
	// this server-side call never carries). Passing that 401 on would make the
	// SPA treat it as an expired login and show the login page. Report it as a
	// gateway failure instead.
	if resp.StatusCode == http.StatusUnauthorized {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_ = json.NewEncoder(w).Encode(apierror.Body{
			Error: "The Taker Controller rejected the dashboard server's internal credentials, so this request couldn't be forwarded. Make sure INTERNAL_API_SECRET is the same for dexMonitor and the Taker Controller, then restart them.",
			Code:  "internal_auth_failed",
		})
		return
	}

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

// writeProxyError answers with the shared {"error","code","detail"} shape.
func writeProxyError(w http.ResponseWriter, status int, code, message string, cause error) {
	body := apierror.Body{Error: message, Code: code}
	if cause != nil {
		body.Detail = cause.Error()
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

// writeUnreachable explains a Taker Controller that did not answer at all.
func writeUnreachable(w http.ResponseWriter, err error, timeout time.Duration) {
	if errors.Is(err, context.Canceled) {
		writeProxyError(w, 499, apierror.CodeCancelled, "The request was cancelled before the Taker Controller answered.", err)
		return
	}
	var netErr net.Error
	if errors.Is(err, context.DeadlineExceeded) || (errors.As(err, &netErr) && netErr.Timeout()) {
		wait := "in time"
		if timeout > 0 {
			wait = "within " + timeout.String()
		}
		writeProxyError(w, http.StatusGatewayTimeout, apierror.CodeTimeout,
			"The Taker Controller didn't answer "+wait+". It may be busy (exchange or Tor calls can be slow) or restarting; try again in a moment.", err)
		return
	}
	writeProxyError(w, http.StatusBadGateway, "taker_controller_unreachable",
		"The Taker Controller isn't reachable right now (it may be restarting). Try again in a moment; if it stays down, check its container.", err)
}
