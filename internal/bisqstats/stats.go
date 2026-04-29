package bisqstats

import (
	"math"
	"sort"
	"strings"
	"time"
)

// TradeRecord captures the Bisq closed-trade fields needed to calculate
// settlement duration.
type TradeRecord struct {
	// TradeID is Bisq's trade identifier.
	TradeID string
	// Role is the local node's role in the trade.
	Role string
	// PaymentMethodID identifies the fiat payment rail used by the trade.
	PaymentMethodID string
	// FiatCurrency is the trade's fiat currency code.
	FiatCurrency string
	// TakeOfferAt records when the offer was taken.
	TakeOfferAt time.Time
	// SellerConfirmedAt records when the seller confirmed fiat receipt.
	SellerConfirmedAt time.Time
	// SettlementDuration is the elapsed time between taking the offer and seller confirmation.
	SettlementDuration time.Duration
}

// Query selects the time window and optional grouping filters for Bisq stats.
type Query struct {
	// Hours is the hours value for the query.
	Hours int
	// Days is the days value for the query.
	Days int
	// PaymentMethod is the payment method value for the query.
	PaymentMethod string
	// Currency names the asset or network for the query.
	Currency string
}

// Response represents a response.
type Response struct {
	// Source is the source value for the response.
	Source string `json:"source"`
	// Definition is the definition value for the response.
	Definition Definition `json:"definition"`
	// Window is the window value for the response.
	Window Window `json:"window"`
	// TradesFile is the trades file value for the response.
	TradesFile string `json:"trades_file"`
	// CompletedTrades is the completed trades value for the response.
	CompletedTrades int `json:"completed_trades"`
	// SkippedTrades is the skipped trades value for the response.
	SkippedTrades map[string]int `json:"skipped_trades"`
	// Duration is the duration value for the response.
	Duration DurationSummary `json:"duration"`
	// ByPaymentMethod is the by payment method value for the response.
	ByPaymentMethod []GroupedSummary `json:"by_payment_method"`
	// ByCurrency names the asset or network for the response.
	ByCurrency []GroupedSummary `json:"by_currency"`
	// GeneratedAt records the relevant time for the response.
	GeneratedAt time.Time `json:"generated_at"`
}

// Definition represents a definition.
type Definition struct {
	// StartField is the start field value for the definition.
	StartField string `json:"start_field"`
	// EndField is the end field value for the definition.
	EndField string `json:"end_field"`
}

// Window represents a window.
type Window struct {
	// Hours is the hours value for the window.
	Hours int `json:"hours,omitempty"`
	// From is the from value for the window.
	From time.Time `json:"from,omitempty"`
	// To is the to value for the window.
	To time.Time `json:"to"`
}

// GroupedSummary represents a grouped summary.
type GroupedSummary struct {
	// Name is the name value for the grouped summary.
	Name string `json:"name"`
	// CompletedTrades is the completed trades value for the grouped summary.
	CompletedTrades int `json:"completed_trades"`
	// Duration is the duration value for the grouped summary.
	Duration DurationSummary `json:"duration"`
}

// DurationSummary represents a duration summary.
type DurationSummary struct {
	// MeanSeconds is the mean seconds value for the duration summary.
	MeanSeconds int64 `json:"mean_seconds"`
	// MedianSeconds is the median seconds value for the duration summary.
	MedianSeconds int64 `json:"median_seconds"`
	// P90Seconds is the p90 seconds value for the duration summary.
	P90Seconds int64 `json:"p90_seconds"`
	// MinSeconds is the min seconds value for the duration summary.
	MinSeconds int64 `json:"min_seconds"`
	// MaxSeconds is the max seconds value for the duration summary.
	MaxSeconds int64 `json:"max_seconds"`
}

// BuildResponse builds a response.
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
