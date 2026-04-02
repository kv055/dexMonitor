package main

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/net/proxy"
)

// withdrawalFallbacks are the static BTC withdrawal fees used when the live exchange
// API is unavailable (no credentials, network error).
// Matches FALLBACK_WITHDRAWAL_FEES in the Python estimator.
var withdrawalFallbacks = map[string]float64{
	"kraken":   0.00015,
	"binance":  0.0000046,
	"coinbase": 0.0,
	"bitstamp": 0.0003,
}

// takerFeeFallbacks are the static taker fees (as fraction) used when the live
// exchange API is unavailable or unsupported (e.g. Coinbase).
var takerFeeFallbacks = map[string]float64{
	"kraken":   0.0040,
	"binance":  0.0010,
	"coinbase": 0.0060,
	"bitstamp": 0.0050,
}

const (
	// typicalTxVBytes is the virtual size of a standard CEX withdrawal tx
	// (1 input + 2 outputs, native SegWit P2WPKH), matching the Python estimator.
	typicalTxVBytes = 140

	// networkFeeTTL controls how often the mempool.space fee is re-fetched.
	networkFeeTTL = 5 * time.Minute

	// withdrawalFeeTTL controls how often the live exchange withdrawal fee is re-fetched.
	withdrawalFeeTTL = 30 * time.Minute

	// takerFeeTTL controls how often the live taker fee is re-fetched.
	// Taker fees only change when crossing a 30-day volume tier.
	takerFeeTTL = 60 * time.Minute

	// defaultBTCTradeSize is the fallback BTC amount used when an offer has no size set.
	defaultBTCTradeSize = 0.01
)

// loadCredentials reads {EXCHANGE}_API_KEY and {EXCHANGE}_API_SECRET from env.
func loadCredentials(exchange string) (key, secret string) {
	prefix := strings.ToUpper(exchange)
	return os.Getenv(prefix + "_API_KEY"), os.Getenv(prefix + "_API_SECRET")
}

// httpClient is shared across all fetchers.
var httpClient = &http.Client{Timeout: 10 * time.Second}

// ---------------------------------------------------------------------------
// cachedFee — generic lazy-refresh cache for a single float64 fee value
// ---------------------------------------------------------------------------

type cachedFee struct {
	mu        sync.RWMutex
	value     float64
	fetchedAt time.Time
	ttl       time.Duration
}

func newCachedFee(ttl time.Duration) *cachedFee { return &cachedFee{ttl: ttl} }

// get returns the cached value if fresh, else calls refresh and caches the result.
// On refresh failure it keeps the last known value (or fallback if never fetched).
func (c *cachedFee) get(fallback float64, refresh func() (float64, error), label string) float64 {
	c.mu.RLock()
	if !c.fetchedAt.IsZero() && time.Since(c.fetchedAt) < c.ttl {
		v := c.value
		c.mu.RUnlock()
		return v
	}
	c.mu.RUnlock()

	v, err := refresh()
	c.mu.Lock()
	if err == nil {
		c.value = v
		c.fetchedAt = time.Now()
		fmt.Printf("[TradeCost] %s updated: %.8f (live)\n", label, v)
	} else {
		if c.fetchedAt.IsZero() {
			c.value = fallback
			fmt.Printf("[TradeCost] %s fetch failed (%v), using fallback %.8f\n", label, err, fallback)
		} else {
			fmt.Printf("[TradeCost] %s refresh failed (%v), keeping cached %.8f\n", label, err, c.value)
		}
	}
	result := c.value
	c.mu.Unlock()
	return result
}

// ---------------------------------------------------------------------------
// Withdrawal fee fetcher
// ---------------------------------------------------------------------------

type withdrawalFeeFetcher struct {
	exchange string
	apiKey   string
	apiSecret string
	cache    *cachedFee
}

