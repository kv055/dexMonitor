import { useCallback, useReducer } from 'react';
import { apiFetch, apiPost } from '../utils/api';
import type {
  Offer,
  Stats,
  OHLCData,
  PastOrderStats,
  GeneralStatsData,
  GeneralStatsOverviewData,
  OpenPremiumStats,
  PremiumLifetimeModes,
  PastPremiumTimeframeStats,
  PastProfitableOrder,
} from '../types';

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

function buildGeneralStatsData(
  overview: GeneralStatsOverviewData,
  openPremiums: OpenPremiumStats,
  pastPremiums: PastPremiumTimeframeStats[],
  premiumLifetimes: PremiumLifetimeModes,
): GeneralStatsData {
  return {
    ...overview,
    best_ask_premium_pct: null,
    avg_ask_premium_pct: openPremiums.raw.avg_ask_premium_pct,
    best_bid_premium_pct: null,
    avg_bid_premium_pct: openPremiums.raw.avg_bid_premium_pct,
    open_premiums: openPremiums,
    premium_lifetimes: premiumLifetimes,
    avg_offer_lifetime_ms: premiumLifetimes.raw.avg_offer_lifetime_ms,
    avg_offer_lifetime_ms_by_exchange: premiumLifetimes.raw.avg_offer_lifetime_ms_by_exchange,
    past_premiums: pastPremiums,
  };
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
  analyticsError: string | null;
  loading: boolean;
  analyticsLoading: boolean;
  initialLoadComplete: boolean;
}

type CorePayload = Pick<DashboardState, 'stats' | 'pastOffers' | 'ohlcData' | 'lastUpdatedAt'>;
type AnalyticsPayload = Pick<DashboardState,
  | 'pastOrderStats'
  | 'pastOrderStatsAll'
  | 'pastOrderStatsNetCapped'
  | 'pastOrderStatsAllNetCapped'
  | 'pastProfitableOrders'
  | 'pastProfitableOrdersAll'
  | 'pastProfitableOrdersNetCapped'
  | 'pastProfitableOrdersAllNetCapped'
  | 'generalStats'
>;

type DashboardAction =
  | { type: 'CORE_LOAD_START' }
  | { type: 'CORE_LOAD_SUCCESS'; payload: CorePayload }
  | { type: 'CORE_LOAD_ERROR'; error: string }
  | { type: 'ANALYTICS_LOAD_START' }
  | { type: 'ANALYTICS_LOAD_SUCCESS'; payload: AnalyticsPayload }
  | { type: 'ANALYTICS_LOAD_ERROR'; error: string }
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
  analyticsError: null,
  loading: true,
  analyticsLoading: false,
  initialLoadComplete: false,
};

function hasCoreData(state: DashboardState): boolean {
  return state.stats !== null || state.ohlcData !== null || state.pastOffers.length > 0;
}

function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case 'CORE_LOAD_START':
      return { ...state, loading: !hasCoreData(state), error: null, initialLoadComplete: false };
    case 'CORE_LOAD_SUCCESS':
      return { ...state, ...action.payload, loading: false, error: null };
    case 'CORE_LOAD_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'ANALYTICS_LOAD_START':
      return { ...state, analyticsLoading: true, analyticsError: null };
    case 'ANALYTICS_LOAD_SUCCESS':
      return { ...state, ...action.payload, analyticsLoading: false, analyticsError: null, initialLoadComplete: true };
    case 'ANALYTICS_LOAD_ERROR':
      return { ...state, analyticsLoading: false, analyticsError: action.error, initialLoadComplete: true };
    case 'EXTEND_OHLC_SUCCESS':
      return { ...state, ohlcData: action.ohlcData };
  }
}

