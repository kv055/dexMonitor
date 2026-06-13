package main

import (
	"net/http"
	"net/url"
	"strings"
)

func handleTradingAccountCexDepositAddresses(w http.ResponseWriter, r *http.Request) {
	forwardTradingAccountCexRequest(w, r, "/api/cex/deposit-addresses")
}

func handleTradingAccountCexWithdrawalAddresses(w http.ResponseWriter, r *http.Request) {
	forwardTradingAccountCexRequest(w, r, "/api/cex/withdrawal-addresses")
}

func handleTradingAccountCexBalances(w http.ResponseWriter, r *http.Request) {
	forwardTradingAccountCexRequest(w, r, "/api/cex/balances")
}

func handleTradingAccountCexHedgePositions(w http.ResponseWriter, r *http.Request) {
	forwardTradingAccountCexRequest(w, r, "/api/cex/hedge-positions")
}

func handleTradingAccountCexSpotTrades(w http.ResponseWriter, r *http.Request) {
	forwardTradingAccountCexRequest(w, r, "/api/cex/spot-trades")
}

func forwardTradingAccountCexRequest(w http.ResponseWriter, r *http.Request, mmPath string) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id, err := pathID(r, "id")
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	account, err := loadTradingAccountByID(r.Context(), id)
	if err != nil {
		writeError(w, err)
		return
	}
	if account.Category != "CEX" {
		http.Error(w, "account is not a CEX account", http.StatusBadRequest)
		return
	}

	target := mmPath + "?provider=" + url.QueryEscape(strings.TrimSpace(account.Provider))
	if mmPath == "/api/cex/spot-trades" {
		if limit := strings.TrimSpace(r.URL.Query().Get("limit")); limit != "" {
			target += "&limit=" + url.QueryEscape(limit)
		}
	}
	forwardMMControllerJSON(w, r, target)
}
