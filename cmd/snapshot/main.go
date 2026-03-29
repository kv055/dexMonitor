package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	bisqgrpc "dexmonitor/bisq_grpc/go"

	_ "modernc.org/sqlite"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

var (
	snapshotDBPath string
	bisqGRPCHost   string
	priceProvider  string
	torProxy       = "socks5h://127.0.0.1:9050"
	robosatsOnions = []string{
		"http://ngdk7ocdzmz5kzsysa3om6du7ycj2evxp2f2olfkyq37htx3gllwp2yd.onion",
		"http://mmhaqzuirth5rx7gl24d4773lknltjhik57k7ahec5iefktezv4b3uid.onion",
		"http://4t4jxmivv6uqej6xzx2jx3fxh75gtt65v3szjoqmc4ugdlhipzdat6yd.onion",
		"http://otmoonrndnrddqdlhu6b36heunmbyw3cgvadqo2oqeau3656wfv7fwad.onion",
	}
)

func init() {
	snapshotDBPath = os.Getenv("DB_PATH")
	if snapshotDBPath == "" {
		snapshotDBPath = "/home/claudio_clawd_bot/orderbook/orderbook.db"
	}
	bisqGRPCHost = os.Getenv("BISQ_GRPC_HOST")
	if bisqGRPCHost == "" {
		bisqGRPCHost = "localhost:9998"
	}
	priceProvider = os.Getenv("PRICE_PROVIDER")
	if priceProvider == "" {
		priceProvider = "bisq_tor"
	}
}

// --- Offer type ---

type offer struct {
	OfferID       string   `json:"offer_id,omitempty"`
	Price         float64  `json:"price"`
	PriceDiffPct  *float64 `json:"price_diff_percent,omitempty"`
	BTCMin        *float64 `json:"btc_min,omitempty"`
	BTCMax        *float64 `json:"btc_max,omitempty"`
	FiatMin       *int     `json:"fiat_min,omitempty"`
	FiatMax       *int     `json:"fiat_max,omitempty"`
	PaymentMethod string   `json:"payment_method,omitempty"`
}

type fetchResult struct {
	BTCPrice float64
	Offers   []offer
}

// --- HTTP clients ---

func torClient() *http.Client {
	proxyURL, _ := url.Parse(torProxy)
	return &http.Client{
		Timeout: 30 * time.Second,
		Transport: &http.Transport{
			Proxy:       http.ProxyURL(proxyURL),
			DialContext: (&net.Dialer{Timeout: 30 * time.Second}).DialContext,
		},
	}
}

func clearnetClient() *http.Client {
	return &http.Client{Timeout: 15 * time.Second}
}

// --- Reference price providers ---