export function useDashboard() {
  const [state, dispatch] = useReducer(dashboardReducer, initialDashboardState);

  const load = useCallback(async (hours: string, cex: string = 'kraken', excludedPaymentMethods: string[] = [], excludedCEXes: string[] = [], feeTier: string = '', coupledHedge = true, maxFiatLimit: number | null = null) => {
    dispatch({ type: 'CORE_LOAD_START' });

    const excludedQuery = excludedPaymentQuery(excludedPaymentMethods);
    const tcQuery = `${tradeCostQuery(excludedCEXes, feeTier, maxFiatLimit)}${!coupledHedge ? '&coupled_hedge=false' : ''}`;
    try {
      const [s, o, ohlc] = await Promise.all([
        apiFetch<Stats>(`/api/stats?hours=${hours}`),
        apiFetch<Offer[]>(`/api/past_offers?hours=${hours}&limit=1000&compact=true&cex=${cex}${excludedQuery}${tcQuery}`),
        apiFetch<OHLCData>(`/api/ohlc?hours=${hours}&cex=${cex}`),
      ]);
      dispatch({
        type: 'CORE_LOAD_SUCCESS',
        payload: {
          stats: s,
          pastOffers: o,
          ohlcData: ohlc,
          lastUpdatedAt: new Date().toISOString(),
        },
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      dispatch({ type: 'CORE_LOAD_ERROR', error: `Failed to load dashboard data: ${message}` });
    }

    dispatch({ type: 'ANALYTICS_LOAD_START' });
    try {
      const analytics = await apiPost<{
        general_stats_overview: GeneralStatsOverviewData;
        open_premiums: OpenPremiumStats;
        past_premiums: PastPremiumTimeframeStats[];
        premium_lifetimes: PremiumLifetimeModes;
        past_order_stats_all: PastOrderStats;
        past_order_stats: PastOrderStats;
        past_order_stats_all_net_capped: PastOrderStats;
        past_order_stats_net_capped: PastOrderStats;
        past_profitable_orders_all: PastProfitableOrder[];
        past_profitable_orders: PastProfitableOrder[];
        past_profitable_orders_all_net_capped: PastProfitableOrder[];
        past_profitable_orders_net_capped: PastProfitableOrder[];
      }>('/api/dashboard/analytics', {
        hours: Number(hours),
        cex,
        exclude_payment_methods: excludedPaymentMethods,
        exclude_cexes: excludedCEXes,
        fee_tier: feeTier,
        coupled_hedge: coupledHedge,
        max_fiat_limit: maxFiatLimit ?? 0,
        fiat: 'EUR',
      });
      const generalStats = buildGeneralStatsData(
        analytics.general_stats_overview,
        analytics.open_premiums,
        analytics.past_premiums,
        analytics.premium_lifetimes,
      );
      dispatch({
        type: 'ANALYTICS_LOAD_SUCCESS',
        payload: {
          pastOrderStatsAll: analytics.past_order_stats_all,
          pastOrderStats: excludedQuery ? analytics.past_order_stats : analytics.past_order_stats_all,
          pastOrderStatsAllNetCapped: analytics.past_order_stats_all_net_capped,
          pastOrderStatsNetCapped: excludedQuery ? analytics.past_order_stats_net_capped : analytics.past_order_stats_all_net_capped,
          pastProfitableOrdersAll: analytics.past_profitable_orders_all,
          pastProfitableOrders: excludedQuery ? analytics.past_profitable_orders : analytics.past_profitable_orders_all,
          pastProfitableOrdersAllNetCapped: analytics.past_profitable_orders_all_net_capped,
          pastProfitableOrdersNetCapped: excludedQuery ? analytics.past_profitable_orders_net_capped : analytics.past_profitable_orders_all_net_capped,
          generalStats,
        },
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      dispatch({ type: 'ANALYTICS_LOAD_ERROR', error: `Failed to load analytics: ${message}` });
    }
  }, []);

  const extendOhlc = useCallback(async (hours: number, cex: string = 'kraken', intervalMin: number = 1) => {
    try {
      const ohlc = await apiFetch<OHLCData>(`/api/ohlc?hours=${hours}&cex=${cex}&interval_min=${intervalMin}`);
      dispatch({ type: 'EXTEND_OHLC_SUCCESS', ohlcData: ohlc });
    } catch {
      // Fail silently — the existing candles remain intact
    }
  }, []);

  return {
    ...state,
    error: state.error ?? state.analyticsError,
    load,
    extendOhlc,
  };
}
