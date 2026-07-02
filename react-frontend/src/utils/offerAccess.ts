import type { AbortCostBreakdown, CostBreakdown, Offer, PastProfitableOrder, PremiumFilterMode } from '../types';

export function getOfferPrice(offer: Offer): number {
  return offer.pricing?.offer_price ?? offer.pricing?.avg_offer_price ?? offer.price ?? 0;
}

export function getRawPremiumPercent(offer: Offer): number | null {
  return offer.pricing?.raw_premium_percent ?? offer.pricing?.avg_premium_percent ?? offer.raw_premium_percent ?? offer.price_diff_percent ?? null;
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
  return offer.pricing?.ref_price ?? offer.pricing?.avg_ref_price ?? offer.ref_price ?? null;
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

export function getSellerRatingScore(offer: Offer): number | null {
  const score = offer.seller_rating_score;
  if (score == null || typeof score !== 'number' || !Number.isFinite(score)) {
    return null;
  }
  return score;
}

/** True only for a confirmed normalized score of exactly 0 — not "no rating". */
export function hasZeroTrustScore(offer: Offer): boolean {
  const confidence = offer.seller_rating_confidence;
  if (confidence == null || confidence === 'unavailable') {
    return false;
  }
  const score = getSellerRatingScore(offer);
  return score === 0;
}

export function getNetPremiumPercent(offer: Offer, capped = false): number | null {
  if (offer.analysis) {
    const scenario = capped ? offer.analysis.capped_volume : offer.analysis.full_volume;
    return scenario?.premium.net_percent ?? scenario?.premium.avg_net_percent ?? null;
  }
  return capped ? offer.net_premium_percent_capped ?? null : offer.net_premium_percent ?? null;
}

export function getTradeCostPercent(offer: Offer, capped = false): number | null {
  if (offer.analysis) {
    const scenario = capped ? offer.analysis.capped_volume : offer.analysis.full_volume;
    return scenario?.premium.trade_cost_percent ?? scenario?.premium.avg_trade_cost_percent ?? null;
  }
  return capped ? offer.trade_cost_percent_capped ?? null : offer.trade_cost_percent ?? null;
}

export function getEstimatedProfitBtc(offer: Offer, capped = false): number | null {
  if (offer.analysis) {
    const scenario = capped ? offer.analysis.capped_volume : offer.analysis.full_volume;
    return scenario?.profit.btc ?? scenario?.profit.avg_btc ?? null;
  }
  return capped ? offer.estimated_profit_btc_capped ?? null : offer.estimated_profit_btc ?? null;
}

export function getEstimatedProfitFiat(offer: Offer, capped = false): number | null {
  if (offer.analysis) {
    const scenario = capped ? offer.analysis.capped_volume : offer.analysis.full_volume;
    return scenario?.profit.fiat ?? scenario?.profit.avg_fiat ?? null;
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
    : scenario.profit.avg_btc != null && scenario.trade_size_btc > 0
      ? (scenario.profit.avg_btc / scenario.trade_size_btc) * 100
      : scenario.premium.net_percent ?? scenario.premium.avg_net_percent ?? null;

  const cexTakerBTC = scenario.costs.cex_taker.btc ?? scenario.costs.cex_taker.avg_btc ?? 0;
  const cexTakerPct = scenario.costs.cex_taker.pct ?? scenario.costs.cex_taker.avg_pct ?? (scenario.trade_size_btc > 0 ? (cexTakerBTC / scenario.trade_size_btc) * 100 : 0);
  const withdrawalBTC = scenario.costs.withdrawal.btc ?? scenario.costs.withdrawal.avg_btc ?? 0;
  const withdrawalPct = scenario.costs.withdrawal.pct ?? scenario.costs.withdrawal.avg_pct ?? (scenario.trade_size_btc > 0 ? (withdrawalBTC / scenario.trade_size_btc) * 100 : 0);
  const dexFeeBTC = scenario.costs.dex_fee.btc ?? scenario.costs.dex_fee.avg_btc ?? 0;
  const dexFeePct = scenario.costs.dex_fee.pct ?? scenario.costs.dex_fee.avg_pct ?? (scenario.trade_size_btc > 0 ? (dexFeeBTC / scenario.trade_size_btc) * 100 : 0);
  const networkBTC = networkFee?.btc ?? scenario.costs.network.btc ?? scenario.costs.network.avg_btc ?? 0;
  const networkPct = scenario.costs.network.pct ?? scenario.costs.network.avg_pct ?? (scenario.trade_size_btc > 0 ? (networkBTC / scenario.trade_size_btc) * 100 : 0);
  const totalBTC = scenario.costs.total.btc ?? scenario.costs.total.avg_btc ?? 0;
  const totalPct = scenario.costs.total.pct ?? scenario.costs.total.avg_pct ?? (scenario.trade_size_btc > 0 ? (totalBTC / scenario.trade_size_btc) * 100 : 0);

  return {
    btc_amount: scenario.trade_size_btc,
    route_cex: scenario.route.cex,
    route_dex: offer.exchange,
    route_method: scenario.route.settlement,
    trade_direction: offer.direction === 'sell' ? 'ask' : 'bid',
    num_network_txs: networkFee?.num_txs ?? networkFee?.detail?.num_txs ?? 0,
    estimated_profit_pct: estimatedProfitPct ?? 0,
    estimated_profit_btc: scenario.profit.btc ?? scenario.profit.avg_btc ?? 0,
    cex_taker_fee_pct: cexTakerPct,
    cex_taker_fee_btc: cexTakerBTC,
    withdrawal_fee_pct: withdrawalPct,
    withdrawal_fee_btc: withdrawalBTC,
    network_fee_pct: networkPct,
    network_fee_btc: networkBTC,
    network_fee_method: networkFee?.method ?? scenario.route.settlement,
    network_fee_tier: networkFee?.tier ?? '',
    network_fee_confidence: networkFee?.confidence ?? 0,
    network_fee_detail: networkFee?.detail ?? null,
    conversion: scenario.costs.conversion,
    hedge: scenario.costs.hedge,
    dex_fee_pct: dexFeePct,
    dex_fee_btc: dexFeeBTC,
    total_cost_pct: totalPct,
    total_cost_btc: totalBTC,
    capital: scenario.capital ?? null,
  };
}

export function pastProfitableOrderAsOffer(order: PastProfitableOrder): Offer {
  const raw = order.offer;
  const num = (key: string): number | null => (typeof raw[key] === 'number' ? raw[key] as number : null);
  const str = (key: string): string | null => (typeof raw[key] === 'string' ? raw[key] as string : null);

  return {
    id: order.id,
    exchange: order.exchange,
    direction: order.direction,
    payment_methods: order.payment_methods ?? null,
    offer_id: order.offer_id ?? null,
    status: order.status,
    pricing: order.pricing,
    analysis: order.analysis,
    price: num('price') ?? undefined,
    price_type: str('price_type'),
    first_seen: order.status.first_seen,
    last_seen: order.status.last_seen,
    is_live: order.status.is_live,
    volume_limits: {
      btc_min: num('btc_min'),
      btc_max: num('btc_max'),
      fiat_min: num('fiat_min'),
      fiat_max: num('fiat_max'),
    },
  };
}

export function getDisplayAbortCost(offer: Offer, capped = false): AbortCostBreakdown | null {
  if (!offer.analysis) return capped ? offer.abort_cost_capped ?? null : offer.abort_cost ?? null;

  const scenario = capped ? offer.analysis.capped_volume : offer.analysis.full_volume;
  return scenario?.abort_cost ?? null;
}
