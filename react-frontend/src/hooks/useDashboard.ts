import { useCallback, useReducer, useRef } from 'react';
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

type LoadParams = {
  hours: string;
  cex: string;
  excludedPaymentMethods: string[];
  excludedCEXes: string[];
  feeTier: string;
  coupledHedge: boolean;
  maxFiatLimit: number | null;
};

function buildLoadQueries(params: LoadParams) {
  const excludedQuery = excludedPaymentQuery(params.excludedPaymentMethods);
  const tcQuery = `${tradeCostQuery(params.excludedCEXes, params.feeTier, params.maxFiatLimit)}${!params.coupledHedge ? '&coupled_hedge=false' : ''}`;
  return { excludedQuery, tcQuery };
}

function loadCoreKey(params: LoadParams): string {
  return JSON.stringify(params);
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

type AnalyticsOverviewResponse = {
  general_stats_overview?: GeneralStatsOverviewData;
  open_premiums?: OpenPremiumStats;
  past_premiums?: PastPremiumTimeframeStats[];
  premium_lifetimes?: PremiumLifetimeModes;
  past_order_stats_all?: PastOrderStats;
  past_order_stats?: PastOrderStats;
  past_order_stats_all_net_capped?: PastOrderStats;
  past_order_stats_net_capped?: PastOrderStats;
};

type AnalyticsOrdersResponse = {
  past_profitable_orders?: PastProfitableOrder[];
};

function buildAnalyticsBody(params: LoadParams, sections?: string[]) {
  return {
    hours: Number(params.hours),
    cex: params.cex,
    exclude_payment_methods: params.excludedPaymentMethods,
    exclude_cexes: params.excludedCEXes,
    fee_tier: params.feeTier,
    coupled_hedge: params.coupledHedge,
    max_fiat_limit: params.maxFiatLimit ?? 0,
    fiat: 'EUR',
    ...(sections ? { sections } : {}),
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
type AnalyticsOverviewPayload = Pick<DashboardState,
  | 'pastOrderStats'
  | 'pastOrderStatsAll'
  | 'pastOrderStatsNetCapped'
  | 'pastOrderStatsAllNetCapped'
  | 'generalStats'
>;

type DashboardAction =
  | { type: 'CORE_LOAD_START' }
  | { type: 'CORE_LOAD_SUCCESS'; payload: CorePayload }
  | { type: 'CORE_LOAD_ERROR'; error: string }
  | { type: 'ANALYTICS_LOAD_START' }
  | { type: 'ANALYTICS_OVERVIEW_SUCCESS'; payload: AnalyticsOverviewPayload }
  | { type: 'ANALYTICS_ORDERS_SUCCESS'; pastProfitableOrders: PastProfitableOrder[] }
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
      return { ...state, loading: !hasCoreData(state), error: null };
    case 'CORE_LOAD_SUCCESS':
      return { ...state, ...action.payload, loading: false, error: null, initialLoadComplete: true };
    case 'CORE_LOAD_ERROR':
      return { ...state, loading: false, error: action.error };
    case 'ANALYTICS_LOAD_START':
      return { ...state, analyticsLoading: true, analyticsError: null };
    case 'ANALYTICS_OVERVIEW_SUCCESS':
      return { ...state, ...action.payload, analyticsError: null };
    case 'ANALYTICS_ORDERS_SUCCESS':
      return { ...state, pastProfitableOrders: action.pastProfitableOrders, analyticsLoading: false, analyticsError: null };
    case 'ANALYTICS_LOAD_ERROR':
      return { ...state, analyticsLoading: false, analyticsError: action.error };
    case 'EXTEND_OHLC_SUCCESS':
      return { ...state, ohlcData: action.ohlcData };
  }
}

export function useDashboard() {
  const [state, dispatch] = useReducer(dashboardReducer, initialDashboardState);
  const coreLoadRef = useRef<{
    key: string;
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);

  const loadCore = useCallback(async (hours: string, cex: string = 'kraken', excludedPaymentMethods: string[] = [], excludedCEXes: string[] = [], feeTier: string = '', coupledHedge = true, maxFiatLimit: number | null = null) => {
    const params: LoadParams = { hours, cex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit };
    const key = loadCoreKey(params);

    const inFlight = coreLoadRef.current;
    if (inFlight?.key === key) {
      return inFlight.promise;
    }

    inFlight?.controller.abort();

    const controller = new AbortController();
    const { signal } = controller;
    dispatch({ type: 'CORE_LOAD_START' });

    const { excludedQuery, tcQuery } = buildLoadQueries(params);
    const promise = (async () => {
      try {
        const [s, o, ohlc] = await Promise.all([
          apiFetch<Stats>(`/api/stats?hours=${hours}`, { signal }),
          apiFetch<Offer[]>(`/api/past_offers?hours=${hours}&limit=1000&compact=true&cex=${cex}${excludedQuery}${tcQuery}`, { signal }),
          apiFetch<OHLCData>(`/api/ohlc?hours=${hours}&cex=${cex}`, { signal }),
        ]);
        if (signal.aborted) return;
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
        if (signal.aborted) return;
        const message = e instanceof Error ? e.message : String(e);
        dispatch({ type: 'CORE_LOAD_ERROR', error: `Failed to load dashboard data: ${message}` });
      } finally {
        if (coreLoadRef.current?.key === key) {
          coreLoadRef.current = null;
        }
      }
    })();

    coreLoadRef.current = { key, controller, promise };
    return promise;
  }, []);

  const loadAnalytics = useCallback(async (hours: string, cex: string = 'kraken', excludedPaymentMethods: string[] = [], excludedCEXes: string[] = [], feeTier: string = '', coupledHedge = true, maxFiatLimit: number | null = null) => {
    dispatch({ type: 'ANALYTICS_LOAD_START' });

    const params: LoadParams = { hours, cex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit };
    const { excludedQuery } = buildLoadQueries(params);
    try {
      const overview = await apiPost<AnalyticsOverviewResponse>(
        '/api/dashboard/analytics',
        buildAnalyticsBody(params, ['overview', 'taker_stats']),
      );
      const generalStats = overview.general_stats_overview && overview.open_premiums && overview.past_premiums && overview.premium_lifetimes
        ? buildGeneralStatsData(
            overview.general_stats_overview,
            overview.open_premiums,
            overview.past_premiums,
            overview.premium_lifetimes,
          )
        : null;
      dispatch({
        type: 'ANALYTICS_OVERVIEW_SUCCESS',
        payload: {
          pastOrderStatsAll: overview.past_order_stats_all ?? null,
          pastOrderStats: excludedQuery && overview.past_order_stats
            ? overview.past_order_stats
            : overview.past_order_stats_all ?? null,
          pastOrderStatsAllNetCapped: overview.past_order_stats_all_net_capped ?? null,
          pastOrderStatsNetCapped: excludedQuery && overview.past_order_stats_net_capped
            ? overview.past_order_stats_net_capped
            : overview.past_order_stats_all_net_capped ?? null,
          generalStats,
        },
      });

      const ordersResponse = await apiPost<AnalyticsOrdersResponse>(
        '/api/dashboard/analytics',
        buildAnalyticsBody(params, ['taker_orders']),
      );
      dispatch({
        type: 'ANALYTICS_ORDERS_SUCCESS',
        pastProfitableOrders: ordersResponse.past_profitable_orders ?? [],
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      dispatch({ type: 'ANALYTICS_LOAD_ERROR', error: `Failed to load analytics: ${message}` });
    }
  }, []);

  const load = useCallback(async (hours: string, cex: string = 'kraken', excludedPaymentMethods: string[] = [], excludedCEXes: string[] = [], feeTier: string = '', coupledHedge = true, maxFiatLimit: number | null = null) => {
    await loadCore(hours, cex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit);
    await loadAnalytics(hours, cex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit);
  }, [loadCore, loadAnalytics]);

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
    load,
    loadCore,
    loadAnalytics,
    extendOhlc,
  };
}
