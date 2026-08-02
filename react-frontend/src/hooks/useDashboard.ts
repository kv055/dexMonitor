import { useCallback, useEffect, useReducer, useRef, startTransition } from 'react';
import { apiFetch, apiPost } from '../api/client';
import {
  buildAnalyticsBody,
  buildPastOffersSearch,
  marketRequestKey,
  type MarketRequestParams,
} from '../shared/marketParams';
import type {
  Offer,
  OHLCData,
  PastOrderStats,
  PastProfitableOrder,
  PastProfitableOrderCompact,
} from '../types';

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

interface DashboardState {
  pastOffers: Offer[];
  pastOrderStats: PastOrderStats | null;
  pastOrderStatsAll: PastOrderStats | null;
  pastOrderStatsNetCapped: PastOrderStats | null;
  pastOrderStatsAllNetCapped: PastOrderStats | null;
  pastOrderStatsNetMin: PastOrderStats | null;
  pastOrderStatsAllNetMin: PastOrderStats | null;
  fastPastProfitableOrders: PastProfitableOrderCompact[];
  detailedPastProfitableOrders: PastProfitableOrder[];
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

type CorePayload = Pick<DashboardState, 'pastOffers' | 'ohlcData' | 'lastUpdatedAt'>;
type AnalyticsOverviewPayload = Pick<DashboardState,
  | 'pastOrderStats'
  | 'pastOrderStatsAll'
  | 'pastOrderStatsNetCapped'
  | 'pastOrderStatsAllNetCapped'
  | 'pastOrderStatsNetMin'
  | 'pastOrderStatsAllNetMin'
>;

type DashboardAction =
  | { type: 'CORE_LOAD_START' }
  | { type: 'CORE_LOAD_SUCCESS'; payload: CorePayload }
  | { type: 'CORE_LOAD_ERROR'; error: string }
  | { type: 'ANALYTICS_LOAD_START' }
  | { type: 'ANALYTICS_OVERVIEW_SUCCESS'; payload: AnalyticsOverviewPayload }
  | { type: 'ANALYTICS_ORDERS_SUCCESS'; fastPastProfitableOrders: PastProfitableOrderCompact[] }
  | { type: 'ANALYTICS_CAPPED_SUCCESS'; payload: Pick<DashboardState, 'pastOrderStatsNetCapped' | 'pastOrderStatsAllNetCapped' | 'pastOrderStatsNetMin' | 'pastOrderStatsAllNetMin' | 'detailedPastProfitableOrders'> }
  | { type: 'ANALYTICS_LOAD_ERROR'; error: string }
  | { type: 'EXTEND_OHLC_SUCCESS'; ohlcData: OHLCData };

const initialDashboardState: DashboardState = {
  pastOffers: [],
  pastOrderStats: null,
  pastOrderStatsAll: null,
  pastOrderStatsNetCapped: null,
  pastOrderStatsAllNetCapped: null,
  pastOrderStatsNetMin: null,
  pastOrderStatsAllNetMin: null,
  fastPastProfitableOrders: [],
  detailedPastProfitableOrders: [],
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
  return state.ohlcData !== null || state.pastOffers.length > 0;
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

  const loadCore = useCallback(async (params: MarketRequestParams) => {
    const key = marketRequestKey(params);

    const inFlight = coreLoadRef.current;
    if (inFlight?.key === key && !inFlight.controller.signal.aborted) {
      return inFlight.promise;
    }

    inFlight?.controller.abort();

    const controller = new AbortController();
    const { signal } = controller;
    dispatch({ type: 'CORE_LOAD_START' });

    const promise = (async () => {
      try {
        const [offers, ohlc] = await Promise.all([
          apiFetch<Offer[]>(`/api/past_offers?${buildPastOffersSearch(params)}`, { signal }),
		  apiFetch<OHLCData>(`/api/ohlc?${new URLSearchParams({ hours: params.hours, cex: params.cex, fiat: params.fiat })}`, { signal }),
        ]);
        if (signal.aborted) return;
        dispatch({
          type: 'CORE_LOAD_SUCCESS',
          payload: {
            pastOffers: offers,
            ohlcData: ohlc,
            lastUpdatedAt: new Date().toISOString(),
          },
        });
      } catch (e: unknown) {
        if (signal.aborted) return;
        controller.abort();
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

  const loadAnalytics = useCallback(async (params: MarketRequestParams) => {
    const key = marketRequestKey(params);

    const inFlight = analyticsLoadRef.current;
    if (inFlight?.key === key && !inFlight.controller.signal.aborted) {
      return inFlight.promise;
    }

    // Abort the superseded request — otherwise a slow response for the old
    // filter set can land after this one and overwrite newer state.
    inFlight?.controller.abort();

    const controller = new AbortController();
    const { signal } = controller;
    dispatch({ type: 'ANALYTICS_LOAD_START' });

    const hasPaymentExclusions = params.excludedPaymentMethods.length > 0;
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
              pastOrderStats: hasPaymentExclusions && res.past_order_stats
                ? res.past_order_stats
                : res.past_order_stats_all ?? null,
              pastOrderStatsAllNetCapped: null,
              pastOrderStatsNetCapped: null,
              pastOrderStatsAllNetMin: null,
              pastOrderStatsNetMin: null,
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
                pastOrderStatsNetCapped: hasPaymentExclusions && res.past_order_stats_net_capped
                  ? res.past_order_stats_net_capped
                  : res.past_order_stats_all_net_capped ?? null,
                pastOrderStatsAllNetMin: res.past_order_stats_all_net_min ?? null,
                pastOrderStatsNetMin: hasPaymentExclusions && res.past_order_stats_net_min
                  ? res.past_order_stats_net_min
                  : res.past_order_stats_all_net_min ?? null,
                detailedPastProfitableOrders: res.past_profitable_orders ?? [],
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
        controller.abort();
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

  useEffect(() => () => {
    coreLoadRef.current?.controller.abort();
    analyticsLoadRef.current?.controller.abort();
  }, []);

  return {
    ...state,
    loadCore,
    loadAnalytics,
    extendOhlc,
  };
}
