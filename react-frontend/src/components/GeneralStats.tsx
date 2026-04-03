import { useEffect, useRef, useMemo } from 'react';
import { Chart, PieController, ArcElement, Tooltip } from 'chart.js';
import { useFilters } from '../context/FiltersContext';
import { LoadingSpinner } from './LoadingSpinner';

Chart.register(PieController, ArcElement, Tooltip);

const PALETTE = [
  '#f7931a', '#3fb950', '#bc8cff', '#58a6ff', '#f85149',
  '#d29922', '#39d353', '#db61a2', '#79c0ff', '#e3b341', '#4a4f58',
];

function normalizeTs(ts: string): string {
  return ts.replace(' ', 'T') + (ts.endsWith('Z') ? '' : 'Z');
}

function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface KpiCardProps {
  label: string;
  value: string;
  sub?: string;
  valueColor?: string;
  barFill?: number;
  barColor?: string;
}

function KpiCard({ label, value, sub, valueColor = 'text-text', barFill, barColor = 'bg-green' }: KpiCardProps) {
  return (
    <div className="relative flex-1 bg-bg border border-border rounded-lg px-3 py-2 flex flex-col gap-0.5 overflow-hidden min-w-0">
      <div className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full ${barFill != null ? barColor : 'bg-border'}`} />
      <span className="text-[0.58rem] uppercase tracking-widest text-muted font-semibold leading-none">{label}</span>
      <span className={`text-[1.35rem] font-bold leading-none tabular-nums ${valueColor}`}>{value}</span>
      {sub && <span className="text-[0.6rem] text-muted leading-none">{sub}</span>}
      {barFill != null && (
        <div
          className={`absolute bottom-0 left-0 h-0.5 opacity-30 ${barColor}`}
          style={{ width: `${Math.min(barFill * 100, 100)}%` }}
        />
      )}
    </div>
  );
}

function PaymentPieChart({ theme }: { theme: 'dark' | 'light' }) {
  const { filteredOffers: offers } = useFilters();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !offers.length) return;

    const counts: Record<string, number> = {};
    offers.forEach(o => {
      const pm = o.payment_method || 'Unknown';
      counts[pm] = (counts[pm] || 0) + 1;
    });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 10);
    const rest = sorted.slice(10);
    if (rest.length > 0) top.push(['Others', rest.reduce((s, e) => s + e[1], 0)]);

    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: 'pie',
      data: {
        labels: top.map(e => e[0]),
        datasets: [{
          data: top.map(e => e[1]),
          backgroundColor: PALETTE.slice(0, top.length),
          borderWidth: 1,
          borderColor: 'transparent',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.label}: ${c.raw}` } },
        },
        layout: { padding: 2 },
      },
    });
    return () => { chartRef.current?.destroy(); chartRef.current = null; };
  }, [offers, theme]);

  return (
    <div className="relative flex-1 bg-bg border border-border rounded-lg px-3 py-2 flex flex-col gap-0.5 overflow-hidden min-w-0">
      <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-border" />
      <span className="text-[0.58rem] uppercase tracking-widest text-muted font-semibold leading-none shrink-0">Payment Methods</span>
      <div className="relative flex-1 min-h-0">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}

export function GeneralStats({ theme }: { theme: 'dark' | 'light' }) {
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

    const exchangesLive = new Set(openOffers.map(o => o.exchange)).size;
    const paymentMethods = new Set(openOffers.map(o => o.payment_method).filter(Boolean)).size;

    const durations = closedOffers
      .filter(o => o.first_seen && o.last_seen)
      .map(o => new Date(normalizeTs(o.last_seen!)).getTime() - new Date(normalizeTs(o.first_seen!)).getTime())
      .filter(d => d > 0);
    const avgLifetime = durations.length
      ? durations.reduce((s, d) => s + d, 0) / durations.length : null;

    return { totalOffers: offers.length, activeOffers: openOffers.length, exchangesLive, bestAskPremium, avgAskPremium, avgLifetime, paymentMethods };
  }, [offers]);

  const premiumColor = (v: number | null) =>
    v == null ? 'text-text' : v >= 3 ? 'text-green' : v >= 1 ? 'text-yellow' : 'text-red';
  const premiumBarColor = (v: number | null) =>
    v == null ? 'bg-border' : v >= 3 ? 'bg-green' : v >= 1 ? 'bg-yellow' : 'bg-red';

  if (loading && offers.length === 0) {
    return (
      <div className="relative h-16">
        <LoadingSpinner label="Loading statistics" />
      </div>
    );
  }

  return (
    <div className="flex gap-1.5 items-stretch h-full">
      <KpiCard
        label="Active Offers"
        value={String(stats.activeOffers)}
        sub={`${stats.totalOffers} tracked`}
        barFill={stats.totalOffers > 0 ? stats.activeOffers / stats.totalOffers : 0}
        barColor="bg-blue"
      />
      <KpiCard
        label="Exchanges Live"
        value={String(stats.exchangesLive)}
        sub={`${stats.paymentMethods} pay methods`}
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
        sub="across open asks"
        valueColor={premiumColor(stats.avgAskPremium)}
        barFill={stats.avgAskPremium != null ? Math.min(stats.avgAskPremium / 10, 1) : undefined}
        barColor={premiumBarColor(stats.avgAskPremium)}
      />
      <KpiCard
        label="Avg Offer Lifetime"
        value={stats.avgLifetime != null ? fmtDuration(stats.avgLifetime) : '—'}
        sub="closed offers"
        barFill={stats.avgLifetime != null ? Math.min(stats.avgLifetime / (24 * 3_600_000), 1) : undefined}
        barColor="bg-muted"
      />
      <PaymentPieChart theme={theme} />
    </div>
  );
}
