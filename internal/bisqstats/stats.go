package bisqstats

import (
	"math"
	"sort"
	"strings"
	"time"
)

// These types/functions aggregate per-trade settlement durations after the raw
// Bisq ClosedTrades records have been decoded. The key metric is
// take_offer_date -> sellerConfirmedPaymentReceiptDate.
type TradeRecord struct {
	TradeID            string
	Role               string
	PaymentMethodID    string
	FiatCurrency       string
	TakeOfferAt        time.Time
	SellerConfirmedAt  time.Time
	SettlementDuration time.Duration
}

type Query struct {
	Hours         int
	Days          int
	PaymentMethod string
	Currency      string
}

type Response struct {
	Source          string           `json:"source"`
	Definition      Definition       `json:"definition"`
	Window          Window           `json:"window"`
	TradesFile      string           `json:"trades_file"`
	CompletedTrades int              `json:"completed_trades"`
	SkippedTrades   map[string]int   `json:"skipped_trades"`
	Duration        DurationSummary  `json:"duration"`
	ByPaymentMethod []GroupedSummary `json:"by_payment_method"`
	ByCurrency      []GroupedSummary `json:"by_currency"`
	GeneratedAt     time.Time        `json:"generated_at"`
}

type Definition struct {
	StartField string `json:"start_field"`
	EndField   string `json:"end_field"`
}

type Window struct {
	Hours int       `json:"hours,omitempty"`
	From  time.Time `json:"from,omitempty"`
	To    time.Time `json:"to"`
}

type GroupedSummary struct {
	Name            string          `json:"name"`
	CompletedTrades int             `json:"completed_trades"`
	Duration        DurationSummary `json:"duration"`
}

type DurationSummary struct {
	MeanSeconds   int64 `json:"mean_seconds"`
	MedianSeconds int64 `json:"median_seconds"`
	P90Seconds    int64 `json:"p90_seconds"`
	MinSeconds    int64 `json:"min_seconds"`
	MaxSeconds    int64 `json:"max_seconds"`
}

func BuildResponse(records []TradeRecord, skipped map[string]int, tradesFile string, q Query, now time.Time) Response {
	if now.IsZero() {
		now = time.Now().UTC()
	}

	filtered := make([]TradeRecord, 0, len(records))
	for _, record := range records {
		if !withinWindow(record.SellerConfirmedAt, q, now) {
			continue
		}
		if q.PaymentMethod != "" && !strings.EqualFold(record.PaymentMethodID, q.PaymentMethod) {
			continue
		}
		if q.Currency != "" && !strings.EqualFold(record.FiatCurrency, q.Currency) {
			continue
		}
		filtered = append(filtered, record)
	}

	return Response{
		Source:          "bisq_closed_trades_store",
		Definition:      Definition{StartField: "take_offer_date", EndField: "sellerConfirmedPaymentReceiptDate"},
		Window:          buildWindow(q, now),
		TradesFile:      tradesFile,
		CompletedTrades: len(filtered),
		SkippedTrades:   copySkipped(skipped),
		Duration:        buildDurationSummary(filtered),
		ByPaymentMethod: buildGroupedSummaries(filtered, func(record TradeRecord) string {
			if record.PaymentMethodID == "" {
				return "unknown"
			}
			return record.PaymentMethodID
		}),
		ByCurrency: buildGroupedSummaries(filtered, func(record TradeRecord) string {
			if record.FiatCurrency == "" {
				return "unknown"
			}
			return record.FiatCurrency
		}),
		GeneratedAt: now,
	}
}

func withinWindow(ts time.Time, q Query, now time.Time) bool {
	if ts.IsZero() {
		return false
	}
	hours := q.Hours
	if q.Days > 0 {
		hours = q.Days * 24
	}
	if hours <= 0 {
		return true
	}
	return !ts.Before(now.Add(-time.Duration(hours) * time.Hour))
}

func buildWindow(q Query, now time.Time) Window {
	hours := q.Hours
	if q.Days > 0 {
		hours = q.Days * 24
	}
	window := Window{To: now}
	if hours > 0 {
		window.Hours = hours
		window.From = now.Add(-time.Duration(hours) * time.Hour)
	}
	return window
}

func buildGroupedSummaries(records []TradeRecord, groupFn func(TradeRecord) string) []GroupedSummary {
	grouped := map[string][]TradeRecord{}
	for _, record := range records {
		key := groupFn(record)
		grouped[key] = append(grouped[key], record)
	}

	names := make([]string, 0, len(grouped))
	for name := range grouped {
		names = append(names, name)
	}
	sort.Strings(names)

	out := make([]GroupedSummary, 0, len(names))
	for _, name := range names {
		group := grouped[name]
		out = append(out, GroupedSummary{
			Name:            name,
			CompletedTrades: len(group),
			Duration:        buildDurationSummary(group),
		})
	}

	sort.Slice(out, func(i, j int) bool {
		if out[i].CompletedTrades == out[j].CompletedTrades {
			return out[i].Name < out[j].Name
		}
		return out[i].CompletedTrades > out[j].CompletedTrades
	})
	return out
}

func buildDurationSummary(records []TradeRecord) DurationSummary {
	if len(records) == 0 {
		return DurationSummary{}
	}

	durations := make([]int64, 0, len(records))
	var sum float64
	for _, record := range records {
		seconds := int64(record.SettlementDuration / time.Second)
		durations = append(durations, seconds)
		sum += float64(seconds)
	}

	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })

	return DurationSummary{
		MeanSeconds:   int64(math.Round(sum / float64(len(durations)))),
		MedianSeconds: percentile(durations, 0.5),
		P90Seconds:    percentile(durations, 0.9),
		MinSeconds:    durations[0],
		MaxSeconds:    durations[len(durations)-1],
	}
}

func percentile(sorted []int64, p float64) int64 {
	if len(sorted) == 0 {
		return 0
	}
	if len(sorted) == 1 {
		return sorted[0]
	}
	index := int(math.Ceil(float64(len(sorted))*p)) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	return sorted[index]
}

func copySkipped(in map[string]int) map[string]int {
	if len(in) == 0 {
		return map[string]int{}
	}
	out := make(map[string]int, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
