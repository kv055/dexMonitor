package mmproxy

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// wsUpgrader upgrades inbound browser connections. The origin is restricted to
// same-origin (Origin host must equal the request Host) so a page on another site
// can't open the hedge-stream relay using the visitor's session cookie
// (cross-site WebSocket hijacking). A missing Origin header (non-browser clients
// like the e2e harness) is allowed.
var wsUpgrader = websocket.Upgrader{
	CheckOrigin: sameOriginWS,
}

func sameOriginWS(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil {
		return false
	}
	return strings.EqualFold(u.Host, r.Host)
}

// ForwardWebSocket relays a WebSocket connection to the market-maker controller. It
// upgrades the inbound browser request, dials mm-controller at the equivalent ws(s)
// URL (BaseURL's http scheme mapped to ws, with path + query carried through), and
// pumps frames in both directions until either side closes.
func (p *Proxy) ForwardWebSocket(w http.ResponseWriter, r *http.Request, path string) {
	target, err := p.wsTargetURL(path, r.URL.RawQuery)
	if err != nil {
		http.Error(w, "mm controller websocket url is invalid", http.StatusInternalServerError)
		return
	}

	// Dial mm-controller first so a failure can still return a clean HTTP error
	// before we hijack the inbound connection.
	dialCtx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	var dialHeader http.Header
	if p.InternalSecret != "" {
		dialHeader = http.Header{"X-Internal-Secret": {p.InternalSecret}}
	}
	upstream, resp, err := websocket.DefaultDialer.DialContext(dialCtx, target, dialHeader)
	if err != nil {
		if resp != nil {
			resp.Body.Close()
		}
		http.Error(w, "mm controller websocket dial failed: "+err.Error(), http.StatusBadGateway)
		return
	}
	defer upstream.Close()

	client, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer client.Close()

	pumpBidirectional(client, upstream)
}

func (p *Proxy) wsTargetURL(path, rawQuery string) (string, error) {
	baseURL, err := url.Parse(p.BaseURL)
	if err != nil {
		return "", err
	}
	switch strings.ToLower(baseURL.Scheme) {
	case "https":
		baseURL.Scheme = "wss"
	default:
		baseURL.Scheme = "ws"
	}
	targetURL, err := baseURL.Parse(path)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(rawQuery) != "" {
		targetURL.RawQuery = rawQuery
	}
	return targetURL.String(), nil
}

// pumpBidirectional copies messages between the browser client and mm-controller
// upstream until either connection errors, then unblocks the other direction by
// closing both connections.
func pumpBidirectional(client, upstream *websocket.Conn) {
	var once sync.Once
	closeBoth := func() {
		once.Do(func() {
			client.Close()
			upstream.Close()
		})
	}

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		copyMessages(upstream, client)
		closeBoth()
	}()
	go func() {
		defer wg.Done()
		copyMessages(client, upstream)
		closeBoth()
	}()
	wg.Wait()
}

func copyMessages(dst, src *websocket.Conn) {
	for {
		messageType, payload, err := src.ReadMessage()
		if err != nil {
			return
		}
		if err := dst.WriteMessage(messageType, payload); err != nil {
			return
		}
	}
}
