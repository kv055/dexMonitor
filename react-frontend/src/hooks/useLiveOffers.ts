import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import type { Offer } from '../types';

const POLL_INTERVAL_MS = 15_000;
const RECONNECT_DELAY_MS = 5_000;

export function useLiveOffers() {
  const [liveOffers, setLiveOffers] = useState<Offer[]>([]);
  const [wssConnected, setWssConnected] = useState(false);

  const wsRef       = useRef<WebSocket | null>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef  = useRef(true);
  // tracks whether the current WS socket ever reached onopen
  const everOpenRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    if (pollRef.current) return; // already polling
    setWssConnected(false);
    const poll = async () => {
      try {
        const offers = await apiFetch<Offer[]>('/api/live_offers');
        if (mountedRef.current) setLiveOffers(offers);
      } catch (e) {
        console.error('[LiveOffers] poll error', e);
      }
    };
    poll(); // immediate first fetch
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [stopPolling]);

  // connect is stable — defined once, called on mount and on reconnect
  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    everOpenRef.current = false;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/live_offers`);
    wsRef.current = ws;

    ws.onopen = () => {
      everOpenRef.current = true;
      stopPolling();
      if (mountedRef.current) setWssConnected(true);
    };

    ws.onmessage = (e) => {
      try {
        const offers = JSON.parse(e.data) as Offer[];
        if (mountedRef.current) setLiveOffers(offers);
      } catch (err) {
        console.error('[LiveOffers] parse error', err);
      }
    };

    ws.onerror = () => {
      // Only fall back to polling if we never successfully opened
      if (!everOpenRef.current && mountedRef.current) {
        startPolling();
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      setWssConnected(false);
      if (everOpenRef.current) {
        // Was connected — try to reconnect via WSS
        setTimeout(connect, RECONNECT_DELAY_MS);
      } else {
        // Never connected — stay on polling
        startPolling();
      }
    };
  }, [startPolling, stopPolling]);

  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      wsRef.current?.close();
      stopPolling();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { liveOffers, wssConnected };
}
