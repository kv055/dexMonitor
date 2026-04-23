import { useCallback, useReducer } from 'react';
import { apiFetch } from '../utils/api';
import type { Offer, Stats, OHLCData, PastOrderStats, GeneralStatsData, PastProfitableOrder, TakerOpportunityMode } from '../types';

function excludedPaymentQuery(excludedPaymentMethods: string[]): string {
  if (excludedPaymentMethods.length === 0) return '';
  return `&exclude_payment_methods=${encodeURIComponent(excludedPaymentMethods.join(','))}`;
}

function tradeCostQuery(excludedCEXes: string[], feeTier: string, maxFiatLimit: number | null = null): string {
  let q = '';
  if (excludedCEXes.length > 0) q += `&exclude_cexes=${encodeURIComponent(excludedCEXes.join(','))}`;
  if (feeTier) q += `&fee_tier=${encodeURIComponent(feeTier)}`;
  if (maxFiatLimit != null && maxFiatLimit > 0) q += `&max_fiat_limit=${maxFiatLimit}`;
  return q;
}

interface DashboardState {
  pastOffers: Offer[];
  stats: Stats | null;
  pastOrderStats: PastOrderStats | null;
  pastOrderStatsAll: PastOrderStats | null;
  pastOrderStatsNetCapped: PastOrderStats | null;
  pastOrderStatsAllNetCapped: PastOrderStats | null;
  pastProfitableOrders: PastProfitableOrder[];
  pastProfitableOrdersAll: PastProfitableOrder[];
  pastProfitableOrdersNetCapped: PastProfitableOrder[];
  pastProfitableOrdersAllNetCapped: PastProfitableOrder[];
  generalStats: GeneralStatsData | null;
  ohlcData: OHLCData | null;
  lastUpdatedAt: string;
  error: string | null;
  loading: boolean;
}

type DashboardAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; payload: Omit<DashboardState, 'error' | 'loading'> }
  | { type: 'LOAD_ERROR'; error: string }
  | { type: 'EXTEND_OHLC_SUCCESS'; ohlcData: OHLCData };

const initialDashboardState: DashboardState = {
  pastOffers: [],
  stats: null,
  pastOrderStats: null,
  pastOrderStatsAll: null,
  pastOrderStatsNetCapped: null,
  pastOrderStatsAllNetCapped: null,
  pastProfitableOrders: [],
  pastProfitableOrdersAll: [],
  pastProfitableOrdersNetCapped: [],
  pastProfitableOrdersAllNetCapped: [],
  generalStats: null,
  ohlcData: null,
  lastUpdatedAt: '',
  error: null,
  loading: true,
};

function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: null };
    case 'LOAD_SUCCESS':
      return { ...action.payload, loading: false, error: null };
    case 'LOAD_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'EXTEND_OHLC_SUCCESS':
      return { ...state, ohlcData: action.ohlcData };
  }
}

export function useDashboard() {
  const [state, dispatch] = useReducer(dashboardReducer, initialDashboardState);

  const load = useCallback(async (hours: string, cex: string = 'kraken', excludedPaymentMethods: string[] = [], excludedCEXes: string[] = [], feeTier: string = '', coupledHedge = true, maxFiatLimit: number | null = null) => {
    dispatch({ type: 'LOAD_START' });
    try {
      const excludedQuery = excludedPaymentQuery(excludedPaymentMethods);
      const tcQuery = `${tradeCostQuery(excludedCEXes, feeTier, maxFiatLimit)}${!coupledHedge ? '&coupled_hedge=false' : ''}`;
      const takerQuery = (path: string, mode: TakerOpportunityMode, filtered: boolean) =>
        `${path}?fiat=EUR&premium_mode=${mode}${filtered ? excludedQuery : ''}${tcQuery}`;
      const [s, o, ohlc, posAll, posFiltered, posAllNetCapped, posFilteredNetCapped, profitableAll, profitableFiltered, profitableAllNetCapped, profitableFilteredNetCapped, gs] = await Promise.all([
        apiFetch<Stats>(`/api/stats?hours=${hours}`),
        apiFetch<Offer[]>(`/api/past_offers?hours=${hours}&limit=1000&cex=${cex}${excludedQuery}${tcQuery}`),
        apiFetch<OHLCData>(`/api/ohlc?hours=${hours}&cex=${cex}`),
        apiFetch<PastOrderStats>(takerQuery('/api/past_order_stats', 'net_full', false)),
        excludedQuery ? apiFetch<PastOrderStats>(takerQuery('/api/past_order_stats', 'net_full', true)) : Promise.resolve(null),
        apiFetch<PastOrderStats>(takerQuery('/api/past_order_stats', 'net_capped', false)),
        excludedQuery ? apiFetch<PastOrderStats>(takerQuery('/api/past_order_stats', 'net_capped', true)) : Promise.resolve(null),
        apiFetch<PastProfitableOrder[]>(takerQuery('/api/past_profitable_orders', 'net_full', false)),
        excludedQuery ? apiFetch<PastProfitableOrder[]>(takerQuery('/api/past_profitable_orders', 'net_full', true)) : Promise.resolve(null),
        apiFetch<PastProfitableOrder[]>(takerQuery('/api/past_profitable_orders', 'net_capped', false)),
        excludedQuery ? apiFetch<PastProfitableOrder[]>(takerQuery('/api/past_profitable_orders', 'net_capped', true)) : Promise.resolve(null),
        apiFetch<GeneralStatsData>(`/api/general_stats?hours=${hours}&cex=${cex}${excludedQuery}${tcQuery}`),
      ]);
      dispatch({
        type: 'LOAD_SUCCESS',
        payload: {
          stats: s,
          pastOffers: o,
          ohlcData: ohlc,
          pastOrderStatsAll: posAll,
          pastOrderStats: posFiltered ?? posAll,
          pastOrderStatsAllNetCapped: posAllNetCapped,
          pastOrderStatsNetCapped: posFilteredNetCapped ?? posAllNetCapped,
          pastProfitableOrdersAll: profitableAll,
          pastProfitableOrders: profitableFiltered ?? profitableAll,
          pastProfitableOrdersAllNetCapped: profitableAllNetCapped,
          pastProfitableOrdersNetCapped: profitableFilteredNetCapped ?? profitableAllNetCapped,
          generalStats: gs,
          lastUpdatedAt: new Date().toISOString(),
        },
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      dispatch({ type: 'LOAD_ERROR', error: `Failed to load data: ${message}` });
    }
  }, []);

  // Silently extend the OHLC window without touching other data or the global loading state.
  const extendOhlc = useCallback(async (hours: number, cex: string = 'kraken') => {
    try {
      const ohlc = await apiFetch<OHLCData>(`/api/ohlc?hours=${hours}&cex=${cex}`);
      dispatch({ type: 'EXTEND_OHLC_SUCCESS', ohlcData: ohlc });
    } catch {
      // Fail silently — the existing candles remain intact
    }
  }, []);

  return {
    ...state,
    load,
    extendOhlc,
  };
}
