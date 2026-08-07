import type {
  AbortCostBreakdown,
  CostBreakdown,
  HedgeBreakdown,
  ManualRouteOptions,
  Offer,
  TradeMode,
} from '../types';
import {
  getDisplayAbortCost,
  getDisplayCostBreakdown,
  getRawPremiumPercent,
  hasCappedScenario,
  hasMinScenario,
} from './offerAccess';

export type ManualRouteSelection = { spot: string; hedge: string };

export type ScenarioSizeMode = 'full' | 'capped' | 'min';

export const DEFAULT_MANUAL_ROUTE_SELECTION: ManualRouteSelection = { spot: 'auto', hedge: 'auto' };

const EMPTY_HEDGE: HedgeBreakdown = {
  open_fee_pct: 0,
  open_fee_btc: 0,
  close_fee_pct: 0,
  close_fee_btc: 0,
  funding_fee_pct: 0,
  funding_fee_btc: 0,
  fee_sum_pct: 0,
  fee_sum_btc: 0,
  side: '',
  venue: '',
  instrument: '',
  transfer_minutes: 0,
  position: null,
};

export function effectiveScenarioMode(offer: Offer, scenarioMode: ScenarioSizeMode): ScenarioSizeMode {
  if (scenarioMode === 'capped' && !hasCappedScenario(offer)) return 'full';
  if (scenarioMode === 'min' && !hasMinScenario(offer)) return 'full';
  return scenarioMode;
}

export function applyManualRouteSelection(
  bd: CostBreakdown,
  options: ManualRouteOptions | null | undefined,
  selection: ManualRouteSelection,
  premiumPct: number | null,
): CostBreakdown {
  if (!options || (selection.spot === 'auto' && selection.hedge === 'auto')) return bd;
  const spot = selection.spot === 'auto' ? undefined : options.spot_taker_fees.find(option => option.exchange === selection.spot);
  const withdrawal = selection.spot === 'auto' ? undefined : options.withdrawal_fees.find(option => option.exchange === selection.spot);
  const hedge = selection.hedge === 'auto'
    ? undefined
    : options.hedge_costs.find(option => option.hedge.venue === selection.hedge && !option.disabled);
  const next = { ...bd, capital: bd.capital ? { ...bd.capital } : null, hedge: hedge?.hedge ?? bd.hedge };
  if (spot) {
    next.route_cex = spot.exchange;
    next.cex_taker_fee_btc = spot.fee_btc;
    next.cex_taker_fee_pct = spot.fee_pct;
  }
  if (withdrawal && withdrawal.applicable !== false && next.trade_direction !== 'ask') {
    next.withdrawal_fee_btc = withdrawal.fee_btc;
    next.withdrawal_fee_pct = withdrawal.fee_pct;
  }
  if (next.capital) {
    next.capital.trade_mode = 'hedgefull_single_collateral';
    next.capital.hedge_collateral = next.hedge.position?.recommended_collateral ?? 0;
    next.capital.total_fiat = next.capital.spot_notional + next.capital.hedge_collateral + next.capital.security_deposit_fiat;
  }
  const conversionBTC = next.conversion?.fee_sum_btc ?? 0;
  next.total_cost_btc = next.cex_taker_fee_btc + next.withdrawal_fee_btc + next.network_fee_btc + conversionBTC + next.hedge.fee_sum_btc + next.dex_fee_btc;
  next.routing_fee_sum_btc = next.network_fee_btc + conversionBTC;
  next.routing_fee_sum_pct = next.btc_amount > 0 ? (next.routing_fee_sum_btc / next.btc_amount) * 100 : 0;
  next.total_cost_pct = next.btc_amount > 0 ? (next.total_cost_btc / next.btc_amount) * 100 : 0;
  next.estimated_profit_pct = (premiumPct ?? 0) - next.total_cost_pct;
  next.estimated_profit_btc = next.btc_amount * (next.estimated_profit_pct / 100);
  return next;
}

