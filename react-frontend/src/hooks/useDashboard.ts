import { useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import type { Offer, Stats, OHLCData } from '../types';

export function useDashboard() {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [ohlcData, setOhlcData] = useState<OHLCData | null>(null);
  const [premiumOffers, setPremiumOffers] = useState<Offer[]>([]);
  const [lastUpdated, setLastUpdated] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (hours: string) => {
    setLoading(true);
    setError(null);
    try {
      const [s, o, ohlc, po] = await Promise.all([
        apiFetch<Stats>(`/api/stats?hours=${hours}`),
        apiFetch<Offer[]>(`/api/offers?limit=1000`),
        apiFetch<OHLCData>(`/api/ohlc?hours=${hours}`),
        apiFetch<Offer[]>(`/api/premium_offers?hours=${hours}&limit=1000`),
      ]);
      setStats(s);
      setOffers(o);
      setOhlcData(ohlc);
      setPremiumOffers(po);
      setLastUpdated(`Updated ${new Date().toLocaleTimeString()}`);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      setError(`Failed to load data: ${message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  return { offers, stats, ohlcData, premiumOffers, lastUpdated, error, loading, load };
}
