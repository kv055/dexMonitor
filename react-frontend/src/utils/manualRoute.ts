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
  next.total_cost_pct = next.btc_amount > 0 ? (next.total_cost_btc / next.btc_amount) * 100 : 0;
  next.estimated_profit_pct = (premiumPct ?? 0) - next.total_cost_pct;
  next.estimated_profit_btc = next.btc_amount * (next.estimated_profit_pct / 100);
  return next;
}

/** Client-side hedgeless derivation for manual route what-if (mirrors server DeriveHedgelessDoubleCollateral). */
export function deriveHedgelessBreakdown(bd: CostBreakdown): CostBreakdown {
  const hedgeFeeBTC = bd.hedge.fee_sum_btc;
  const hedgeFeePct = bd.hedge.fee_sum_pct;
  const totalCostBTC = Math.max(0, bd.total_cost_btc - hedgeFeeBTC);
  const totalCostPct = bd.btc_amount > 0 ? (totalCostBTC / bd.btc_amount) * 100 : 0;
  const estimatedProfitPct = bd.estimated_profit_pct + hedgeFeePct;
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
      breakdown = {
        ...hedgefullBreakdown,
        hedge: hedgelessVariant.costs.hedge,
        total_cost_btc: hedgelessVariant.costs.total.btc ?? 0,
        total_cost_pct: hedgelessVariant.costs.total.pct ?? 0,
        estimated_profit_pct: hedgelessVariant.premium.net_percent ?? 0,
        estimated_profit_btc: hedgelessVariant.profit.btc ?? 0,
        capital: hedgelessVariant.capital ?? null,
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
