import { useCallback, useReducer, useRef, startTransition } from 'react';
import { apiFetch, apiPost } from '../utils/api';
import type {
  Offer,
  Stats,
  OHLCData,
  PastOrderStats,
  GeneralStatsData,
  PastProfitableOrder,
  PastProfitableOrderCompact,
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
  fiat: string;
};

function buildLoadQueries(params: LoadParams) {
  const excludedQuery = excludedPaymentQuery(params.excludedPaymentMethods);
  const tcQuery = `${tradeCostQuery(params.excludedCEXes, params.feeTier, params.maxFiatLimit)}${!params.coupledHedge ? '&coupled_hedge=false' : ''}`;
  return { excludedQuery, tcQuery };
}

function loadCoreKey(params: LoadParams): string {
  return JSON.stringify(params);
}

type AnalyticsOverviewResponse = {
  past_order_stats_all?: PastOrderStats;
  past_order_stats?: PastOrderStats;
  past_order_stats_all_net_capped?: PastOrderStats;
  past_order_stats_net_capped?: PastOrderStats;
  past_order_stats_all_net_min?: PastOrderStats;
  past_order_stats_net_min?: PastOrderStats;
};

type AnalyticsOrdersResponse = {
  past_profitable_orders?: PastProfitableOrder[];
  past_profitable_orders_compact?: PastProfitableOrderCompact[];
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
    fiat: params.fiat,
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
  pastOrderStatsNetMin: PastOrderStats | null;
  pastOrderStatsAllNetMin: PastOrderStats | null;
  fastPastProfitableOrders: PastProfitableOrderCompact[];
  detailedPastProfitableOrders: PastProfitableOrder[];
  pastProfitableOrders: PastProfitableOrder[];
  generalStats: GeneralStatsData | null;
  ohlcData: OHLCData | null;
  lastUpdatedAt: string;
  error: string | null;
  analyticsError: string | null;
  loading: boolean;
  analyticsOverviewLoading: boolean;
  analyticsOrdersLoading: boolean;
  analyticsCappedLoading: boolean;
  initialLoadComplete: boolean;
}

type CorePayload = Pick<DashboardState, 'stats' | 'pastOffers' | 'ohlcData' | 'lastUpdatedAt'>;
type AnalyticsOverviewPayload = Pick<DashboardState,
  | 'pastOrderStats'
  | 'pastOrderStatsAll'
  | 'pastOrderStatsNetCapped'
  | 'pastOrderStatsAllNetCapped'
  | 'pastOrderStatsNetMin'
  | 'pastOrderStatsAllNetMin'
  | 'generalStats'
>;

type DashboardAction =
  | { type: 'CORE_LOAD_START' }
  | { type: 'CORE_LOAD_SUCCESS'; payload: CorePayload }
  | { type: 'CORE_LOAD_ERROR'; error: string }
  | { type: 'ANALYTICS_LOAD_START' }
  | { type: 'ANALYTICS_OVERVIEW_SUCCESS'; payload: AnalyticsOverviewPayload }
  | { type: 'ANALYTICS_ORDERS_SUCCESS'; fastPastProfitableOrders: PastProfitableOrderCompact[] }
  | { type: 'ANALYTICS_CAPPED_SUCCESS'; payload: Pick<DashboardState, 'pastOrderStatsNetCapped' | 'pastOrderStatsAllNetCapped' | 'pastOrderStatsNetMin' | 'pastOrderStatsAllNetMin' | 'detailedPastProfitableOrders' | 'pastProfitableOrders'> }
  | { type: 'ANALYTICS_LOAD_ERROR'; error: string }
  | { type: 'EXTEND_OHLC_SUCCESS'; ohlcData: OHLCData };

