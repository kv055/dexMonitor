import { useCallback, useEffect, useReducer, useRef } from 'react';
import { apiPostWithHeaders } from '../api/client';
import { buildAnalyticsBody, marketRequestKey, type MarketRequestParams } from '../shared/marketParams';
import type { StatisticsResponse } from '../types';

interface StatisticsState {
  data: StatisticsResponse | null;
  loading: boolean;
  error: string | null;
  cacheState: 'hit' | 'stale' | 'miss' | null;
  builtAt: string | null;
}

interface StatisticsCacheEntry {
  data: StatisticsResponse;
  cacheState: 'hit' | 'stale' | 'miss' | null;
  builtAt: string | null;
}

type StatisticsAction =
  | { type: 'LOAD_START' }
  | { type: 'LOAD_SUCCESS'; data: StatisticsResponse; cacheState: 'hit' | 'stale' | 'miss' | null; builtAt: string | null }
  | { type: 'LOAD_ERROR'; error: string };

const initialState: StatisticsState = {
  data: null,
  loading: false,
  error: null,
  cacheState: null,
  builtAt: null,
};

const statisticsClientCache = new Map<string, StatisticsCacheEntry>();

function reducer(state: StatisticsState, action: StatisticsAction): StatisticsState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: state.data == null, error: null };
    case 'LOAD_SUCCESS':
      return {
        ...state,
        data: action.data,
        loading: false,
        error: null,
        cacheState: action.cacheState,
        builtAt: action.builtAt,
      };
    case 'LOAD_ERROR':
      return { ...state, loading: false, error: action.error };
  }
}

export function useStatistics() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const inFlightRef = useRef<{ key: string; controller: AbortController; promise: Promise<void> } | null>(null);

  const load = useCallback(async (params: MarketRequestParams) => {
    const key = marketRequestKey(params);
    const cached = statisticsClientCache.get(key);
    const inFlight = inFlightRef.current;
    // An aborted request never dispatches, so deduping onto it would leave the
    // spinner up forever (StrictMode's dev double-mount aborts + reloads
    // synchronously, before the aborted fetch has settled and cleared the ref).
    if (inFlight?.key === key && !inFlight.controller.signal.aborted) {
      return inFlight.promise;
    }
    inFlight?.controller.abort();

    const controller = new AbortController();
    const { signal } = controller;
    if (cached) {
      dispatch({
        type: 'LOAD_SUCCESS',
        data: cached.data,
        cacheState: cached.cacheState,
        builtAt: cached.builtAt,
      });
    } else {
      dispatch({ type: 'LOAD_START' });
    }

    const promise = (async () => {
      try {
        const { data, headers } = await apiPostWithHeaders<StatisticsResponse>('/api/statistics', buildAnalyticsBody(params), { signal });
        if (signal.aborted) return;
        const rawCacheState = headers.get('X-Stats-Cache');
        const cacheState =
          rawCacheState === 'hit' || rawCacheState === 'stale' || rawCacheState === 'miss'
            ? rawCacheState
            : null;
        const builtAt = headers.get('X-Stats-Built-At');
        statisticsClientCache.set(key, {
          data,
          cacheState,
          builtAt,
        });
        dispatch({
          type: 'LOAD_SUCCESS',
          data,
          cacheState,
          builtAt,
        });
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