func newWithdrawalFeeFetcher(exchange string) *withdrawalFeeFetcher {
	key, secret := loadCredentials(exchange)
	return &withdrawalFeeFetcher{
		exchange:  exchange,
		apiKey:    key,
		apiSecret: secret,
		cache:     newCachedFee(withdrawalFeeTTL),
	}
}

func (f *withdrawalFeeFetcher) get() float64 {
	label := f.exchange + " withdrawal fee BTC"
	fallback := withdrawalFallbacks[f.exchange]
	return f.cache.get(fallback, f.fetchLive, label)
}

func (f *withdrawalFeeFetcher) fetchLive() (float64, error) {
	if f.apiKey == "" || f.apiSecret == "" {
		return 0, fmt.Errorf("no API credentials for %s", f.exchange)
	}
	switch f.exchange {
	case "kraken":
		return f.fetchKraken()
	case "binance":
		return f.fetchBinance()
	case "coinbase":
		return 0, nil
	case "bitstamp":
		return f.fetchBitstamp()
	default:
		return 0, fmt.Errorf("unsupported exchange: %s", f.exchange)
	}
}

func (f *withdrawalFeeFetcher) fetchKraken() (float64, error) {
	const urlPath = "/0/private/WithdrawMethods"
	nonce := strconv.FormatInt(time.Now().UnixMilli(), 10)
	form := url.Values{"nonce": {nonce}, "asset": {"XBT"}}
	encoded := form.Encode()

	sha256Sum := sha256.Sum256([]byte(nonce + encoded))
	hmacMsg := append([]byte(urlPath), sha256Sum[:]...)
	secret, err := base64.StdEncoding.DecodeString(f.apiSecret)
	if err != nil {
		return 0, fmt.Errorf("kraken: invalid api secret: %w", err)
	}
	mac := hmac.New(sha512.New, secret)
	mac.Write(hmacMsg)

	req, _ := http.NewRequest(http.MethodPost, "https://api.kraken.com"+urlPath, bytes.NewBufferString(encoded))
	req.Header.Set("API-Key", f.apiKey)
	req.Header.Set("API-Sign", base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("kraken: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Error  []string `json:"error"`
		Result []struct {
			Asset   string `json:"asset"`
			Network string `json:"network"`
			Fee     string `json:"fee"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, fmt.Errorf("kraken: decode: %w", err)
	}
	if len(result.Error) > 0 {
		return 0, fmt.Errorf("kraken API: %v", result.Error)
	}
	for _, m := range result.Result {
		if m.Asset == "XXBT" && m.Network == "Bitcoin" {
			return strconv.ParseFloat(m.Fee, 64)
		}
	}
	return 0, fmt.Errorf("kraken: BTC/Bitcoin withdrawal method not found")
}

func (f *withdrawalFeeFetcher) fetchBinance() (float64, error) {
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	qs := "timestamp=" + timestamp
	mac := hmac.New(sha256.New, []byte(f.apiSecret))
	mac.Write([]byte(qs))

	req, _ := http.NewRequest(http.MethodGet,
		"https://api.binance.com/sapi/v1/capital/config/getall?"+qs+"&signature="+hex.EncodeToString(mac.Sum(nil)), nil)
	req.Header.Set("X-MBX-APIKEY", f.apiKey)

	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("binance: %w", err)
	}
	defer resp.Body.Close()

	var raw json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return 0, fmt.Errorf("binance: decode: %w", err)
	}
	var errObj struct {
		Code int    `json:"code"`
		Msg  string `json:"msg"`
	}
	if json.Unmarshal(raw, &errObj) == nil && errObj.Code != 0 {
		return 0, fmt.Errorf("binance API %d: %s", errObj.Code, errObj.Msg)
	}
	var coins []struct {
		Coin        string `json:"coin"`
		NetworkList []struct {
			Network     string `json:"network"`
			IsDefault   bool   `json:"isDefault"`
			WithdrawFee string `json:"withdrawFee"`
		} `json:"networkList"`
	}
	if err := json.Unmarshal(raw, &coins); err != nil {
		return 0, fmt.Errorf("binance: decode coins: %w", err)
	}
	for _, coin := range coins {
		if coin.Coin == "BTC" {
			for _, net := range coin.NetworkList {
				if net.Network == "BTC" && net.IsDefault {
					return strconv.ParseFloat(net.WithdrawFee, 64)
				}
			}
		}
	}
	return 0, fmt.Errorf("binance: BTC default network withdrawal fee not found")
}

func (f *withdrawalFeeFetcher) fetchBitstamp() (float64, error) {
	const (
		urlHost = "www.bitstamp.net"
		urlPath = "/api/v2/fees/withdrawal/"
	)
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	nonce := uuid.New().String()
	xAuth := "BITSTAMP " + f.apiKey
	message := xAuth + "POST" + urlHost + urlPath + "" + nonce + timestamp + "v2" + ""
	mac := hmac.New(sha256.New, []byte(f.apiSecret))
	mac.Write([]byte(message))

	req, _ := http.NewRequest(http.MethodPost, "https://"+urlHost+urlPath, nil)
	req.Header.Set("X-Auth", xAuth)
	req.Header.Set("X-Auth-Signature", hex.EncodeToString(mac.Sum(nil)))
	req.Header.Set("X-Auth-Nonce", nonce)
	req.Header.Set("X-Auth-Timestamp", timestamp)
	req.Header.Set("X-Auth-Version", "v2")

	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("bitstamp: %w", err)
	}
	defer resp.Body.Close()

	var entries []struct {
		Currency string `json:"currency"`
		Fee      string `json:"fee"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		return 0, fmt.Errorf("bitstamp: decode: %w", err)
	}
	for _, e := range entries {
		if strings.EqualFold(e.Currency, "BTC") {
			return strconv.ParseFloat(e.Fee, 64)
		}
	}
	return 0, fmt.Errorf("bitstamp: BTC withdrawal fee not found")
}

// ---------------------------------------------------------------------------
// Taker fee fetcher
// ---------------------------------------------------------------------------
//
// Supported: Kraken (TradeVolume), Binance (tradeFee), Bitstamp (fees/trading).
// Coinbase: no clean endpoint across API versions — static fallback only.

type takerFeeFetcher struct {
	exchange  string
	apiKey    string
	apiSecret string
	cache     *cachedFee
}

func newTakerFeeFetcher(exchange string) *takerFeeFetcher {
	key, secret := loadCredentials(exchange)
	return &takerFeeFetcher{
		exchange:  exchange,
		apiKey:    key,
		apiSecret: secret,
		cache:     newCachedFee(takerFeeTTL),
	}
}

func (f *takerFeeFetcher) get() float64 {
	label := f.exchange + " taker fee fraction"
	fallback := takerFeeFallbacks[f.exchange]
	return f.cache.get(fallback, f.fetchLive, label)
}

func (f *takerFeeFetcher) fetchLive() (float64, error) {
	if f.apiKey == "" || f.apiSecret == "" {
		return 0, fmt.Errorf("no API credentials for %s", f.exchange)
	}
	switch f.exchange {
	case "kraken":
		return f.fetchKraken()
	case "binance":
		return f.fetchBinance()
	case "coinbase":
		// Coinbase has no stable single endpoint for user taker fee across API versions.
		return 0, fmt.Errorf("coinbase taker fee not fetchable, using static fallback")
	case "bitstamp":
		return f.fetchBitstamp()
	default:
		return 0, fmt.Errorf("unsupported exchange: %s", f.exchange)
	}
}

// fetchKraken fetches the user's current taker fee via POST /0/private/TradeVolume.
// The API returns the fee as a percent string (e.g. "0.26" = 0.26%), which is
// divided by 100 to produce a fraction.
func (f *takerFeeFetcher) fetchKraken() (float64, error) {
	const urlPath = "/0/private/TradeVolume"
	nonce := strconv.FormatInt(time.Now().UnixMilli(), 10)
	// Request fee schedule for the BTC/EUR pair.
	form := url.Values{"nonce": {nonce}, "pair": {"XBTEUR"}}
	encoded := form.Encode()

	sha256Sum := sha256.Sum256([]byte(nonce + encoded))
	hmacMsg := append([]byte(urlPath), sha256Sum[:]...)
	secret, err := base64.StdEncoding.DecodeString(f.apiSecret)
	if err != nil {
		return 0, fmt.Errorf("kraken: invalid api secret: %w", err)
	}
	mac := hmac.New(sha512.New, secret)
	mac.Write(hmacMsg)

	req, _ := http.NewRequest(http.MethodPost, "https://api.kraken.com"+urlPath, bytes.NewBufferString(encoded))
	req.Header.Set("API-Key", f.apiKey)
	req.Header.Set("API-Sign", base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("kraken: %w", err)
	}
	defer resp.Body.Close()

	var result struct {
		Error  []string `json:"error"`
		Result struct {
			Fees map[string]struct {
				Fee string `json:"fee"` // percent string, e.g. "0.26"
			} `json:"fees"`
		} `json:"result"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return 0, fmt.Errorf("kraken: decode: %w", err)
	}
	if len(result.Error) > 0 {
		return 0, fmt.Errorf("kraken API: %v", result.Error)
	}
	// Kraken uses its internal pair name "XXBTZEUR" in the response.
	for _, key := range []string{"XXBTZEUR", "XBTEUR"} {
		if entry, ok := result.Result.Fees[key]; ok {
			pct, err := strconv.ParseFloat(entry.Fee, 64)
			if err != nil {
				return 0, fmt.Errorf("kraken: parse fee %q: %w", entry.Fee, err)
			}
			return pct / 100, nil // convert percent to fraction
		}
	}
	return 0, fmt.Errorf("kraken: XBTEUR taker fee not found in TradeVolume response")
}

// fetchBinance fetches the user's taker fee via GET /sapi/v1/asset/tradeFee.
// The API returns the fee already as a fraction (e.g. "0.001" = 0.1%).
// Queries BTCUSDT as representative — Binance taker fees are account-wide (VIP tier).
func (f *takerFeeFetcher) fetchBinance() (float64, error) {
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	qs := "symbol=BTCUSDT&timestamp=" + timestamp
	mac := hmac.New(sha256.New, []byte(f.apiSecret))
	mac.Write([]byte(qs))

	req, _ := http.NewRequest(http.MethodGet,
		"https://api.binance.com/sapi/v1/asset/tradeFee?"+qs+"&signature="+hex.EncodeToString(mac.Sum(nil)), nil)
	req.Header.Set("X-MBX-APIKEY", f.apiKey)

	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("binance: %w", err)
	}
	defer resp.Body.Close()

	var entries []struct {
		Symbol          string `json:"symbol"`
		MakerCommission string `json:"makerCommission"`
		TakerCommission string `json:"takerCommission"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		return 0, fmt.Errorf("binance: decode: %w", err)
	}
	for _, e := range entries {
		if e.Symbol == "BTCUSDT" {
			return strconv.ParseFloat(e.TakerCommission, 64) // already a fraction
		}
	}
	return 0, fmt.Errorf("binance: BTCUSDT taker fee not found")
}

// fetchBitstamp fetches the user's taker fee via POST /api/v2/fees/trading/.
// The API returns the fee as a percent string (e.g. "0.50" = 0.50%), which is
// divided by 100 to produce a fraction.
func (f *takerFeeFetcher) fetchBitstamp() (float64, error) {
	const (
		urlHost = "www.bitstamp.net"
		urlPath = "/api/v2/fees/trading/"
	)
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	nonce := uuid.New().String()
	xAuth := "BITSTAMP " + f.apiKey
	message := xAuth + "POST" + urlHost + urlPath + "" + nonce + timestamp + "v2" + ""
	mac := hmac.New(sha256.New, []byte(f.apiSecret))
	mac.Write([]byte(message))

	req, _ := http.NewRequest(http.MethodPost, "https://"+urlHost+urlPath, nil)
	req.Header.Set("X-Auth", xAuth)
	req.Header.Set("X-Auth-Signature", hex.EncodeToString(mac.Sum(nil)))
	req.Header.Set("X-Auth-Nonce", nonce)
	req.Header.Set("X-Auth-Timestamp", timestamp)
	req.Header.Set("X-Auth-Version", "v2")

	resp, err := httpClient.Do(req)
	if err != nil {
		return 0, fmt.Errorf("bitstamp: %w", err)
	}
	defer resp.Body.Close()

	var entries []struct {
		Market string `json:"market"`
		Fees   struct {
			Taker string `json:"taker"` // percent string, e.g. "0.50"
		} `json:"fees"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&entries); err != nil {
		return 0, fmt.Errorf("bitstamp: decode: %w", err)
	}
	for _, e := range entries {
		if e.Market == "BTC/EUR" {
			pct, err := strconv.ParseFloat(e.Fees.Taker, 64)
			if err != nil {
				return 0, fmt.Errorf("bitstamp: parse taker fee %q: %w", e.Fees.Taker, err)
			}
			return pct / 100, nil // convert percent to fraction
		}
	}
	return 0, fmt.Errorf("bitstamp: BTC/EUR taker fee not found")
}

// ---------------------------------------------------------------------------
// DEX taker fees
// ---------------------------------------------------------------------------

// dexTakerFees are the static taker fees for each DEX platform (as fraction).
// Used as fallback when live fetch is unavailable.
// Bisq:     1.15% paid in BTC (taker side). Source: bisq.wiki/Trading_fees
// RoboSats: 0.175% — fetched live from /api/info/; this is the fallback.
// HodlHodl: 0.5% — both sides pay; no API endpoint. Source: hodlhodl.com/pages/faq
var dexTakerFees = map[string]float64{
	"bisq":     0.0115,
	"robosats": 0.00175,
	"hodlhodl": 0.005,
}

// robosatsOnions are the coordinator onion addresses, tried in order.
// Matches the list in cmd/snapshot/main.go.
var robosatsOnions = []string{
	"http://ngdk7ocdzmz5kzsysa3om6du7ycj2evxp2f2olfkyq37htx3gllwp2yd.onion",
	"http://mmhaqzuirth5rx7gl24d4773lknltjhik57k7ahec5iefktezv4b3uid.onion",
	"http://4t4jxmivv6uqej6xzx2jx3fxh75gtt65v3szjoqmc4ugdlhipzdat6yd.onion",
	"http://otmoonrndnrddqdlhu6b36heunmbyw3cgvadqo2oqeau3656wfv7fwad.onion",
}

// newTorHTTPClient returns an HTTP client routed through the local Tor SOCKS5 proxy.
func newTorHTTPClient() (*http.Client, error) {
	dialer, err := proxy.SOCKS5("tcp", "127.0.0.1:9050", nil, proxy.Direct)
	if err != nil {
		return nil, fmt.Errorf("tor proxy: %w", err)
	}
	return &http.Client{
		Transport: &http.Transport{Dial: dialer.Dial},
		Timeout:   15 * time.Second,
	}, nil
}

// fetchRobosatsTakerFee fetches the taker_fee from GET /api/info/ on each
// coordinator in turn, returning the first successful result.
func fetchRobosatsTakerFee() (float64, error) {
	torHTTP, err := newTorHTTPClient()
	if err != nil {
		return 0, err
	}
	var lastErr error
	for _, onion := range robosatsOnions {
		resp, err := torHTTP.Get(onion + "/api/info/")
		if err != nil {
			lastErr = err
			continue
		}
		var info struct {
			TakerFee float64 `json:"taker_fee"`
		}
		err = json.NewDecoder(resp.Body).Decode(&info)
		resp.Body.Close()
		if err != nil {
			lastErr = err
			continue
		}
		if info.TakerFee <= 0 {
			lastErr = fmt.Errorf("coordinator returned taker_fee=0")
			continue
		}
		return info.TakerFee, nil
	}
	return 0, fmt.Errorf("all coordinators failed, last: %w", lastErr)
}

// ---------------------------------------------------------------------------
// TradeCostEstimator
// ---------------------------------------------------------------------------

// TradeCostEstimator estimates the total cost of one CEX→DEX arbitrage cycle:
//  1. CEX taker fee — fetched live from exchange API where available, static fallback
//  2. CEX BTC withdrawal fee — fetched live from exchange API, static fallback
//  3. Bitcoin on-chain network fee — mempool.space halfHourFee × 140 vbytes, cached 5 min
//  4. DEX platform fee — static per-exchange taker rate
//
// All components are expressed as a percentage of the trade value so the result
// can be directly compared to / subtracted from the DEX offer premium.
type TradeCostEstimator struct {
	taker           *takerFeeFetcher
	withdrawal      *withdrawalFeeFetcher
	robosatsFee     *cachedFee

	mu               sync.RWMutex
	networkFeeBTC    float64
	networkFetchedAt time.Time
}

func NewTradeCostEstimator(exchange string) *TradeCostEstimator {
	return &TradeCostEstimator{
		taker:       newTakerFeeFetcher(exchange),
		withdrawal:  newWithdrawalFeeFetcher(exchange),
		robosatsFee: newCachedFee(takerFeeTTL),
	}
}

// CostPct returns the estimated total arbitrage cost as a percentage of btcAmount.
// dexExchange is the name of the DEX the offer is on (e.g. "bisq", "robosats", "hodlhodl").
// A DEX offer premium must exceed this value to be profitable.
func (e *TradeCostEstimator) CostPct(btcAmount float64, dexExchange string) float64 {
	if btcAmount <= 0 {
		return 0
	}
	takerFrac := e.taker.get()
	withdrawalFee := e.withdrawal.get()
	networkFee := e.getNetworkFee()

	var dexFeeFrac float64
	if dexExchange == "robosats" {
		dexFeeFrac = e.robosatsFee.get(
			dexTakerFees["robosats"],
			fetchRobosatsTakerFee,
			"robosats DEX taker fee",
		)
	} else {
		dexFeeFrac = dexTakerFees[dexExchange] // static; zero for unknown exchanges
	}

	tradingFee := btcAmount * takerFrac
	dexFee := btcAmount * dexFeeFrac
	return (tradingFee + withdrawalFee + networkFee + dexFee) / btcAmount * 100
}

func (e *TradeCostEstimator) getNetworkFee() float64 {
	e.mu.RLock()
	if !e.networkFetchedAt.IsZero() && time.Since(e.networkFetchedAt) < networkFeeTTL {
		fee := e.networkFeeBTC
		e.mu.RUnlock()
		return fee
	}
	e.mu.RUnlock()

	fee, err := fetchHalfHourNetworkFee()
	e.mu.Lock()
	if err == nil {
		e.networkFeeBTC = fee
		e.networkFetchedAt = time.Now()
	} else {
		fmt.Printf("[TradeCost] network fee fetch failed: %v — using cached %.8f BTC\n", err, e.networkFeeBTC)
	}
	cached := e.networkFeeBTC
	e.mu.Unlock()
	return cached
}

// fetchHalfHourNetworkFee fetches halfHourFee from mempool.space and converts to BTC
// for a 140-vbyte transaction. Matches estimate_network_fee_btc() in the Python code.
func fetchHalfHourNetworkFee() (float64, error) {
	resp, err := httpClient.Get("https://mempool.space/api/v1/fees/recommended")
	if err != nil {
		return 0, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("mempool.space returned HTTP %d", resp.StatusCode)
	}
	var fees struct {
		HalfHourFee int64 `json:"halfHourFee"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&fees); err != nil {
		return 0, fmt.Errorf("decode: %w", err)
	}
	return float64(fees.HalfHourFee*typicalTxVBytes) / 1e8, nil
}

// ---------------------------------------------------------------------------
// CostBreakdown — per-component cost details
// ---------------------------------------------------------------------------

// CostBreakdown holds each component of the arbitrage cost, all expressed both
// as absolute BTC amounts and as percentages of the trade value.
type CostBreakdown struct {
	BTCAmount         float64 `json:"btc_amount"`           // trade size used for calculation
	CexTakerFeePct    float64 `json:"cex_taker_fee_pct"`    // CEX taker fee as % of trade
	CexTakerFeeBTC    float64 `json:"cex_taker_fee_btc"`    // CEX taker fee in BTC
	WithdrawalFeePct  float64 `json:"withdrawal_fee_pct"`   // CEX BTC withdrawal fee as % of trade
	WithdrawalFeeBTC  float64 `json:"withdrawal_fee_btc"`   // CEX BTC withdrawal fee in BTC
	NetworkFeePct     float64 `json:"network_fee_pct"`      // on-chain miner fee as % of trade
	NetworkFeeBTC     float64 `json:"network_fee_btc"`      // on-chain miner fee in BTC
	DexFeePct         float64 `json:"dex_fee_pct"`          // DEX platform fee as % of trade
	DexFeeBTC         float64 `json:"dex_fee_btc"`          // DEX platform fee in BTC
	TotalCostPct      float64 `json:"total_cost_pct"`       // sum of all components as % of trade
	TotalCostBTC      float64 `json:"total_cost_btc"`       // sum of all components in BTC
}

func round8(v float64) float64 {
	return math.Round(v*1e8) / 1e8
}

func round4(v float64) float64 {
	return math.Round(v*1e4) / 1e4
}

// Breakdown returns a full per-component cost breakdown for a given trade size and DEX.
func (e *TradeCostEstimator) Breakdown(btcAmount float64, dexExchange string) CostBreakdown {
	if btcAmount <= 0 {
		return CostBreakdown{}
	}
	takerFrac := e.taker.get()
	withdrawalFee := e.withdrawal.get()
	networkFee := e.getNetworkFee()

	var dexFeeFrac float64
	if dexExchange == "robosats" {
		dexFeeFrac = e.robosatsFee.get(
			dexTakerFees["robosats"],
			fetchRobosatsTakerFee,
			"robosats DEX taker fee",
		)
	} else {
		dexFeeFrac = dexTakerFees[dexExchange]
	}

	takerBTC := btcAmount * takerFrac
	dexBTC := btcAmount * dexFeeFrac
	totalBTC := takerBTC + withdrawalFee + networkFee + dexBTC
	totalPct := totalBTC / btcAmount * 100

	pct := func(btc float64) float64 { return round4(btc / btcAmount * 100) }

	return CostBreakdown{
		BTCAmount:        round8(btcAmount),
		CexTakerFeePct:   pct(takerBTC),
		CexTakerFeeBTC:   round8(takerBTC),
		WithdrawalFeePct: pct(withdrawalFee),
		WithdrawalFeeBTC: round8(withdrawalFee),
		NetworkFeePct:    pct(networkFee),
		NetworkFeeBTC:    round8(networkFee),
		DexFeePct:        pct(dexBTC),
		DexFeeBTC:        round8(dexBTC),
		TotalCostPct:     round4(totalPct),
		TotalCostBTC:     round8(totalBTC),
	}
}
