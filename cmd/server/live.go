package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// LiveOffer holds a single live offer pushed by the snapshot tool.
type LiveOffer struct {
	ID            int64    `json:"id"`
	Exchange      string   `json:"exchange"`
	Direction     string   `json:"direction"`
	Price         float64  `json:"price"`
	BTCMin        *float64 `json:"btc_min"`
	BTCMax        *float64 `json:"btc_max"`
	FiatMin       *int64   `json:"fiat_min"`
	FiatMax       *int64   `json:"fiat_max"`
	PaymentMethod *string  `json:"payment_method"`
	OfferID       *string  `json:"offer_id"`
	FirstSeen     string   `json:"first_seen"`
	LastSeen      string   `json:"last_seen"`
}

// liveOutOffer is the shape sent to clients — includes computed premium fields.
type liveOutOffer struct {
	ID            int64         `json:"id"`
	Exchange      string        `json:"exchange"`
	Direction     string        `json:"direction"`
	Price         float64       `json:"price"`
	PriceDiffPct  float64       `json:"price_diff_percent"`
	RefPrice      float64       `json:"ref_price"`
	TradeCostPct  float64       `json:"trade_cost_percent"`  // estimated CEX→DEX arbitrage cost as % of trade value
	NetPremiumPct float64       `json:"net_premium_percent"` // PriceDiffPct minus TradeCostPct
	CostBreakdown CostBreakdown `json:"cost_breakdown"`      // per-component cost detail
	BTCMin        *float64      `json:"btc_min"`
	BTCMax        *float64      `json:"btc_max"`
	FiatMin       *int64        `json:"fiat_min"`
	FiatMax       *int64        `json:"fiat_max"`
	PaymentMethod *string       `json:"payment_method"`
	OfferID       *string       `json:"offer_id"`
	FirstSeen     string        `json:"first_seen"`
	LastSeen      string        `json:"last_seen"`
	IsLive        bool          `json:"is_live"`
}

// LiveHub holds live offers in memory and broadcasts to WebSocket subscribers
// on every Kraken price tick.
type LiveHub struct {
	offersMu sync.RWMutex
	offers   []LiveOffer

	subsMu      sync.Mutex
	subscribers map[chan []byte]struct{}
}

var hub = &LiveHub{
	subscribers: make(map[chan []byte]struct{}),
}

// setOffers replaces the in-memory offer list and immediately broadcasts.
func (h *LiveHub) setOffers(offers []LiveOffer) {
	h.offersMu.Lock()
	h.offers = offers
	h.offersMu.Unlock()
	h.broadcastNow()
}

func (h *LiveHub) getOffers() []LiveOffer {
	h.offersMu.RLock()
	defer h.offersMu.RUnlock()
	cp := make([]LiveOffer, len(h.offers))
	copy(cp, h.offers)
	return cp
}

// subscribe registers a new WebSocket client and returns its receive channel.
func (h *LiveHub) subscribe() chan []byte {
	ch := make(chan []byte, 8)
	h.subsMu.Lock()
	h.subscribers[ch] = struct{}{}
	h.subsMu.Unlock()
	return ch
}

// unsubscribe removes a client and closes its channel.
func (h *LiveHub) unsubscribe(ch chan []byte) {
	h.subsMu.Lock()
	delete(h.subscribers, ch)
	h.subsMu.Unlock()
	close(ch)
}

// broadcastNow computes premiums against the current Kraken price and pushes
// the result to every connected subscriber. Called on every Kraken tick and
// after each snapshot reload.
func (h *LiveHub) broadcastNow() {
	price := getKrakenPrice()
	data := h.computePayload(price)
	if data == nil {
		return
	}
	h.subsMu.Lock()
	for ch := range h.subscribers {
		select {
		case ch <- data:
		default: // drop if subscriber is too slow
		}
	}
	h.subsMu.Unlock()
}

// computePayload builds the JSON payload for a given Kraken price.
// Returns nil on marshal error.
func (h *LiveHub) computePayload(price float64) []byte {
	offers := h.getOffers()
	result := make([]liveOutOffer, 0, len(offers))
	for _, o := range offers {
		var pct float64
		if price > 0 {
			pct = math.Round((o.Price/price-1)*10000) / 100
		}

		// Determine BTC size for cost estimation: prefer BTCMax, fall back to BTCMin,
		// then the module-level default.
		btcSize := defaultBTCTradeSize
		if o.BTCMax != nil && *o.BTCMax > 0 {
			btcSize = *o.BTCMax
		} else if o.BTCMin != nil && *o.BTCMin > 0 {
			btcSize = *o.BTCMin
		}
		bd := tradeCostEstimator.Breakdown(btcSize, o.Exchange)
		netPremium := math.Round((pct-bd.TotalCostPct)*100) / 100

		result = append(result, liveOutOffer{
			ID:            o.ID,
			Exchange:      o.Exchange,
			Direction:     o.Direction,
			Price:         o.Price,
			PriceDiffPct:  pct,
			RefPrice:      price,
			TradeCostPct:  bd.TotalCostPct,
			NetPremiumPct: netPremium,
			CostBreakdown: bd,
			BTCMin:        o.BTCMin,
			BTCMax:        o.BTCMax,
			FiatMin:       o.FiatMin,
			FiatMax:       o.FiatMax,
			PaymentMethod: o.PaymentMethod,
			OfferID:       o.OfferID,
			FirstSeen:     o.FirstSeen,
			LastSeen:      o.LastSeen,
			IsLive:        true,
		})
	}
	data, err := json.Marshal(result)
	if err != nil {
		fmt.Printf("[LiveHub] marshal error: %v\n", err)
		return nil
	}
	return data
}

// handleLiveOffersWS is the WebSocket handler. It sends the current state
// immediately on connect, then streams every subsequent broadcast.
func handleLiveOffersWS(w http.ResponseWriter, r *http.Request) {
	ws, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		fmt.Printf("[LiveWS] upgrade error: %v\n", err)
		return
	}
	defer ws.Close()

	ch := hub.subscribe()
	defer hub.unsubscribe(ch)

	// Respond to pings so the browser doesn't drop the connection.
	ws.SetPongHandler(func(string) error {
		ws.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// Read loop — needed to process control frames (ping/close) from the client.
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			if _, _, err := ws.ReadMessage(); err != nil {
				return
			}
		}
	}()

	// Send current state immediately on connect.
	if payload := hub.computePayload(getKrakenPrice()); payload != nil {
		if err := ws.WriteMessage(websocket.TextMessage, payload); err != nil {
			return
		}
	}

	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()

	for {
		select {
		case <-done:
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			if err := ws.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ping.C:
			if err := ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
