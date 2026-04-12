import { useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import type { Offer, Stats, OHLCData, PastOrderStats, GeneralStatsData } from '../types';

function excludedPaymentQuery(excludedPaymentMethods: string[]): string {
  if (excludedPaymentMethods.length === 0) return '';
  return `&exclude_payment_methods=${encodeURIComponent(excludedPaymentMethods.join(','))}`;
}

function tradeCostQuery(excludedCEXes: string[], feeTier: string): string {
  let q = '';
  if (excludedCEXes.length > 0) q += `&exclude_cexes=${encodeURIComponent(excludedCEXes.join(','))}`;
  if (feeTier) q += `&fee_tier=${encodeURIComponent(feeTier)}`;
  return q;
}

export function useDashboard() {
  const [pastOffers, setPastOffers] = useState<Offer[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [pastOrderStats, setPastOrderStats] = useState<PastOrderStats | null>(null);
  const [generalStats, setGeneralStats] = useState<GeneralStatsData | null>(null);
  const [ohlcData, setOhlcData] = useState<OHLCData | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (hours: string, cex: string = 'kraken', excludedPaymentMethods: string[] = [], excludedCEXes: string[] = [], feeTier: string = '') => {
    setLoading(true);
    setError(null);
    try {
      const excludedQuery = excludedPaymentQuery(excludedPaymentMethods);
      const tcQuery = tradeCostQuery(excludedCEXes, feeTier);
      const [s, o, ohlc, pos, gs] = await Promise.all([
        apiFetch<Stats>(`/api/stats?hours=${hours}`),
        apiFetch<Offer[]>(`/api/past_offers?hours=${hours}&limit=1000&cex=${cex}${excludedQuery}${tcQuery}`),
        apiFetch<OHLCData>(`/api/ohlc?hours=${hours}&cex=${cex}`),
        apiFetch<PastOrderStats>(`/api/past_order_stats?fiat=EUR${excludedQuery}`),
        apiFetch<GeneralStatsData>(`/api/general_stats?hours=${hours}${excludedQuery}`),
      ]);
      setStats(s);
      setPastOffers(o);
      setOhlcData(ohlc);
      setPastOrderStats(pos);
      setGeneralStats(gs);
      setLastUpdatedAt(new Date().toISOString());
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Failed to load data: ${message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Silently extend the OHLC window without touching other data or the global loading state.
  const extendOhlc = useCallback(async (hours: number, cex: string = 'kraken') => {
    try {
      const ohlc = await apiFetch<OHLCData>(`/api/ohlc?hours=${hours}&cex=${cex}`);
      setOhlcData(ohlc);
    } catch {
      // Fail silently — the existing candles remain intact
    }
  }, []);

  return { pastOffers, stats, pastOrderStats, generalStats, ohlcData, lastUpdatedAt, error, loading, load, extendOhlc };
}
