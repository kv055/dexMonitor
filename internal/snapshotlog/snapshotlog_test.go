package snapshotlog

import "testing"

func TestCompactExchangesPreservesCaptureStatus(t *testing.T) {
	got := CompactExchanges(map[string]any{
		"bisq": map[string]any{
			"count":   float64(0),
			"ids":     []any{},
			"status":  "complete",
			"offline": false,
		},
		"robosats": map[string]any{
			"count":   float64(3),
			"ids":     []any{"a", "b", "c"},
			"status":  "incomplete",
			"offline": true,
		},
	})
	bisq := got["bisq"].(map[string]any)
	if bisq["count"] != 0 || bisq["status"] != "complete" {
		t.Fatalf("bisq = %#v, want complete count 0", bisq)
	}
	if _, ok := bisq["ids"]; ok {
		t.Fatalf("compact bisq still has ids: %#v", bisq)
	}
	robo := got["robosats"].(map[string]any)
	if robo["count"] != 3 || robo["status"] != "incomplete" || robo["offline"] != true {
		t.Fatalf("robosats = %#v, want incomplete offline count 3", robo)
	}
}
