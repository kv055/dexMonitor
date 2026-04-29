package ohlc

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// Service represents a service.
type Service struct {
	// Client is the client value for the service.
	Client *http.Client
}

// NewService creates a service.
func NewService() *Service {
	return &Service{Client: &http.Client{Timeout: 15 * time.Second}}
}

// Candles fetches OHLC candles for the requested market.
func (s *Service) Candles(ctx context.Context, exchange string, hours int, intervalMin int) []map[string]any {
	switch exchange {
	case "binance":
		return s.fetchBinance(ctx, hours, intervalMin)
	case "bitstamp":
		return s.fetchBitstamp(ctx, hours, intervalMin)
	case "coinbase":
		return s.fetchCoinbase(ctx, hours, intervalMin)
	default:
		return s.fetchKraken(ctx, hours, intervalMin)
	}
}

func (s *Service) client() *http.Client {
	if s.Client != nil {
		return s.Client
	}
	return &http.Client{Timeout: 15 * time.Second}
}

func (s *Service) fetchKraken(ctx context.Context, hours int, intervalMin int) []map[string]any {
	apiURL := fmt.Sprintf("https://api.kraken.com/0/public/OHLC?pair=XBTEUR&interval=%d", intervalMin)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	resp, err := s.client().Do(req)
	if err != nil {
		fmt.Printf("[OHLC] Kraken error: %v\n", err)
		return nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		fmt.Printf("[OHLC] read error: %v\n", err)
		return nil
	}

	var data struct {
		Result map[string]json.RawMessage `json:"result"`
	}
	if err := json.Unmarshal(body, &data); err != nil {
		fmt.Printf("[OHLC] parse error: %v\n", err)
		return nil
	}

	cutoff := float64(time.Now().UTC().Unix() - int64(hours*3600))
	candles := make([]map[string]any, 0)
	for key, raw := range data.Result {
		if key == "last" {
			continue
		}
		var ohlcData [][]json.RawMessage
		if err := json.Unmarshal(raw, &ohlcData); err != nil {
			continue
		}
		for _, c := range ohlcData {
			if len(c) < 5 {
				continue
			}
			var ts float64
			json.Unmarshal(c[0], &ts)
			if ts < cutoff {
				continue
			}
			var open, high, low, close string
			json.Unmarshal(c[1], &open)
			json.Unmarshal(c[2], &high)
			json.Unmarshal(c[3], &low)
			json.Unmarshal(c[4], &close)
			candles = append(candles, map[string]any{
				"time":  time.Unix(int64(ts), 0).UTC().Format("2006-01-02T15:04:05"),
				"open":  parseFloat(open),
				"high":  parseFloat(high),
				"low":   parseFloat(low),
				"close": parseFloat(close),
			})
		}
		break
	}
	return candles
}

func (s *Service) fetchBinance(ctx context.Context, hours int, intervalMin int) []map[string]any {
	interval := "15m"
	switch intervalMin {
	case 1:
		interval = "1m"
	case 3:
		interval = "3m"
	case 5:
		interval = "5m"
	case 30:
		interval = "30m"
	case 60:
		interval = "1h"
	}
	startMs := (time.Now().UTC().Unix() - int64(hours*3600)) * 1000
	apiURL := fmt.Sprintf("https://api.binance.com/api/v3/klines?symbol=BTCEUR&interval=%s&limit=1000&startTime=%d", interval, startMs)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	resp, err := s.client().Do(req)
	if err != nil {
		fmt.Printf("[OHLC] Binance error: %v\n", err)
		return nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}
	var raw [][]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		fmt.Printf("[OHLC] Binance parse error: %v\n", err)
		return nil
	}

	candles := make([]map[string]any, 0, len(raw))
	for _, c := range raw {
		if len(c) < 5 {
			continue
		}
		var tsMs int64
		json.Unmarshal(c[0], &tsMs)
		var open, high, low, cls string
		json.Unmarshal(c[1], &open)
		json.Unmarshal(c[2], &high)
		json.Unmarshal(c[3], &low)
		json.Unmarshal(c[4], &cls)
		candles = append(candles, map[string]any{
			"time":  time.UnixMilli(tsMs).UTC().Format("2006-01-02T15:04:05"),
			"open":  parseFloat(open),
			"high":  parseFloat(high),
			"low":   parseFloat(low),
			"close": parseFloat(cls),
		})
	}
	return candles
}

func (s *Service) fetchBitstamp(ctx context.Context, hours int, intervalMin int) []map[string]any {
	step := intervalMin * 60
	start := time.Now().UTC().Unix() - int64(hours*3600)
	apiURL := fmt.Sprintf("https://www.bitstamp.net/api/v2/ohlc/btceur/?step=%d&limit=1000&start=%d", step, start)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	resp, err := s.client().Do(req)
	if err != nil {
		fmt.Printf("[OHLC] Bitstamp error: %v\n", err)
		return nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}
	var result struct {
		Data struct {
			OHLC []struct {
				Timestamp string `json:"timestamp"`
				Open      string `json:"open"`
				High      string `json:"high"`
				Low       string `json:"low"`
				Close     string `json:"close"`
			} `json:"ohlc"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		fmt.Printf("[OHLC] Bitstamp parse error: %v\n", err)
		return nil
	}

	candles := make([]map[string]any, 0, len(result.Data.OHLC))
	for _, c := range result.Data.OHLC {
		ts, _ := strconv.ParseInt(c.Timestamp, 10, 64)
		candles = append(candles, map[string]any{
			"time":  time.Unix(ts, 0).UTC().Format("2006-01-02T15:04:05"),
			"open":  parseFloat(c.Open),
			"high":  parseFloat(c.High),
			"low":   parseFloat(c.Low),
			"close": parseFloat(c.Close),
		})
	}
	return candles
}

func (s *Service) fetchCoinbase(ctx context.Context, hours int, intervalMin int) []map[string]any {
	gran := intervalMin * 60
	end := time.Now().UTC()
	start := end.Add(-time.Duration(hours) * time.Hour)
	apiURL := fmt.Sprintf(
		"https://api.exchange.coinbase.com/products/BTC-EUR/candles?granularity=%d&start=%s&end=%s",
		gran,
		url.QueryEscape(start.Format(time.RFC3339)),
		url.QueryEscape(end.Format(time.RFC3339)),
	)
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	resp, err := s.client().Do(req)
	if err != nil {
		fmt.Printf("[OHLC] Coinbase error: %v\n", err)
		return nil
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil
	}
	var raw [][]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		fmt.Printf("[OHLC] Coinbase parse error: %v\n", err)
		return nil
	}

	candles := make([]map[string]any, 0, len(raw))
	for i := len(raw) - 1; i >= 0; i-- {
		c := raw[i]
		if len(c) < 5 {
			continue
		}
		var ts int64
		json.Unmarshal(c[0], &ts)
		var low, high, open, cls float64
		json.Unmarshal(c[1], &low)
		json.Unmarshal(c[2], &high)
		json.Unmarshal(c[3], &open)
		json.Unmarshal(c[4], &cls)
		candles = append(candles, map[string]any{
			"time":  time.Unix(ts, 0).UTC().Format("2006-01-02T15:04:05"),
			"open":  open,
			"high":  high,
			"low":   low,
			"close": cls,
		})
	}
	return candles
}

func parseFloat(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	return v
}
