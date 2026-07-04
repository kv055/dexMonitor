import { useCallback, useEffect, useReducer, useRef } from 'react';
import { apiPost } from '../utils/api';
import type { StatisticsResponse } from '../types';

export interface StatisticsLoadParams {
  hours: string;
  cex: string;
  excludedPaymentMethods: string[];
  excludedCEXes: string[];
  feeTier: string;
  coupledHedge: boolean;
  maxFiatLimit: number | null;
}

interface StatisticsState {
  data: StatisticsResponse | null;
  loading: boolean;
  error: string | null;
}

type StatisticsAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; data: StatisticsResponse }
  | { type: 'LOAD_ERROR'; error: string };

const initialState: StatisticsState = {
  data: null,
  loading: false,
  error: null,
};

function reducer(state: StatisticsState, action: StatisticsAction): StatisticsState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: state.data == null, error: null };
    case 'LOAD_SUCCESS':
      return { ...state, data: action.data, loading: false, error: null };
    case 'LOAD_ERROR':
      return { ...state, loading: false, error: action.error };
  }
}

function paramsKey(p: StatisticsLoadParams): string {
  return JSON.stringify(p);
}

function buildBody(p: StatisticsLoadParams) {
  return {
    hours: Number(p.hours),
    cex: p.cex,
    exclude_payment_methods: p.excludedPaymentMethods,
    exclude_cexes: p.excludedCEXes,
    fee_tier: p.feeTier,
    coupled_hedge: p.coupledHedge,
    max_fiat_limit: p.maxFiatLimit ?? 0,
    fiat: 'EUR',
  };
}

export function useStatistics() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const inFlightRef = useRef<{ key: string; controller: AbortController; promise: Promise<void> } | null>(null);

  const load = useCallback(async (params: StatisticsLoadParams) => {
    const key = paramsKey(params);
    const inFlight = inFlightRef.current;
    if (inFlight?.key === key) {
      return inFlight.promise;
    }
    inFlight?.controller.abort();

    const controller = new AbortController();
    const { signal } = controller;
    dispatch({ type: 'LOAD_START' });

    const promise = (async () => {
      try {
        const data = await apiPost<StatisticsResponse>('/api/statistics', buildBody(params), { signal });
        if (signal.aborted) return;
        dispatch({ type: 'LOAD_SUCCESS', data });
      } catch (e: unknown) {
        if (signal.aborted) return;
        const message = e instanceof Error ? e.message : String(e);
        dispatch({ type: 'LOAD_ERROR', error: `Failed to load statistics: ${message}` });
      } finally {
        if (inFlightRef.current?.key === key) {
          inFlightRef.current = null;
        }
      }
    })();

    inFlightRef.current = { key, controller, promise };
    return promise;
  }, []);

  // Cancel any in-flight request on unmount so a late response can't dispatch
  // into an unmounted reducer.
  useEffect(() => () => inFlightRef.current?.controller.abort(), []);

  return { ...state, load };
}
