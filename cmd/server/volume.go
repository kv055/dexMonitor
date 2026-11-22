package main

import (
	"math"
	"strings"

	"commons/tradecost"
)

// volumeDenominationBTC marks offers whose maker fixed a bitcoin amount.
const volumeDenominationBTC = "BTC"

// offerVolumeDenomination is the unit the maker fixed the offer's volume in:
// "BTC", the offer's fiat code, or "" for rows persisted before
// offers.volume_denomination existed. Those keep the legacy BTC-based sizing.
func offerVolumeDenomination(o map[string]any) string {
	return strings.ToUpper(strings.TrimSpace(offerString(o, "volume_denomination")))
}

// offerVolumeFixedInFiat reports whether the maker fixed a fiat amount. Such an
// offer's stored btc_min/btc_max are only the conversion at its last
// snapshot's price.
func offerVolumeFixedInFiat(o map[string]any) bool {
	d := offerVolumeDenomination(o)
	return d != "" && d != volumeDenominationBTC
}

// offerVolumeFixedInBTC reports whether the maker fixed a bitcoin amount. Such
// an offer's stored fiat_min/fiat_max are only the conversion at its last
// snapshot's price.
func offerVolumeFixedInBTC(o map[string]any) bool {
	return offerVolumeDenomination(o) == volumeDenominationBTC
}

// offerFiatCode is the offer's fiat currency, defaulting to EUR for rows
// written before the currency column existed.
func offerFiatCode(o map[string]any) string {
	return strings.ToUpper(nonEmptyString(offerString(o, "fiat_currency"), "EUR"))
}

// pastOfferAvgOfferPrice is the whole-life average offer price used to convert
// a closed offer's fixed volume into the other unit. The analyzer's persisted
// average wins so every past-offer path converts identically, even after
// lifecycle rows are pruned; aggAvgPrice and the last price are fallbacks.
func pastOfferAvgOfferPrice(o map[string]any, aggAvgPrice float64) float64 {
	if v := offerFloat(o, "avg_lifecycle_price"); v > 0 {
		return v
	}
	if aggAvgPrice > 0 {
		return aggAvgPrice
	}
	return offerFloat(o, "price")
}

// pastOfferBTCBounds returns the BTC volume bounds to analyse a closed offer
// with. BTC-denominated and legacy offers keep their stored btc_min/btc_max.
// A fiat-denominated offer's stored BTC bounds are the conversion at its last
// snapshot's price, which drifts as BTC moves during the offer's life, so its
// fixed fiat bounds are converted at the whole-life average offer price
// instead. That keeps the BTC size on the same whole-life basis as the average
// reference price and profit it is paired with.
func pastOfferBTCBounds(o map[string]any, aggAvgPrice float64) (btcMin, btcMax *float64) {
	if v := offerFloat(o, "btc_min"); v > 0 {
		btcMin = &v
	}
	if v := offerFloat(o, "btc_max"); v > 0 {
		btcMax = &v
	}
	if !offerVolumeFixedInFiat(o) {
		return btcMin, btcMax
	}
	price := pastOfferAvgOfferPrice(o, aggAvgPrice)
	if price <= 0 {
		return btcMin, btcMax
	}
	if v := offerFloat(o, "fiat_min"); v > 0 {
		converted := tradecost.Round8(v / price)
		btcMin = &converted
	}
	if v := offerFloat(o, "fiat_max"); v > 0 {
		converted := tradecost.Round8(v / price)
		btcMax = &converted
	}
	return btcMin, btcMax
}

// pastOfferFiatBounds mirrors pastOfferBTCBounds for the fiat side: a
// BTC-denominated offer's stored fiat bounds are the last snapshot's
// conversion, so its fixed BTC bounds are converted at the whole-life average
// offer price instead. Fiat-denominated and legacy offers keep their stored
// fiat_min/fiat_max.
func pastOfferFiatBounds(o map[string]any, aggAvgPrice float64) (fiatMin, fiatMax *int64) {
	fiatMin = offerInt64Ptr(o, "fiat_min")
	fiatMax = offerInt64Ptr(o, "fiat_max")
	if !offerVolumeFixedInBTC(o) {
		return fiatMin, fiatMax
	}
	price := pastOfferAvgOfferPrice(o, aggAvgPrice)
	if price <= 0 {
		return fiatMin, fiatMax
	}
	convert := func(btcKey string, fallback *int64) *int64 {
		btc := offerFloat(o, btcKey)
		if btc <= 0 {
			return fallback
		}
		v := int64(math.Round(btc * price))
		return &v
	}
	return convert("btc_min", fiatMin), convert("btc_max", fiatMax)
}

// pastOfferVolumeLimits are a closed offer's volume bounds on a whole-life
// basis, tagged with the unit the maker fixed.
func pastOfferVolumeLimitsFor(o map[string]any, aggAvgPrice float64) pastOfferVolumeLimits {
	btcMin, btcMax := pastOfferBTCBounds(o, aggAvgPrice)
	fiatMin, fiatMax := pastOfferFiatBounds(o, aggAvgPrice)
	return pastOfferVolumeLimits{
		BTCMin:             btcMin,
		BTCMax:             btcMax,
		FiatMin:            fiatMin,
		FiatMax:            fiatMax,
		VolumeDenomination: offerVolumeDenomination(o),
	}
}

// pastOfferVolumeFiat is the fiat amount of a closed offer's volume bound
// (fiatKey "fiat_max" or "fiat_min") traded as btcSize. For a fiat-denominated
// offer that is exactly the amount its maker fixed; otherwise the BTC size is
// valued at refPrice.
func pastOfferVolumeFiat(o map[string]any, fiatKey string, btcSize, refPrice float64) float64 {
	if offerVolumeFixedInFiat(o) {
		if v := offerFloat(o, fiatKey); v > 0 {
			return v
		}
	}
	return btcSize * refPrice
}

// pastOfferFullTradeSizeBTC is the full-volume BTC trade size of a closed
// offer on the whole-life basis of pastOfferBTCBounds.
func pastOfferFullTradeSizeBTC(o map[string]any, aggAvgPrice float64) float64 {
	btcMin, btcMax := pastOfferBTCBounds(o, aggAvgPrice)
	return selectBTCTradeSize(btcMax, btcMin)
}

// derefBounds unwraps optional volume bounds, treating nil as zero.
func derefBounds(lo, hi *float64) (float64, float64) {
	var a, b float64
	if lo != nil {
		a = *lo
	}
	if hi != nil {
		b = *hi
	}
	return a, b
}
