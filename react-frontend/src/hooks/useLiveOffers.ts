import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import type { Offer } from '../types';

const POLL_INTERVAL_MS = 15_000;
const RECONNECT_DELAY_MS = 5_000;

function buildTradeCostQuery(excludedCEXes: string[], feeTier: string, coupledHedge: boolean): string {
  let q = '';
  if (excludedCEXes.length > 0) q += `&exclude_cexes=${encodeURIComponent(excludedCEXes.join(','))}`;
  if (feeTier) q += `&fee_tier=${encodeURIComponent(feeTier)}`;
  if (!coupledHedge) q += '&coupled_hedge=false';
  return q;
}

export function useLiveOffers() {
  const [liveOffers, setLiveOffers] = useState<Offer[]>([]);
  const [wssConnected, setWssConnected] = useState(false);

  const wsRef       = useRef<WebSocket | null>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef  = useRef(true);
  const everOpenRef = useRef(false);
  const sessionRef  = useRef(0);
  const cexRef      = useRef('kraken');
  const excludedCEXesRef = useRef<string[]>([]);
  const feeTierRef = useRef('');
  const coupledHedgeRef = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const buildQueryString = useCallback(() => {
    return `cex=${cexRef.current}${buildTradeCostQuery(excludedCEXesRef.current, feeTierRef.current, coupledHedgeRef.current)}`;
  }, []);

  const startPolling = useCallback((session: number) => {
    if (pollRef.current) return;
    setWssConnected(false);
    const poll = async () => {
      if (sessionRef.current !== session || !mountedRef.current) return;
      try {
        const offers = await apiFetch<Offer[]>(`/api/live_offers?${buildQueryString()}`);
        if (sessionRef.current === session && mountedRef.current) setLiveOffers(offers);
      } catch (e) {
        console.error('[LiveOffers] poll error', e);
      }
    };
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [stopPolling, buildQueryString]);

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
      if (mountedRef.current) setWssConnected(true);
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
        setTimeout(() => connect(session), RECONNECT_DELAY_MS);
      } else {
        startPolling(session);
      }
    };
  }, [startPolling, stopPolling]);

  useEffect(() => {
    mountedRef.current = true;
    const session = ++sessionRef.current;
    connect(session);
    return () => {
      mountedRef.current = false;
      sessionRef.current++;
      wsRef.current?.close();
      stopPolling();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Called by MonitorView when filters.cex or trade cost settings change.
  // Immediately fetches fresh offers, then reconnects WS.
  const refreshForCex = useCallback((cex: string, excludedCEXes: string[] = [], feeTier: string = '', coupledHedge = true) => {
    cexRef.current = cex;
    excludedCEXesRef.current = excludedCEXes;
    feeTierRef.current = feeTier;
    coupledHedgeRef.current = coupledHedge;
    const session = ++sessionRef.current;
    stopPolling();
    wsRef.current?.close();

    apiFetch<Offer[]>(`/api/live_offers?${buildQueryString()}`)
      .then(offers => {
        if (sessionRef.current === session && mountedRef.current) setLiveOffers(offers);
      })
      .catch(e => console.error('[LiveOffers] cex-change fetch error', e));

    setWssConnected(false);
    connect(session);
  }, [connect, stopPolling, buildQueryString]);

  return { liveOffers, wssConnected, refreshForCex };
}
