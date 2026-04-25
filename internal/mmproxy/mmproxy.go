package mmproxy

import (
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Proxy struct {
	BaseURL string
	Client  *http.Client
}

func New(baseURL string) *Proxy {
	return &Proxy{BaseURL: baseURL, Client: &http.Client{Timeout: 10 * time.Second}}
}

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

	req, err := http.NewRequestWithContext(r.Context(), r.Method, targetURL.String(), nil)
	if err != nil {
		http.Error(w, "failed to create mm controller request", http.StatusInternalServerError)
		return
	}
	req.Header.Set("Accept", "application/json")

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
