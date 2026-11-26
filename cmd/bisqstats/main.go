package main

import (
	"commons/apierror"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	bisqstatsapi "dexmonitor/internal/api/gen/bisqstats"
	"dexmonitor/internal/bisqstats"
)

// This binary is a dormant helper API for future Bisq settlement analysis.
// It serves stats derived from the local ClosedTrades store, but it is
// intentionally not wired into docker-compose at the moment.
func main() {
	addr := envOr("STATS_API_ADDR", ":9997")
	appDataDir := envOr("BISQ_APP_DATA_DIR", "/home/appuser/.local/share/Bisq")
	reader := bisqstats.NewReader(bisqstats.DefaultDBDir(appDataDir))

	legacyMux := http.NewServeMux()
	legacyMux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{
			"status":       "ok",
			"generated_at": time.Now().UTC(),
			"trades_file":  reader.ClosedTradesPath(),
		})
	})
	legacyMux.HandleFunc("GET /api/trade-stats", func(w http.ResponseWriter, r *http.Request) {
		records, skipped, err := reader.ReadClosedTradeRecords()
		if err != nil {
			writeError(w, http.StatusInternalServerError, err)
			return
		}
		resp := bisqstats.BuildResponse(records, skipped, reader.ClosedTradesPath(), parseQuery(r), time.Now().UTC())
		writeJSON(w, resp)
	})
	mux := http.NewServeMux()
	bisqstatsapi.RegisterLegacyStrictHandler(legacyMux, mux)

	log.Printf("Starting Bisq stats API on http://127.0.0.1%s", addr)
	if err := http.ListenAndServe(addr, cors(mux)); err != nil {
		log.Fatalf("stats api error: %v", err)
	}
}

func parseQuery(r *http.Request) bisqstats.Query {
	return bisqstats.Query{
		Hours:         queryInt(r, "hours", 24*30),
		Days:          queryInt(r, "days", 0),
		PaymentMethod: strings.TrimSpace(r.URL.Query().Get("payment_method")),
		Currency:      strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("currency"))),
	}
}

func queryInt(r *http.Request, key string, fallback int) int {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return fallback
	}
	v, err := strconv.Atoi(raw)
	if err != nil || v < 0 {
		return fallback
	}
	return v
}

func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(payload)
}

func writeError(w http.ResponseWriter, status int, err error) {
	status, body, ref := apierror.Describe(err, status, apierror.Options{Service: "the Bisq statistics service"})
	if ref != "" {
		log.Printf("bisqstats: request failed (ref %s): %v", ref, err)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func init() {
	log.SetFlags(0)
	log.SetPrefix("[bisqstats] ")
}