func priceBisqTor(fiat string) (int, error) {
	resp, err := torClient().Get("http://ro7nv73awqs3ga2qtqeqawrjpbxwarsazznszvr6whv7tes5ehffopid.onion/getAllMarketPrices")
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var result struct {
		Data []struct {
			CurrencyCode string  `json:"currencyCode"`
			Price        float64 `json:"price"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return 0, err
	}
	for _, c := range result.Data {
		if strings.EqualFold(c.CurrencyCode, fiat) {
			return int(c.Price), nil
		}
	}
	return 0, fmt.Errorf("currency %s not found", fiat)
}

func priceKraken(fiat string) (int, error) {
	pair := "XBT" + strings.ToUpper(fiat)
	resp, err := clearnetClient().Get("https://api.kraken.com/0/public/Ticker?pair=" + pair)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var data struct {
		Result map[string]struct {
			C []string `json:"c"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		return 0, err
	}
	for _, ticker := range data.Result {
		if len(ticker.C) > 0 {
			v, _ := strconv.ParseFloat(ticker.C[0], 64)
			return int(v), nil
		}
	}
	return 0, fmt.Errorf("no ticker data for %s", pair)
}

func priceCoinGecko(fiat string) (int, error) {
	resp, err := clearnetClient().Get("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=" + fiat)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var data map[string]map[string]float64
	if err := json.Unmarshal(body, &data); err != nil {
		return 0, err
	}
	if btc, ok := data["bitcoin"]; ok {
		if price, ok := btc[fiat]; ok {
			return int(price), nil
		}
	}
	return 0, fmt.Errorf("no price for %s", fiat)
}

func fetchReferencePrice(fiat string) int {
	providers := map[string]func(string) (int, error){
		"bisq_tor":  priceBisqTor,
		"kraken":    priceKraken,
		"coingecko": priceCoinGecko,
	}
	fn, ok := providers[priceProvider]
	if !ok {
		fmt.Printf("[RefPrice] Unknown provider '%s', available: %v\n", priceProvider, []string{"bisq_tor", "kraken", "coingecko"})
		return 0
	}
	price, err := fn(fiat)
	if err != nil {
		fmt.Printf("[RefPrice] Error from %s: %v\n", priceProvider, err)
		return 0
	}
	fmt.Printf("[RefPrice] %s: %d %s\n", priceProvider, price, strings.ToUpper(fiat))
	return price
}

// --- Exchange fetchers ---

func fetchBisq(direction string, btcPrice int) *fetchResult {
	if btcPrice == 0 {
		fmt.Println("[Bisq] Could not get reference price")
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	conn, err := grpc.NewClient(bisqGRPCHost, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		fmt.Printf("[Bisq] Connection error: %v\n", err)
		return nil
	}
	defer conn.Close()

	stub := bisqgrpc.NewOffersClient(conn)
	reply, err := stub.GetOffers(ctx, &bisqgrpc.GetOffersRequest{
		Direction:    strings.ToUpper(direction),
		CurrencyCode: "EUR",
	})
	if err != nil {
		fmt.Printf("[Bisq] Error getting %s offers: %v\n", direction, err)
		return nil
	}

	var offers []offer
	for _, o := range reply.Offers {
		price, _ := strconv.ParseFloat(o.Price, 64)
		var diff *float64
		if btcPrice > 0 {
			d := round2((price/float64(btcPrice) - 1) * 100)
			diff = &d
		}
		btcMin := float64(o.MinAmount) / 1e8
		btcMax := float64(o.Amount) / 1e8
		fiatMin := int(parseFloatStr(o.MinVolume))
		fiatMax := int(parseFloatStr(o.Volume))
		offers = append(offers, offer{
			OfferID:       o.Id,
			Price:         price,
			PriceDiffPct:  diff,
			BTCMin:        &btcMin,
			BTCMax:        &btcMax,
			FiatMin:       &fiatMin,
			FiatMax:       &fiatMax,
			PaymentMethod: o.PaymentMethodShortName,
		})
	}

	return &fetchResult{BTCPrice: float64(btcPrice), Offers: offers}
}

func fetchHodlHodl(direction string, btcPrice int) *fetchResult {
	reqURL := fmt.Sprintf("https://hodlhodl.com/api/v1/offers?filters[side]=%s&filters[include_global]=true&filters[currency_code]=EUR&filters[only_working_now]=true&sort[by]=price", direction)
	resp, err := clearnetClient().Get(reqURL)
	if err != nil {
		fmt.Printf("[HodlHodl] Error: %v\n", err)
		return &fetchResult{}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var data struct {
		Offers []struct {
			ID        string `json:"id"`
			Price     string `json:"price"`
			MinAmount string `json:"min_amount"`
			MaxAmount string `json:"max_amount"`
			PaymentMethods []struct {
				Name string `json:"name"`
			} `json:"payment_methods"`
			PaymentMethodInstructions []struct {
				PaymentMethodName string `json:"payment_method_name"`
			} `json:"payment_method_instructions"`
		} `json:"offers"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		fmt.Printf("[HodlHodl] Parse error: %v\n", err)
		return &fetchResult{}
	}

	var offers []offer
	for _, o := range data.Offers {
		price, err := strconv.ParseFloat(o.Price, 64)
		if err != nil || price == 0 {
			continue
		}
		fiatMin := int(parseFloatStr(o.MinAmount))
		fiatMax := int(parseFloatStr(o.MaxAmount))

		var method string
		if direction == "buy" && len(o.PaymentMethods) > 0 {
			method = o.PaymentMethods[0].Name
		} else if len(o.PaymentMethodInstructions) > 0 {
			method = o.PaymentMethodInstructions[0].PaymentMethodName
		}
		if strings.Contains(method, "SEPA") {
			method = "SEPA"
		} else if strings.Contains(method, "Any national bank") {
			method = "NATIONAL_BANK"
		}

		var diff *float64
		if btcPrice > 0 {
			d := round2((price/float64(btcPrice) - 1) * 100)
			diff = &d
		}
		btcMin := round8(float64(fiatMin) / price)
		btcMax := round8(float64(fiatMax) / price)
		offers = append(offers, offer{
			OfferID:       o.ID,
			Price:         price,
			PriceDiffPct:  diff,
			BTCMin:        &btcMin,
			BTCMax:        &btcMax,
			FiatMin:       &fiatMin,
			FiatMax:       &fiatMax,
			PaymentMethod: method,
		})
	}

	fmt.Printf("[HodlHodl] Found %d %s offers\n", len(offers), direction)
	return &fetchResult{BTCPrice: float64(btcPrice), Offers: offers}
}

func fetchRobosats(direction string, btcPrice int) *fetchResult {
	offerType := 1 // sell
	if direction == "buy" {
		offerType = 0
	}

	client := torClient()
	for _, onion := range robosatsOnions {
		reqURL := fmt.Sprintf("%s/api/book/?currency=2&type=%d", onion, offerType)
		resp, err := client.Get(reqURL)
		if err != nil {
			fmt.Printf("[Robosats] %s failed: %v, trying next...\n", onion, err)
			continue
		}
		body, _ := io.ReadAll(resp.Body)
		resp.Body.Close()

		var rawOffers []json.RawMessage
		if err := json.Unmarshal(body, &rawOffers); err != nil {
			fmt.Printf("[Robosats] Parse error: %v, trying next...\n", err)
			continue
		}

		var offers []offer
		for _, raw := range rawOffers {
			var s string
			if json.Unmarshal(raw, &s) == nil && s == "not_found" {
				break
			}

			var line struct {
				ID            json.Number  `json:"id"`
				Price         json.Number  `json:"price"`
				Premium       json.Number  `json:"premium"`
				Amount        *json.Number `json:"amount"`
				MinAmount     json.Number  `json:"min_amount"`
				MaxAmount     json.Number  `json:"max_amount"`
				PaymentMethod string       `json:"payment_method"`
			}
			if err := json.Unmarshal(raw, &line); err != nil {
				continue
			}

			price, err := line.Price.Float64()
			if err != nil || price == 0 {
				continue
			}

			var fiatMin, fiatMax int
			if line.Amount != nil {
				v, _ := line.Amount.Float64()
				fiatMin = int(v)
				fiatMax = int(v)
			} else {
				minV, _ := line.MinAmount.Float64()
				maxV, _ := line.MaxAmount.Float64()
				fiatMin = int(minV)
				fiatMax = int(maxV)
			}

			premium, _ := line.Premium.Float64()
			diff := round2(premium)
			btcMin := round8(float64(fiatMin) / price)
			btcMax := round8(float64(fiatMax) / price)

			offers = append(offers, offer{
				OfferID:       line.ID.String(),
				Price:         price,
				PriceDiffPct:  &diff,
				BTCMin:        &btcMin,
				BTCMax:        &btcMax,
				FiatMin:       &fiatMin,
				FiatMax:       &fiatMax,
				PaymentMethod: line.PaymentMethod,
			})
		}

		fmt.Printf("[Robosats] Found %d %s offers\n", len(offers), direction)
		return &fetchResult{BTCPrice: float64(btcPrice), Offers: offers}
	}

	fmt.Println("[Robosats] All onion addresses failed")
	return &fetchResult{}
}

// --- Database ---

func saveSnapshot(sdb *sql.DB, exchange, fiat, direction string, btcPrice float64, offers []offer) {
	if len(offers) == 0 {
		fmt.Printf("[%s] No offers to save\n", exchange)
		return
	}

	tx, err := sdb.Begin()
	if err != nil {
		fmt.Printf("[%s] DB error: %v\n", exchange, err)
		return
	}
	defer tx.Rollback()

	tx.Exec("INSERT INTO snapshots (exchange, fiat_currency, direction, btc_price) VALUES (?, ?, ?, ?)",
		exchange, fiat, direction, btcPrice)

	updated, inserted := 0, 0
	for _, o := range offers {
		var existingID int64
		var found bool

		if o.OfferID != "" {
			err := tx.QueryRow("SELECT id FROM offers WHERE offer_id = ?", o.OfferID).Scan(&existingID)
			found = err == nil
		}
		if !found {
			err := tx.QueryRow(`SELECT id FROM offers
				WHERE exchange = ? AND direction = ? AND price = ?
				  AND btc_min = ? AND btc_max = ? AND payment_method = ?`,
				exchange, direction, o.Price, o.BTCMin, o.BTCMax, o.PaymentMethod).Scan(&existingID)
			found = err == nil
		}

		if found {
			tx.Exec("UPDATE offers SET last_seen = CURRENT_TIMESTAMP, price_diff_percent = ?, ref_price = ? WHERE id = ?",
				o.PriceDiffPct, btcPrice, existingID)
			updated++
		} else {
			tx.Exec(`INSERT INTO offers
				(exchange, direction, price, price_diff_percent, btc_min, btc_max,
				 fiat_min, fiat_max, payment_method, offer_id, ref_price)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				exchange, direction, o.Price, o.PriceDiffPct, o.BTCMin, o.BTCMax,
				o.FiatMin, o.FiatMax, o.PaymentMethod, nilIfEmpty(o.OfferID), btcPrice)
			inserted++
		}
	}

	tx.Commit()
	fmt.Printf("[%s] %d new, %d updated (%s)\n", exchange, inserted, updated, direction)
}

func writeSnapshotLog(sdb *sql.DB, exchangeData map[string]map[string]bool) {
	exchanges := make(map[string]any)
	total := 0
	for ex, ids := range exchangeData {
		idList := make([]string, 0, len(ids))
		for id := range ids {
			idList = append(idList, id)
		}
		exchanges[ex] = map[string]any{
			"count": len(ids),
			"ids":   idList,
		}
		total += len(ids)
	}
	jsonBytes, _ := json.Marshal(exchanges)
	sdb.Exec("INSERT INTO snapshot_log (exchanges, offers_count) VALUES (?, ?)", string(jsonBytes), total)
}

// --- Main ---

func main() {
	fmt.Println("=== Starting orderbook snapshot ===")

	refPrice := fetchReferencePrice("eur")
	if refPrice == 0 {
		fmt.Println("Could not get reference price, aborting")
		os.Exit(1)
	}
	fmt.Printf("Reference price: %d EUR\n", refPrice)

	sdb, err := sql.Open("sqlite", snapshotDBPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to open database: %v\n", err)
		os.Exit(1)
	}
	defer sdb.Close()

	type exchFetcher struct {
		name string
		fn   func(string, int) *fetchResult
	}
	fetchers := []exchFetcher{
		{"bisq", fetchBisq},
		{"hodlhodl", fetchHodlHodl},
		{"robosats", fetchRobosats},
	}

	exchangeData := make(map[string]map[string]bool)

	for _, direction := range []string{"sell", "buy"} {
		fmt.Printf("\n--- Fetching %s offers ---\n", direction)
		for _, f := range fetchers {
			result := f.fn(direction, refPrice)
			if result != nil && len(result.Offers) > 0 {
				price := result.BTCPrice
				if price == 0 {
					price = float64(refPrice)
				}
				saveSnapshot(sdb, f.name, "EUR", direction, price, result.Offers)
				if exchangeData[f.name] == nil {
					exchangeData[f.name] = make(map[string]bool)
				}
				for _, o := range result.Offers {
					if o.OfferID != "" {
						exchangeData[f.name][o.OfferID] = true
					}
				}
			}
		}
	}

	writeSnapshotLog(sdb, exchangeData)
	total := 0
	names := make([]string, 0, len(exchangeData))
	for name, ids := range exchangeData {
		total += len(ids)
		names = append(names, name)
	}
	fmt.Printf("\n=== Snapshot complete — %d offers from %v ===\n", total, names)
}

// --- Helpers ---

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}

func round8(v float64) float64 {
	return math.Round(v*1e8) / 1e8
}

func parseFloatStr(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}
