import { useState, useEffect, useRef, useMemo } from 'react';
import type { HedgePositionUpdate } from '../types';

const RECONNECT_DELAY_MS = 5_000;

// useHedgeStream subscribes to the live, normalized hedge-position WebSocket for a
// venue, relayed through dexMonitor from mm-controller. It reconnects on close with a
// fixed delay and only connects while a venue is known. Returns the latest position
// snapshot (or null) and the live socket-connected flag. Note: `position.connected`
// reflects the upstream exchange feed health, which is distinct from `connected`
// (this browser↔server socket).
export function useHedgeStream(venue: string | null | undefined): {
  position: HedgePositionUpdate | null;
  connected: boolean;
} {
  const [position, setPosition] = useState<HedgePositionUpdate | null>(null);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const mountedRef = useRef(true);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    if (!venue) {
      return;
    }

    const connect = () => {
      if (!mountedRef.current) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws/cex/hedge-stream?venue=${encodeURIComponent(venue)}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        if (mountedRef.current) setConnected(true);
      };

      ws.onmessage = (e) => {
        try {
          const update = JSON.parse(e.data) as HedgePositionUpdate;
          if (mountedRef.current) setPosition(update);
        } catch (err) {
          console.error('[HedgeStream] parse error', err);
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        setConnected(false);
        reconnectRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      wsRef.current?.close();
    };
  }, [venue]);

  return useMemo(() => {
    if (!venue) return { position: null, connected: false };
    return { position, connected };
  }, [venue, position, connected]);
}
