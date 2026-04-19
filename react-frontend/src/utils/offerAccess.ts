import type { CostBreakdown, Offer, PremiumFilterMode } from '../types';

export function getOfferPrice(offer: Offer): number {
  return offer.pricing?.offer_price ?? offer.price ?? 0;
}

export function getRawPremiumPercent(offer: Offer): number | null {
  return offer.pricing?.raw_premium_percent ?? offer.raw_premium_percent ?? offer.price_diff_percent ?? null;
}

export function getPremiumMetricValue(offer: Offer, mode: PremiumFilterMode): number | null {
  switch (mode) {
    case 'net_full':
      return getNetPremiumPercent(offer, false);
    case 'net_capped':
      return getNetPremiumPercent(offer, true);
    case 'raw':
    default:
      return getRawPremiumPercent(offer);
  }
}

export function getRefPrice(offer: Offer): number | null {
  return offer.pricing?.ref_price ?? offer.ref_price ?? null;
}

export function getPriceType(offer: Offer): string | null {
  return offer.pricing?.price_type ?? offer.price_type ?? null;
}

export function getBtcMin(offer: Offer): number | null {
  return offer.volume_limits?.btc_min ?? offer.btc_min ?? null;
}

export function getBtcMax(offer: Offer): number | null {
  return offer.volume_limits?.btc_max ?? offer.btc_max ?? null;
}

export function getFiatMin(offer: Offer): number | null {
  return offer.volume_limits?.fiat_min ?? (getBtcMin(offer) != null ? getBtcMin(offer)! * getOfferPrice(offer) : null);
}

export function getFiatMax(offer: Offer): number | null {
  return offer.volume_limits?.fiat_max ?? (getBtcMax(offer) != null ? getBtcMax(offer)! * getOfferPrice(offer) : null);
}

export function getFirstSeen(offer: Offer): string | null {
  return offer.status?.first_seen ?? offer.first_seen ?? null;
}

export function getLastSeen(offer: Offer): string | null {
  return offer.status?.last_seen ?? offer.last_seen ?? null;
}

export function isOfferLive(offer: Offer): boolean {
  return offer.status?.is_live ?? offer.is_live ?? false;
}

export function getNetPremiumPercent(offer: Offer, capped = false): number | null {
  if (offer.analysis) {
    const scenario = capped ? offer.analysis.capped_volume : offer.analysis.full_volume;
    return scenario?.premium.net_percent ?? null;
  }
  return capped ? offer.net_premium_percent_capped ?? null : offer.net_premium_percent ?? null;
}

export function getTradeCostPercent(offer: Offer, capped = false): number | null {
  if (offer.analysis) {
    const scenario = capped ? offer.analysis.capped_volume : offer.analysis.full_volume;
    return scenario?.premium.trade_cost_percent ?? null;
  }
  return capped ? offer.trade_cost_percent_capped ?? null : offer.trade_cost_percent ?? null;
}

export function getEstimatedProfitBtc(offer: Offer, capped = false): number | null {
  if (offer.analysis) {
    const scenario = capped ? offer.analysis.capped_volume : offer.analysis.full_volume;
    return scenario?.profit.btc ?? null;
  }
  return capped ? offer.estimated_profit_btc_capped ?? null : offer.estimated_profit_btc ?? null;
}

export function getEstimatedProfitFiat(offer: Offer, capped = false): number | null {
  if (offer.analysis) {
    const scenario = capped ? offer.analysis.capped_volume : offer.analysis.full_volume;
    return scenario?.profit.fiat ?? null;
  }
  return capped ? offer.estimated_profit_fiat_capped ?? null : offer.estimated_profit_fiat ?? null;
}

export function getCappedTradeSizeBtc(offer: Offer): number | null {
  if (offer.analysis?.capped_volume) return offer.analysis.capped_volume.trade_size_btc;
  return offer.cost_breakdown_capped?.btc_amount ?? null;
}

export function hasCappedScenario(offer: Offer): boolean {
  return !!offer.analysis?.capped_volume || !!offer.cost_breakdown_capped;
}

export function getDisplayCostBreakdown(offer: Offer, capped = false): CostBreakdown | null {
  if (!offer.analysis) return capped ? offer.cost_breakdown_capped ?? null : offer.cost_breakdown ?? null;

  const scenario = capped ? offer.analysis.capped_volume : offer.analysis.full_volume;
  if (!scenario) return null;

  const networkFee = offer.btc_network_fee;
  const estimatedProfitPct = scenario.profit.btc != null && scenario.trade_size_btc > 0
    ? (scenario.profit.btc / scenario.trade_size_btc) * 100
    : scenario.premium.net_percent ?? null;

  return {
    btc_amount: scenario.trade_size_btc,
    route_cex: scenario.route.cex,
    route_dex: offer.exchange,
    route_method: scenario.route.settlement,
    trade_direction: offer.direction === 'sell' ? 'ask' : 'bid',
    num_network_txs: networkFee?.num_txs ?? networkFee?.detail?.num_txs ?? 0,
    estimated_profit_pct: estimatedProfitPct ?? 0,
    estimated_profit_btc: scenario.profit.btc ?? 0,
    cex_taker_fee_pct: scenario.costs.cex_taker.pct,
    cex_taker_fee_btc: scenario.costs.cex_taker.btc,
    withdrawal_fee_pct: scenario.costs.withdrawal.pct,
    withdrawal_fee_btc: scenario.costs.withdrawal.btc,
    network_fee_pct: scenario.costs.network.pct,
    network_fee_btc: networkFee?.btc ?? 0,
    network_fee_method: networkFee?.method ?? scenario.route.settlement,
    network_fee_tier: networkFee?.tier ?? '',
    network_fee_confidence: networkFee?.confidence ?? 0,
    network_fee_detail: networkFee?.detail ?? null,
    hedge: scenario.costs.hedge,
    dex_fee_pct: scenario.costs.dex_fee.pct,
    dex_fee_btc: scenario.costs.dex_fee.btc,
    total_cost_pct: scenario.costs.total.pct,
    total_cost_btc: scenario.costs.total.btc,
  };
}
