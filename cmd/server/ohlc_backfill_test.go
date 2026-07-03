package main

import (
	"testing"
	"time"
)

func mkRow(t *testing.T, ts string, open, high, low, close float64) ohlcRow {
	t.Helper()
	parsed, err := time.Parse(ohlcCandleTimeLayout, ts)
	if err != nil {
		t.Fatalf("bad test timestamp %q: %v", ts, err)
	}
	return ohlcRow{time: parsed, open: open, high: high, low: low, close: close}
}

func TestAggregateOHLCRowsBucketsAndCutoff(t *testing.T) {
	rows := []ohlcRow{
		// First 5-min bucket: 10:00–10:04
		mkRow(t, "2026-07-01T10:00:00", 100, 110, 95, 105),
		mkRow(t, "2026-07-01T10:02:00", 105, 120, 104, 118),
		mkRow(t, "2026-07-01T10:04:00", 118, 119, 90, 92),
		// Second 5-min bucket: 10:05–10:09
		mkRow(t, "2026-07-01T10:05:00", 92, 93, 91, 92),
		// Third bucket starts at the cutoff — must be dropped.
		mkRow(t, "2026-07-01T10:10:00", 92, 94, 92, 93),
	}
	cutoff := time.Date(2026, 7, 1, 10, 10, 0, 0, time.UTC).Unix()

	candles := aggregateOHLCRows(rows, 5, cutoff)
	if len(candles) != 2 {
		t.Fatalf("expected 2 candles, got %d: %v", len(candles), candles)
	}

	first := candles[0]
	if first["time"] != "2026-07-01T10:00:00" {
		t.Errorf("first bucket time = %v", first["time"])
	}
	if first["open"] != 100.0 || first["high"] != 120.0 || first["low"] != 90.0 || first["close"] != 92.0 {
		t.Errorf("first bucket OHLC = %v/%v/%v/%v", first["open"], first["high"], first["low"], first["close"])
	}

	second := candles[1]
	if second["time"] != "2026-07-01T10:05:00" {
		t.Errorf("second bucket time = %v", second["time"])
	}
	if second["open"] != 92.0 || second["close"] != 92.0 {
		t.Errorf("second bucket open/close = %v/%v", second["open"], second["close"])
	}
}

func TestAggregateOHLCRowsEmpty(t *testing.T) {
	if got := aggregateOHLCRows(nil, 5, time.Now().Unix()); len(got) != 0 {
		t.Fatalf("expected no candles from no rows, got %v", got)
	}
}
