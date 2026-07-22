import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import type { Offer } from '../types';

const POLL_INTERVAL_MS = 15_000;
const RECONNECT_DELAY_MS = 5_000;

function buildTradeCostQuery(excludedCEXes: string[], feeTier: string, coupledHedge: boolean, maxFiatLimit: number | null): string {
  let q = '';
  if (excludedCEXes.length > 0) q += `&exclude_cexes=${encodeURIComponent(excludedCEXes.join(','))}`;
  if (feeTier) q += `&fee_tier=${encodeURIComponent(feeTier)}`;
  if (!coupledHedge) q += '&coupled_hedge=false';
  if (maxFiatLimit != null && maxFiatLimit > 0) q += `&max_fiat_limit=${maxFiatLimit}`;
  return q;
}

export function useLiveOffers() {
  const [liveOffers, setLiveOffers] = useState<Offer[]>([]);
  const [wssConnected, setWssConnected] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);

  const wsRef       = useRef<WebSocket | null>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef  = useRef(true);
  const everOpenRef = useRef(false);
  const sessionRef  = useRef(0);
  const connectRef = useRef<(session: number) => void>(() => {});
  const cexRef      = useRef('kraken');
  const fiatRef     = useRef('EUR');
  const excludedCEXesRef = useRef<string[]>([]);
  const feeTierRef = useRef('');
  const coupledHedgeRef = useRef(true);
  const maxFiatLimitRef = useRef<number | null>(null);
  const lastRefreshKeyRef = useRef('');

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const buildQueryString = useCallback(() => {
    return `cex=${cexRef.current}&fiat=${encodeURIComponent(fiatRef.current)}${buildTradeCostQuery(excludedCEXesRef.current, feeTierRef.current, coupledHedgeRef.current, maxFiatLimitRef.current)}`;
  }, []);

  const startPolling = useCallback((session: number) => {
    if (pollRef.current) return;
    setWssConnected(false);
    const poll = async () => {
      if (sessionRef.current !== session || !mountedRef.current) return;
      try {
        const offers = await apiFetch<Offer[]>(`/api/live_offers?${buildQueryString()}`);
        if (sessionRef.current === session && mountedRef.current) {
          setLiveOffers(offers);
          setPollError(null);
        }
      } catch (e) {
        console.error('[LiveOffers] poll error', e);
        if (sessionRef.current === session && mountedRef.current) {
          setPollError(e instanceof Error ? e.message : String(e));
        }
      }
    };
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [buildQueryString]);

  const connect = useCallback((session: number) => {
    if (!mountedRef.current || sessionRef.current !== session) return;

    everOpenRef.current = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live_offers?${buildQueryString()}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (sessionRef.current !== session) { ws.close(); return; }
      everOpenRef.current = true;
      stopPolling();
      if (mountedRef.current) {
        setWssConnected(true);
        setPollError(null);
      }
    };

    ws.onmessage = (e) => {
      if (sessionRef.current !== session) return;
      try {
        const offers = JSON.parse(e.data) as Offer[];
        if (mountedRef.current) setLiveOffers(offers);
      } catch (err) {
        console.error('[LiveOffers] parse error', err);
      }
    };

    ws.onerror = () => {
      if (sessionRef.current !== session || everOpenRef.current) return;
      if (mountedRef.current) startPolling(session);
    };

    ws.onclose = () => {
      if (sessionRef.current !== session || !mountedRef.current) return;
      setWssConnected(false);
      if (everOpenRef.current) {
        setTimeout(() => connectRef.current(session), RECONNECT_DELAY_MS);
      } else {
        startPolling(session);
      }
    };
  }, [buildQueryString, startPolling, stopPolling]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      wsRef.current?.close();
      stopPolling();
    };
  }, [stopPolling]);

  // Called by MonitorView when filters.cex or trade cost settings change.
  // Reconnects WS so the server pushes a fresh snapshot with updated query params.
  const refreshForCex = useCallback((cex: string, excludedCEXes: string[] = [], feeTier: string = '', coupledHedge = true, maxFiatLimit: number | null = null, fiat: string = 'EUR') => {
    // refreshForCex is only ever called from MonitorView's mount effect, so the tree is
    // mounted. Under React StrictMode the parent (AppShell) mount effect that resets
    // mountedRef to true runs AFTER this child effect, so without this connect() would see
    // a stale mountedRef === false (left over from the strict unmount cleanup) and bail —
    // leaving no WebSocket and no polling. Assert mounted here so connect() proceeds.
    mountedRef.current = true;
    const refreshKey = JSON.stringify({ cex, excludedCEXes, feeTier, coupledHedge, maxFiatLimit, fiat });
    if (
      refreshKey === lastRefreshKeyRef.current
      && wsRef.current?.readyState === WebSocket.OPEN
    ) {
      return;
    }
    lastRefreshKeyRef.current = refreshKey;

    cexRef.current = cex;
    fiatRef.current = fiat;
    excludedCEXesRef.current = excludedCEXes;
    feeTierRef.current = feeTier;
    coupledHedgeRef.current = coupledHedge;
    maxFiatLimitRef.current = maxFiatLimit;
    const session = ++sessionRef.current;
    stopPolling();
    wsRef.current?.close();

    setWssConnected(false);
    connect(session);
  }, [connect, stopPolling]);

  return { liveOffers, wssConnected, pollError, refreshForCex };
}
