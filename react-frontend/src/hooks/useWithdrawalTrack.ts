import { useState, useEffect, useRef } from 'react';
import type { WithdrawalTrackResult } from '../types';
import { cexWithdrawalTrack } from '../utils/api';

const POLL_INTERVAL_MS = 5_000;

const TERMINAL_CEX_STATUSES = new Set(['cancelled', 'rejected', 'failed']);

function isTrackingComplete(track: WithdrawalTrackResult): boolean {
  if (TERMINAL_CEX_STATUSES.has(track.cex_status)) {
    return true;
  }
  if (track.mempool?.confirmed && (track.mempool.confirmations ?? 0) >= 1) {
    return true;
  }
  return false;
}

// useWithdrawalTrack polls CEX withdrawal status (and mempool data when a tx hash
// is available) while the Wallet tab is active and a withdrawal id is known.
export function useWithdrawalTrack(
  active: boolean,
  provider: string | null | undefined,
  withdrawalId: string | null | undefined,
  clientRequestId?: string | null,
): {
  track: WithdrawalTrackResult | null;
  loading: boolean;
  error: string | null;
} {
  const [track, setTrack] = useState<WithdrawalTrackResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    if (!active || !provider || !withdrawalId) {
      setTrack(null);
      setLoading(false);
      setError(null);
      return;
    }

    let stopped = false;

    const poll = async () => {
      if (!mountedRef.current || stopped) return;
      setLoading(true);
      try {
        const result = await cexWithdrawalTrack(provider, withdrawalId, clientRequestId ?? undefined);
        if (!mountedRef.current || stopped) return;
        setTrack(result);
        setError(null);
        if (isTrackingComplete(result)) {
          stopped = true;
          setLoading(false);
          return;
        }
      } catch (err) {
        if (!mountedRef.current || stopped) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!mountedRef.current || stopped) return;
        setLoading(false);
        if (!stopped) {
          timerRef.current = setTimeout(() => void poll(), POLL_INTERVAL_MS);
        }
      }
    };

    void poll();

    return () => {
      mountedRef.current = false;
      stopped = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, provider, withdrawalId, clientRequestId]);

  return { track, loading, error };
}
