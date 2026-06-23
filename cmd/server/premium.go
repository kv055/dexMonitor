package main

import (
	"math"

	"commons/tradecost"
)

// LifecyclePoint is a single price observation from the order_lifecycle table,
// surfaced by GET /api/past_offers/{id}/lifecycle.
type LifecyclePoint struct {
	// Time records the snapshot time for the lifecycle point.
	Time string `json:"time"`
	// Price is the offer price at that point.
	Price float64 `json:"price"`
	// NetPremiumPct is the net premium percentage, when known.
	NetPremiumPct *float64 `json:"net_premium_pct,omitempty"`
}

// computePriceDiffPct returns the signed percent difference of an offer price
// versus the reference (CEX) price, rounded to two decimals.
func computePriceDiffPct(offerPrice, refPrice float64) float64 {
	if refPrice <= 0 {
		return 0
	}
	return math.Round((offerPrice/refPrice-1)*10000) / 100
}

// computeDirectionalPremiumPct orients the raw price diff by trade direction so a
// "sell" offer's premium is expressed from the taker's perspective.
func computeDirectionalPremiumPct(direction string, offerPrice, refPrice float64) float64 {
	raw := computePriceDiffPct(offerPrice, refPrice)
	if direction == "sell" {
		return -raw
	}
	return raw
}

// selectBTCTradeSize picks the offer's effective BTC trade size, preferring the
// max bound, then the min, then a sensible default.
func selectBTCTradeSize(btcMax, btcMin *float64) float64 {
	if btcMax != nil && *btcMax > 0 {
		return *btcMax
	}
	if btcMin != nil && *btcMin > 0 {
		return *btcMin
	}
	return tradecost.DefaultBTCTradeSize()
}