const initialDashboardState: DashboardState = {
  pastOffers: [],
  stats: null,
  pastOrderStats: null,
  pastOrderStatsAll: null,
  pastOrderStatsNetCapped: null,
  pastOrderStatsAllNetCapped: null,
  pastOrderStatsNetMin: null,
  pastOrderStatsAllNetMin: null,
  fastPastProfitableOrders: [],
  detailedPastProfitableOrders: [],
  pastProfitableOrders: [],
  generalStats: null,
  ohlcData: null,
  lastUpdatedAt: '',
  error: null,
  analyticsError: null,
  loading: true,
  analyticsOverviewLoading: false,
  analyticsOrdersLoading: false,
  analyticsCappedLoading: false,
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
      return {
        ...state,
        analyticsOverviewLoading: true,
        analyticsOrdersLoading: true,
        analyticsCappedLoading: true,
        analyticsError: null,
        fastPastProfitableOrders: [],
        detailedPastProfitableOrders: [],
        pastProfitableOrders: [],
      };
    case 'ANALYTICS_OVERVIEW_SUCCESS':
      return {
        ...state,
        ...action.payload,
        analyticsOverviewLoading: false,
        analyticsError: null,
      };
    case 'ANALYTICS_ORDERS_SUCCESS':
      return {
        ...state,
        fastPastProfitableOrders: action.fastPastProfitableOrders,
        analyticsOrdersLoading: false,
        analyticsError: null,
      };
    case 'ANALYTICS_CAPPED_SUCCESS':
      return {
        ...state,
        ...action.payload,
        analyticsCappedLoading: false,
        analyticsError: null,
      };
    case 'ANALYTICS_LOAD_ERROR':
      return {
        ...state,
        analyticsOverviewLoading: false,
        analyticsOrdersLoading: false,
        analyticsCappedLoading: false,
        analyticsError: action.error,
      };
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
  const analyticsLoadRef = useRef<{
    key: string;
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);

  const loadCore = useCallback(async (hours: string, cex: string = 'kraken', excludedPaymentMethods: string[] = [], excludedCEXes: string[] = [], feeTier: string = '', coupledHedge = true, maxFiatLimit: number | null = null, fiat: string = 'EUR') => {
    const params: LoadParams = { hours, cex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit, fiat };
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
          apiFetch<Offer[]>(`/api/past_offers?hours=${hours}&limit=1000&compact=true&cex=${cex}&fiat=${encodeURIComponent(fiat)}${excludedQuery}${tcQuery}`, { signal }),
		  apiFetch<OHLCData>(`/api/ohlc?hours=${hours}&cex=${cex}&fiat=${encodeURIComponent(fiat)}`, { signal }),
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

  const loadAnalytics = useCallback(async (hours: string, cex: string = 'kraken', excludedPaymentMethods: string[] = [], excludedCEXes: string[] = [], feeTier: string = '', coupledHedge = true, maxFiatLimit: number | null = null, fiat: string = 'EUR') => {
    const params: LoadParams = { hours, cex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit, fiat };
    const key = loadCoreKey(params);

    const inFlight = analyticsLoadRef.current;
    if (inFlight?.key === key) {
      return inFlight.promise;
    }

    // Abort the superseded request — otherwise a slow response for the old
    // filter set can land after this one and overwrite newer state.
    inFlight?.controller.abort();

    const controller = new AbortController();
    const { signal } = controller;
    dispatch({ type: 'ANALYTICS_LOAD_START' });

    const { excludedQuery } = buildLoadQueries(params);
    const promise = (async () => {
      try {
        // Fire the fast/full requests together. Both stay on persisted offer-row
        // fields so the insights view can paint before capped calculations finish.
        let cappedArrived = false;
        const statsFull = apiPost<AnalyticsOverviewResponse>(
          '/api/dashboard/analytics',
          buildAnalyticsBody(params, ['taker_stats_full']),
          { signal },
        ).then((res) => {
          if (signal.aborted) return;
          console.debug('[analytics] fast stats arrived', { key, at: new Date().toISOString() });
          dispatch({
            type: 'ANALYTICS_OVERVIEW_SUCCESS',
            payload: {
              pastOrderStatsAll: res.past_order_stats_all ?? null,
              pastOrderStats: excludedQuery && res.past_order_stats
                ? res.past_order_stats
                : res.past_order_stats_all ?? null,
              pastOrderStatsAllNetCapped: null,
              pastOrderStatsNetCapped: null,
              pastOrderStatsAllNetMin: null,
              pastOrderStatsNetMin: null,
              generalStats: null,
            },
          });
        });

        const fastOrders = apiPost<AnalyticsOrdersResponse>(
          '/api/dashboard/analytics',
          buildAnalyticsBody(params, ['taker_orders_full']),
          { signal },
        ).then((res) => {
          if (signal.aborted || cappedArrived) return;
          console.debug('[analytics] fast orders arrived', { key, at: new Date().toISOString() });
          startTransition(() => {
            dispatch({
              type: 'ANALYTICS_ORDERS_SUCCESS',
              fastPastProfitableOrders: res.past_profitable_orders_compact ?? [],
            });
          });
        });

        const cappedAnalytics = apiPost<AnalyticsOverviewResponse & AnalyticsOrdersResponse>(
          '/api/dashboard/analytics',
          buildAnalyticsBody(params, ['taker_stats', 'taker_orders']),
          { signal },
        ).then((res) => {
          if (signal.aborted) return;
          cappedArrived = true;
          console.debug('[analytics] capped analytics arrived', { key, at: new Date().toISOString() });
          startTransition(() => {
            dispatch({
              type: 'ANALYTICS_CAPPED_SUCCESS',
              payload: {
                pastOrderStatsAllNetCapped: res.past_order_stats_all_net_capped ?? null,
                pastOrderStatsNetCapped: excludedQuery && res.past_order_stats_net_capped
                  ? res.past_order_stats_net_capped
                  : res.past_order_stats_all_net_capped ?? null,
                pastOrderStatsAllNetMin: res.past_order_stats_all_net_min ?? null,
                pastOrderStatsNetMin: excludedQuery && res.past_order_stats_net_min
                  ? res.past_order_stats_net_min
                  : res.past_order_stats_all_net_min ?? null,
                detailedPastProfitableOrders: res.past_profitable_orders ?? [],
                pastProfitableOrders: res.past_profitable_orders ?? [],
              },
            });
          });
        });

        await Promise.all([statsFull, fastOrders, cappedAnalytics]);
        if (!signal.aborted) {
          console.debug('[analytics] completed', { key, at: new Date().toISOString() });
        }
      } catch (e: unknown) {
        if (signal.aborted) return;
        const message = e instanceof Error ? e.message : String(e);
        dispatch({ type: 'ANALYTICS_LOAD_ERROR', error: `Failed to load analytics: ${message}` });
      } finally {
        if (analyticsLoadRef.current?.key === key) {
          analyticsLoadRef.current = null;
        }
      }
    })();

    analyticsLoadRef.current = { key, controller, promise };
    return promise;
  }, []);

  const load = useCallback(async (hours: string, cex: string = 'kraken', excludedPaymentMethods: string[] = [], excludedCEXes: string[] = [], feeTier: string = '', coupledHedge = true, maxFiatLimit: number | null = null, fiat: string = 'EUR') => {
    await loadCore(hours, cex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit, fiat);
    await loadAnalytics(hours, cex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit, fiat);
  }, [loadCore, loadAnalytics]);

  const extendOhlc = useCallback(async (hours: number, cex: string = 'kraken', intervalMin: number = 1, fiat: string = 'EUR') => {
    try {
	  const ohlc = await apiFetch<OHLCData>(`/api/ohlc?hours=${hours}&cex=${cex}&fiat=${encodeURIComponent(fiat)}&interval_min=${intervalMin}`);
      dispatch({ type: 'EXTEND_OHLC_SUCCESS', ohlcData: ohlc });
    } catch (e) {
      // No user-facing error — the existing candles remain intact — but keep
      // a trace so transient extend failures are debuggable.
      console.warn('[OHLC] extend failed', e);
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
