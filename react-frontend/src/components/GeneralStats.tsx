import { useMemo } from 'react';
import { useFilters } from '../context/FiltersContext';
import { LoadingSpinner } from './LoadingSpinner';

function normalizeTs(ts: string): string {
  return ts.replace(' ', 'T') + (ts.endsWith('Z') ? '' : 'Z');
}

function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtBtc(btc: number): string {
  if (btc >= 1) return btc.toFixed(2) + ' BTC';
  return (btc * 1000).toFixed(0) + 'k sat';
}

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  barFill?: number; // 0–1, renders a subtle fill bar if provided
  barColor?: string;
}

function KpiCard({ label, value, sub, valueColor = 'text-text', barFill, barColor = 'bg-green' }: KpiCardProps) {
  return (
    <div className="relative flex-1 bg-bg border border-border rounded-lg px-4 py-3 flex flex-col gap-1 overflow-hidden min-w-0">
      {/* subtle accent bar on the left edge */}
      <div className={`absolute left-0 top-3 bottom-3 w-0.5 rounded-full ${barFill != null ? barColor : 'bg-border'}`} />

      <span className="text-[0.58rem] uppercase tracking-widest text-muted font-semibold leading-none">{label}</span>
      <span className={`text-[1.5rem] font-bold leading-none tabular-nums ${valueColor}`}>{value}</span>
      {sub && <span className="text-[0.62rem] text-muted leading-none">{sub}</span>}

      {/* optional background fill strip */}
      {barFill != null && (
        <div
          className={`absolute bottom-0 left-0 h-0.5 opacity-30 ${barColor}`}
          style={{ width: `${Math.min(barFill * 100, 100)}%` }}
        />
      )}
    </div>
  );
}

export function GeneralStats() {
  const { offers, loading } = useFilters();

  const stats = useMemo(() => {
    const lastSeenMap: Record<string, string> = {};
    offers.forEach(o => {
      if (o.last_seen && (!lastSeenMap[o.exchange] || o.last_seen > lastSeenMap[o.exchange]))
        lastSeenMap[o.exchange] = o.last_seen;
    });

    const openOffers   = offers.filter(o => o.last_seen === lastSeenMap[o.exchange]);
    const closedOffers = offers.filter(o => o.last_seen !== lastSeenMap[o.exchange]);
    const openAsks     = openOffers.filter(o => o.direction === 'sell' && o.price_diff_percent != null);

    const bestAskPremium = openAsks.length
      ? Math.max(...openAsks.map(o => o.price_diff_percent!)) : null;
    const avgAskPremium = openAsks.length
      ? openAsks.reduce((s, o) => s + o.price_diff_percent!, 0) / openAsks.length : null;

    const availableBtc = openAsks.reduce((s, o) => s + (o.btc_max ?? 0), 0);
    const exchangesLive = new Set(openOffers.map(o => o.exchange)).size;
    const paymentMethods = new Set(openOffers.map(o => o.payment_method).filter(Boolean)).size;

    const durations = closedOffers
      .filter(o => o.first_seen && o.last_seen)
      .map(o => new Date(normalizeTs(o.last_seen!)).getTime() - new Date(normalizeTs(o.first_seen!)).getTime())
      .filter(d => d > 0);
    const avgLifetime = durations.length
      ? durations.reduce((s, d) => s + d, 0) / durations.length : null;

    return { totalOffers: offers.length, activeOffers: openOffers.length, exchangesLive, bestAskPremium, avgAskPremium, availableBtc, avgLifetime, paymentMethods };
  }, [offers]);

  const premiumColor = (v: number | null) =>
    v == null ? 'text-text' : v >= 3 ? 'text-green' : v >= 1 ? 'text-yellow' : 'text-red';
  const premiumBarColor = (v: number | null) =>
    v == null ? 'bg-border' : v >= 3 ? 'bg-green' : v >= 1 ? 'bg-yellow' : 'bg-red';

  if (loading && offers.length === 0) {
    return (
      <div className="relative h-20">
        <LoadingSpinner label="Loading statistics" />
      </div>
    );
  }

  return (
    <div className="flex gap-3 items-start">
      <KpiCard
        label="Active Offers"
        value={String(stats.activeOffers)}
        sub={`${stats.totalOffers} tracked in window`}
        barFill={stats.totalOffers > 0 ? stats.activeOffers / stats.totalOffers : 0}
        barColor="bg-blue"
      />
      <KpiCard
        label="Exchanges Live"
        value={String(stats.exchangesLive)}
        sub={`${stats.paymentMethods} payment methods`}
        barFill={stats.exchangesLive / 5}
        barColor="bg-purple"
      />
      <KpiCard
        label="Best Ask Premium"
        value={stats.bestAskPremium != null ? stats.bestAskPremium.toFixed(2) + '%' : '—'}
        sub="highest open ask"
        valueColor={premiumColor(stats.bestAskPremium)}
        barFill={stats.bestAskPremium != null ? Math.min(stats.bestAskPremium / 10, 1) : undefined}
        barColor={premiumBarColor(stats.bestAskPremium)}
      />
      <KpiCard
        label="Avg Ask Premium"
        value={stats.avgAskPremium != null ? stats.avgAskPremium.toFixed(2) + '%' : '—'}
        sub="across all open asks"
        valueColor={premiumColor(stats.avgAskPremium)}
        barFill={stats.avgAskPremium != null ? Math.min(stats.avgAskPremium / 10, 1) : undefined}
        barColor={premiumBarColor(stats.avgAskPremium)}
      />
      <KpiCard
        label="BTC Available"
        value={stats.availableBtc > 0 ? fmtBtc(stats.availableBtc) : '—'}
        sub="open ask max sizes"
        barFill={stats.availableBtc > 0 ? Math.min(stats.availableBtc / 2, 1) : undefined}
        barColor="bg-orange"
      />
      <KpiCard
        label="Avg Offer Lifetime"
        value={stats.avgLifetime != null ? fmtDuration(stats.avgLifetime) : '—'}
        sub="closed offers"
        barFill={stats.avgLifetime != null ? Math.min(stats.avgLifetime / (24 * 3_600_000), 1) : undefined}
        barColor="bg-muted"
      />
    </div>
  );
}
