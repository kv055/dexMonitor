import { useState, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import type { Offer, Stats, OHLCData, PastOrderStats, GeneralStatsData, PastProfitableOrder, TakerOpportunityMode } from '../types';

function excludedPaymentQuery(excludedPaymentMethods: string[]): string {
  if (excludedPaymentMethods.length === 0) return '';
  return `&exclude_payment_methods=${encodeURIComponent(excludedPaymentMethods.join(','))}`;
}

function tradeCostQuery(excludedCEXes: string[], feeTier: string, maxFiatLimit: number | null = null): string {
  let q = '';
  if (excludedCEXes.length > 0) q += `&exclude_cexes=${encodeURIComponent(excludedCEXes.join(','))}`;
  if (feeTier) q += `&fee_tier=${encodeURIComponent(feeTier)}`;
  if (maxFiatLimit != null && maxFiatLimit > 0) q += `&max_fiat_limit=${maxFiatLimit}`;
  return q;
}

export function useDashboard() {
  const [pastOffers, setPastOffers] = useState<Offer[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [pastOrderStats, setPastOrderStats] = useState<PastOrderStats | null>(null);
  const [pastOrderStatsAll, setPastOrderStatsAll] = useState<PastOrderStats | null>(null);
  const [pastOrderStatsNetCapped, setPastOrderStatsNetCapped] = useState<PastOrderStats | null>(null);
  const [pastOrderStatsAllNetCapped, setPastOrderStatsAllNetCapped] = useState<PastOrderStats | null>(null);
  const [pastProfitableOrders, setPastProfitableOrders] = useState<PastProfitableOrder[]>([]);
  const [pastProfitableOrdersAll, setPastProfitableOrdersAll] = useState<PastProfitableOrder[]>([]);
  const [pastProfitableOrdersNetCapped, setPastProfitableOrdersNetCapped] = useState<PastProfitableOrder[]>([]);
  const [pastProfitableOrdersAllNetCapped, setPastProfitableOrdersAllNetCapped] = useState<PastProfitableOrder[]>([]);
  const [generalStats, setGeneralStats] = useState<GeneralStatsData | null>(null);
  const [ohlcData, setOhlcData] = useState<OHLCData | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (hours: string, cex: string = 'kraken', excludedPaymentMethods: string[] = [], excludedCEXes: string[] = [], feeTier: string = '', coupledHedge = true, maxFiatLimit: number | null = null) => {
    setLoading(true);
    setError(null);
    try {
      const excludedQuery = excludedPaymentQuery(excludedPaymentMethods);
      const tcQuery = `${tradeCostQuery(excludedCEXes, feeTier, maxFiatLimit)}${!coupledHedge ? '&coupled_hedge=false' : ''}`;
      const takerQuery = (path: string, mode: TakerOpportunityMode, filtered: boolean) =>
        `${path}?fiat=EUR&premium_mode=${mode}${filtered ? excludedQuery : ''}${tcQuery}`;
      const [s, o, ohlc, posAll, posFiltered, posAllNetCapped, posFilteredNetCapped, profitableAll, profitableFiltered, profitableAllNetCapped, profitableFilteredNetCapped, gs] = await Promise.all([
        apiFetch<Stats>(`/api/stats?hours=${hours}`),
        apiFetch<Offer[]>(`/api/past_offers?hours=${hours}&limit=1000&cex=${cex}${excludedQuery}${tcQuery}`),
        apiFetch<OHLCData>(`/api/ohlc?hours=${hours}&cex=${cex}`),
        apiFetch<PastOrderStats>(takerQuery('/api/past_order_stats', 'net_full', false)),
        excludedQuery ? apiFetch<PastOrderStats>(takerQuery('/api/past_order_stats', 'net_full', true)) : Promise.resolve(null),
        apiFetch<PastOrderStats>(takerQuery('/api/past_order_stats', 'net_capped', false)),
        excludedQuery ? apiFetch<PastOrderStats>(takerQuery('/api/past_order_stats', 'net_capped', true)) : Promise.resolve(null),
        apiFetch<PastProfitableOrder[]>(takerQuery('/api/past_profitable_orders', 'net_full', false)),
        excludedQuery ? apiFetch<PastProfitableOrder[]>(takerQuery('/api/past_profitable_orders', 'net_full', true)) : Promise.resolve(null),
        apiFetch<PastProfitableOrder[]>(takerQuery('/api/past_profitable_orders', 'net_capped', false)),
        excludedQuery ? apiFetch<PastProfitableOrder[]>(takerQuery('/api/past_profitable_orders', 'net_capped', true)) : Promise.resolve(null),
        apiFetch<GeneralStatsData>(`/api/general_stats?hours=${hours}&cex=${cex}${excludedQuery}${tcQuery}`),
      ]);
      setStats(s);
      setPastOffers(o);
      setOhlcData(ohlc);
      setPastOrderStatsAll(posAll);
      setPastOrderStats(posFiltered ?? posAll);
      setPastOrderStatsAllNetCapped(posAllNetCapped);
      setPastOrderStatsNetCapped(posFilteredNetCapped ?? posAllNetCapped);
      setPastProfitableOrdersAll(profitableAll);
      setPastProfitableOrders(profitableFiltered ?? profitableAll);
      setPastProfitableOrdersAllNetCapped(profitableAllNetCapped);
      setPastProfitableOrdersNetCapped(profitableFilteredNetCapped ?? profitableAllNetCapped);
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

  return {
    pastOffers,
    stats,
    pastOrderStats,
    pastOrderStatsAll,
    pastOrderStatsNetCapped,
    pastOrderStatsAllNetCapped,
    pastProfitableOrders,
    pastProfitableOrdersAll,
    pastProfitableOrdersNetCapped,
    pastProfitableOrdersAllNetCapped,
    generalStats,
    ohlcData,
    lastUpdatedAt,
    error,
    loading,
    load,
    extendOhlc,
  };
}