/** Client-side hedgeless derivation for manual route what-if (mirrors server DeriveHedgelessDoubleCollateral). */
export function deriveHedgelessBreakdown(bd: CostBreakdown): CostBreakdown {
  const hedgeFeeBTC = bd.hedge?.fee_sum_btc ?? 0;
  const hedgeFeePct = bd.hedge?.fee_sum_pct ?? 0;
  // A hedgefull Bisq bid can withdraw spot BTC straight from the CEX to Bisq.
  // Hedgeless must instead spend LND->Bisq and later withdraw CEX->LND, turning
  // that single network leg into two. Other DEX routes already use the hub.
  const bisqExtraLeg = bd.route_dex?.toLowerCase() === 'bisq' && bd.trade_direction === 'bid' && bd.num_network_txs === 1;
  const networkFeeBTC = bisqExtraLeg ? bd.network_fee_btc * 2 : bd.network_fee_btc;
  const extraNetworkBTC = networkFeeBTC - bd.network_fee_btc;
  const totalCostBTC = Math.max(0, bd.total_cost_btc - hedgeFeeBTC + extraNetworkBTC);
  const totalCostPct = bd.btc_amount > 0 ? (totalCostBTC / bd.btc_amount) * 100 : 0;
  const extraNetworkPct = bd.btc_amount > 0 ? (extraNetworkBTC / bd.btc_amount) * 100 : 0;
  const estimatedProfitPct = bd.estimated_profit_pct + hedgeFeePct - extraNetworkPct;
  const capital = bd.capital
    ? (() => {
        const btcLiquidity = bd.capital.btc_amount + bd.capital.security_deposit_btc;
        const price = bd.capital.btc_price;
        const fiatCollateral = price > 0 ? bd.capital.btc_amount * price : 0;
        return {
          ...bd.capital,
          trade_mode: 'hedgeless_double_collateral' as const,
          hedge_collateral: 0,
          btc_liquidity_btc: btcLiquidity,
          fiat_collateral: fiatCollateral,
          total_fiat: price > 0 ? btcLiquidity * price + fiatCollateral : 0,
        };
      })()
    : null;
  return {
    ...bd,
    route_method: bisqExtraLeg ? 'onchain_hub' : bd.route_method,
    num_network_txs: bisqExtraLeg ? 2 : bd.num_network_txs,
    network_fee_btc: networkFeeBTC,
    network_fee_pct: bd.btc_amount > 0 ? (networkFeeBTC / bd.btc_amount) * 100 : 0,
    routing_profile: bisqExtraLeg ? 'Hub_main2main' : (bd.routing_profile || bd.route_method),
    routing_fee_sum_btc: networkFeeBTC + (bd.conversion?.fee_sum_btc ?? 0),
    routing_fee_sum_pct: bd.btc_amount > 0
      ? ((networkFeeBTC + (bd.conversion?.fee_sum_btc ?? 0)) / bd.btc_amount) * 100
      : 0,
    hedge: EMPTY_HEDGE,
    total_cost_btc: totalCostBTC,
    total_cost_pct: totalCostPct,
    estimated_profit_pct: estimatedProfitPct,
    estimated_profit_btc: bd.btc_amount * (estimatedProfitPct / 100),
    capital,
  };
}

export function resolveTradeBreakdown(
  offer: Offer,
  sizeMode: ScenarioSizeMode,
  tradeMode: TradeMode,
  selection: ManualRouteSelection = DEFAULT_MANUAL_ROUTE_SELECTION,
): {
  breakdown: CostBreakdown | null;
  abortCost: AbortCostBreakdown | null;
  effectiveMode: ScenarioSizeMode;
} {
  const effectiveMode = effectiveScenarioMode(offer, sizeMode);
  const costBreakdown = getDisplayCostBreakdown(offer, effectiveMode);
  const scenario = effectiveMode === 'capped'
    ? offer.analysis?.capped_volume
    : effectiveMode === 'min'
      ? offer.analysis?.min_volume
      : offer.analysis?.full_volume;
  const hedgelessVariant = scenario?.hedgeless_double_collateral ?? null;
  const options = scenario?.manual_route_options;
  const rawPremium = getRawPremiumPercent(offer);
  const manualIsAuto = selection.spot === 'auto' && selection.hedge === 'auto';
  const hedgefullBreakdown = costBreakdown
    ? applyManualRouteSelection(costBreakdown, options, selection, rawPremium)
    : null;

  let breakdown: CostBreakdown | null = null;
  if (hedgefullBreakdown) {
    if (tradeMode !== 'hedgeless_double_collateral') {
      breakdown = hedgefullBreakdown;
    } else if (manualIsAuto && hedgelessVariant) {
      // Auto-routing uses the backend's authoritative hedgeless scenario. A
      // manual CEX choice has no matching server variant, so it falls through
      // to a local derivation from the selected hedgefull route instead.
      // Start with a complete client-side derivation so payloads from an older
      // backend (which lack route/network metadata) remain safe during rolling
      // upgrades. Newer server fields override those fallbacks when present.
      const derived = deriveHedgelessBreakdown(hedgefullBreakdown);
      breakdown = {
        ...derived,
        route_cex: hedgelessVariant.route?.cex || derived.route_cex,
        route_method: hedgelessVariant.route?.settlement || derived.route_method,
        num_network_txs: hedgelessVariant.num_network_txs ?? derived.num_network_txs,
        network_fee_method: hedgelessVariant.network_fee_method || derived.network_fee_method,
        network_fee_btc: hedgelessVariant.costs?.network?.btc ?? derived.network_fee_btc,
        network_fee_pct: hedgelessVariant.costs?.network?.pct ?? derived.network_fee_pct,
        hedge: hedgelessVariant.costs?.hedge ?? derived.hedge,
        total_cost_btc: hedgelessVariant.costs?.total?.btc ?? derived.total_cost_btc,
        total_cost_pct: hedgelessVariant.costs?.total?.pct ?? derived.total_cost_pct,
        estimated_profit_pct: hedgelessVariant.premium?.net_percent ?? derived.estimated_profit_pct,
        estimated_profit_btc: hedgelessVariant.profit?.btc ?? derived.estimated_profit_btc,
        capital: hedgelessVariant.capital ?? derived.capital,
      };
    } else {
      breakdown = deriveHedgelessBreakdown(hedgefullBreakdown);
    }
  }

  const abortCost = tradeMode === 'hedgeless_double_collateral' && manualIsAuto && hedgelessVariant?.abort_cost
    ? hedgelessVariant.abort_cost
    : getDisplayAbortCost(offer, effectiveMode);

  return { breakdown, abortCost, effectiveMode };
}
