import { useMemo, useState } from 'react';
import { LoadingSpinner } from './LoadingSpinner';
import type {
  GeneralStatsData,
  GeneralStatsPremiumSummaryData,
  NamedCount,
  PastPremiumTimeframeStats,
  PremiumLifetimeModes,
} from '../types';

function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function labelForTimeframe(timeframe: string): string {
  switch (timeframe) {
    case '6h': return '6h';
    case '24h': return '24h';
    case '48h': return '48h';
    case '7d': return '7d';
    default: return timeframe;
  }
}

// Exchange → Tailwind color token (mirrors OHLCChart colors)
const EXCHANGE_COLOR: Record<string, string> = {
  bisq: 'text-accent',
  bisq2: 'text-blue',
  hodlhodl: 'text-green',
  robosats: 'text-purple',
  peachbitcoin: 'text-peach',
};
// Hex values for bar fills (must match CSS tokens exactly)
const EXCHANGE_HEX: Record<string, string> = {
  bisq: '#f7931a',
  bisq2: '#58a6ff',
  hodlhodl: '#3fb950',
  robosats: '#bc8cff',
  peachbitcoin: '#FF6B35',
};

function exchangeColor(name: string): string {
  return EXCHANGE_COLOR[name.toLowerCase()] ?? 'text-muted';
}
function exchangeHex(name: string): string {
  return EXCHANGE_HEX[name.toLowerCase()] ?? '#8b949e';
}

function premiumColor(v: number | null): string {
  if (v == null) return 'text-muted';
  if (v >= 3) return 'text-green';
  if (v > 0) return 'text-accent';
  return 'text-red';
}

export function Card({ accent = 'bg-border', accentHex, bottomFill, bottomColor, children }: {
  accent?: string;
  accentHex?: string;
  bottomFill?: number;
  bottomColor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative bg-bg border border-border rounded-lg px-3 py-2.5 flex flex-col gap-1.5 overflow-hidden min-w-0">
      <div
        className={`absolute left-0 top-2 bottom-2 w-0.5 rounded-full ${accentHex ? '' : accent}`}
        style={accentHex ? { backgroundColor: accentHex } : undefined}
      />
      {children}
      {bottomFill != null && bottomFill > 0 && (
        <div
          className={`absolute bottom-0 left-0 h-0.5 opacity-20 ${bottomColor ?? 'bg-border'}`}
          style={{ width: `${Math.min(bottomFill * 100, 100)}%` }}
        />
      )}
    </div>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[0.65rem] uppercase tracking-widest text-muted font-semibold leading-none shrink-0">
      {children}
    </span>
  );
}

export function ExchangesCard({ exchangesLive, offersByExchange }: {
  exchangesLive: number;
  offersByExchange: NamedCount[];
}) {
  const entries = offersByExchange ?? [];
  const max = entries.reduce((m, e) => Math.max(m, e.count), 0);
  // Accent bar: color of leading exchange
  const leading = entries[0];
  const accentHex = leading ? exchangeHex(leading.name) : undefined;

  return (
    <Card accentHex={accentHex}>
      <div className="flex items-baseline justify-between gap-2">
        <Label>Exchanges Live</Label>
        <span className="text-sm font-bold tabular-nums mono-nums leading-none text-text">
          {exchangesLive}
        </span>
      </div>
      <div className="flex items-center gap-2.5 flex-wrap">
        {entries.map(e => {
          const hex = exchangeHex(e.name);
          const pct = max > 0 ? e.count / max : 0;
          return (
            <div key={e.name} className="flex items-center gap-1">
              {/* mini bar in exchange color */}
              <div className="w-6 h-0.5 bg-border/40 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct * 100}%`, backgroundColor: hex, opacity: 0.7 }} />
              </div>
              <span className={`text-[0.68rem] font-medium ${exchangeColor(e.name)}`}>{e.name}</span>
              <span className="text-[0.68rem] tabular-nums mono-nums text-text">{e.count}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function LifetimeCard({ lifetimes }: { lifetimes: PremiumLifetimeModes }) {
  const [mode, setMode] = useState<'raw' | 'net_full' | 'net_capped'>('raw');
  const selected = lifetimes?.[mode] ?? { avg_offer_lifetime_ms: null, avg_offer_lifetime_ms_by_exchange: [] };
  const byExchange = selected.avg_offer_lifetime_ms_by_exchange ?? [];
  const overall = selected.avg_offer_lifetime_ms;
  const modeLabel = mode === 'raw' ? 'Raw' : mode === 'net_full' ? 'Net Full' : 'Net Capped';
  return (
    <Card accent="bg-muted" bottomFill={overall != null ? Math.min(overall / (24 * 3_600_000), 1) : 0} bottomColor="bg-muted">
      <div className="flex items-baseline justify-between gap-2">
        <Label>Avg Offer Lifetime</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tabular-nums mono-nums leading-none text-text">
            {overall != null ? fmtDuration(overall) : '—'}
          </span>
          <span className="text-[0.68rem] font-bold tabular-nums mono-nums leading-none text-text">{modeLabel}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {([
          ['raw', 'Raw'],
          ['net_full', 'Net Full'],
          ['net_capped', 'Net Capped'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`rounded-md border px-2 py-0.5 text-[0.68rem] font-medium transition-colors ${
              mode === value
                ? 'border-accent bg-accent text-black'
                : 'border-border bg-bg/40 text-muted hover:text-text'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {byExchange.length > 0 && (
        <div className="flex items-center gap-2.5 flex-wrap">
          {byExchange.map(e => (
            <div key={e.name} className="flex items-center gap-1">
              <span className={`text-[0.68rem] font-medium ${exchangeColor(e.name)}`}>{e.name}</span>
              <span className="text-[0.68rem] tabular-nums mono-nums text-muted">{fmtDuration(e.ms)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function PremiumsCard({ premium }: { premium: GeneralStatsPremiumSummaryData }) {
  const [mode, setMode] = useState<'raw' | 'net_full' | 'net_capped'>('raw');
  // Live premiums are only available in raw mode (no net/capped recompute for
  // currently-live offers). The mode toggle is retained for visual consistency
  // with the past cards; net_full / net_capped render the raw value with a
  // dimmed toggle since the backend does not produce them for the live set.
  const avgAsk = premium?.avg_ask_premium_pct ?? null;
  const avgBid = premium?.avg_bid_premium_pct ?? null;
  const strongest = Math.max(Math.abs(avgAsk ?? 0), Math.abs(avgBid ?? 0));
  const barValue = isFinite(strongest) ? strongest : 0;
  const barColor = barValue >= 3 ? 'bg-green' : barValue > 0 ? 'bg-accent' : 'bg-red';
  const accent = barValue > 0 ? barColor : 'bg-border';
  const modeLabel = mode === 'raw' ? 'Raw' : mode === 'net_full' ? 'Net Full' : 'Net Capped';
  const modeDisabled = mode !== 'raw';

  return (
    <Card accent={accent} bottomFill={barValue > 0 ? Math.min(barValue / 10, 1) : 0} bottomColor={barColor}>
      <div className="flex items-baseline justify-between gap-2">
        <Label>Open Premiums</Label>
        <span className="text-sm font-bold tabular-nums mono-nums leading-none text-text">{modeLabel}</span>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {([
          ['raw', 'Raw'],
          ['net_full', 'Net Full'],
          ['net_capped', 'Net Capped'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`rounded-md border px-2 py-0.5 text-[0.68rem] font-medium transition-colors ${
              mode === value
                ? 'border-accent bg-accent text-black'
                : 'border-border bg-bg/40 text-muted hover:text-text'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {modeDisabled && (
        <span className="text-[0.62rem] text-muted leading-none">
          Net modes are only computed for past offers.
        </span>
      )}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[0.68rem] font-bold text-accent leading-none">Asks</span>
          <span className={`text-[0.8rem] font-bold tabular-nums mono-nums leading-none ${premiumColor(avgAsk)}`}>{fmtPct(avgAsk)}</span>
        </div>
        <div className="w-px h-3 bg-border/60 shrink-0" />
        <div className="flex items-center gap-1.5">
          <span className="text-[0.68rem] font-bold text-blue leading-none">Bids</span>
          <span className={`text-[0.8rem] font-bold tabular-nums mono-nums leading-none ${premiumColor(avgBid)}`}>{fmtPct(avgBid)}</span>
        </div>
      </div>
    </Card>
  );
}

export function PastPremiumsCard({ frames }: { frames: PastPremiumTimeframeStats[] }) {
  const framesList = useMemo(() => frames ?? [], [frames]);
  const [mode, setMode] = useState<'raw' | 'net_full' | 'net_capped'>('raw');
  const [selectedTimeframe, setSelectedTimeframe] = useState('24h');
  const selected = useMemo(() => (
    framesList.find(frame => frame.timeframe === selectedTimeframe)
      ?? framesList.find(frame => frame.timeframe === '24h')
      ?? framesList[0]
      ?? null
  ), [framesList, selectedTimeframe]);
  const entries = selected?.modes?.[mode] ?? selected?.avg_premium_by_exchange ?? [];
  const top = entries.slice(0, 3);
  const rest = entries.length - top.length;
  const topValue = top.reduce((best, entry) => Math.max(best, entry.avg_premium_pct), -Infinity);
  const barValue = isFinite(topValue) ? topValue : 0;
  const barColor = barValue >= 3 ? 'bg-green' : barValue > 0 ? 'bg-accent' : 'bg-red';
  const accent = barValue > 0 ? barColor : 'bg-border';
  const modeLabel = mode === 'raw' ? 'Raw' : mode === 'net_full' ? 'Net Full' : 'Net Capped';

  return (
    <Card accent={accent} bottomFill={barValue > 0 ? Math.min(barValue / 10, 1) : 0} bottomColor={barColor}>
      <div className="flex items-baseline justify-between gap-2">
        <Label>Past Premiums</Label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold tabular-nums mono-nums leading-none text-text">
            {selected ? labelForTimeframe(selected.timeframe) : '—'}
          </span>
          <span className="text-[0.68rem] font-bold tabular-nums mono-nums leading-none text-text">{modeLabel}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {framesList.map(frame => (
          <button
            key={frame.timeframe}
            type="button"
            onClick={() => setSelectedTimeframe(frame.timeframe)}
            className={`rounded-md border px-2 py-0.5 text-[0.68rem] font-medium transition-colors ${
              selected?.timeframe === frame.timeframe
                ? 'border-accent bg-accent text-black'
                : 'border-border bg-bg/40 text-muted hover:text-text'
            }`}
          >
            {labelForTimeframe(frame.timeframe)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {([
          ['raw', 'Raw'],
          ['net_full', 'Net Full'],
          ['net_capped', 'Net Capped'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={`rounded-md border px-2 py-0.5 text-[0.68rem] font-medium transition-colors ${
              mode === value
                ? 'border-accent bg-accent text-black'
                : 'border-border bg-bg/40 text-muted hover:text-text'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {top.length > 0 ? (
        <div className="flex items-center gap-2.5 flex-wrap">
          {top.map(entry => (
            <div key={`${selected?.timeframe}-${entry.name}`} className="flex items-center gap-1">
              <span className={`text-[0.68rem] font-medium ${exchangeColor(entry.name)}`}>{entry.name}</span>
              <span className={`text-[0.72rem] font-bold tabular-nums mono-nums ${premiumColor(entry.avg_premium_pct)}`}>{fmtPct(entry.avg_premium_pct)}</span>
            </div>
          ))}
          {rest > 0 && <span className="text-[0.68rem] text-muted">+{rest}</span>}
        </div>
      ) : (
        <span className="text-[0.68rem] text-muted">No past premiums available.</span>
      )}
    </Card>
  );
}

export function PaymentMethodsCard({ counts }: { counts: NamedCount[] }) {
  const list = counts ?? [];
  const top = list.slice(0, 5);
  const rest = list.slice(5).reduce((s, e) => s + e.count, 0);
  const max = top.reduce((m, e) => Math.max(m, e.count), 0);
  // cycle through subtle accent colors for top methods
  const methodColors = ['text-accent', 'text-blue', 'text-green', 'text-purple', 'text-red'];

  return (
    <Card accent="bg-blue">
      <div className="flex items-baseline justify-between gap-2">
        <Label>Payment Methods</Label>
        <span className="text-sm font-bold tabular-nums mono-nums leading-none text-blue">{list.length}</span>
      </div>
      <div className="flex items-center gap-2.5 flex-wrap">
        {top.map((e, i) => {
          const pct = max > 0 ? e.count / max : 0;
          return (
            <div key={e.name} className="flex items-center gap-1">
              <div className="w-5 h-0.5 bg-border/40 rounded-full overflow-hidden">
                <div className="h-full rounded-full opacity-60" style={{ width: `${pct * 100}%`, backgroundColor: ['#f7931a','#58a6ff','#3fb950','#bc8cff','#f85149'][i] }} />
              </div>
              <span className={`text-[0.68rem] font-medium ${methodColors[i]}`}>{e.name}</span>
              <span className="text-[0.68rem] tabular-nums mono-nums text-muted">{e.count}</span>
            </div>
          );
        })}
        {rest > 0 && <span className="text-[0.68rem] text-muted">+{rest}</span>}
      </div>
    </Card>
  );
}

// Backwards-compatible wrapper kept so any remaining import of the old
// GeneralStats default surface still renders. The Statistics page composes the
// exported cards above directly instead.
export function GeneralStats({ stats, loading }: { stats: GeneralStatsData | null; loading: boolean }) {
  if (loading && !stats) {
    return <div className="relative min-h-32"><LoadingSpinner size={88} label="Loading statistics" /></div>;
  }
  if (!stats) {
    return <div className="text-sm text-muted">No statistics available.</div>;
  }
  return (
    <div className="grid grid-cols-2 xl:grid-cols-5 gap-1.5">
      <ExchangesCard exchangesLive={stats.exchanges_live} offersByExchange={stats.offers_by_exchange} />
      <PremiumsCard premium={{
        best_ask_premium_pct: stats.best_ask_premium_pct,
        avg_ask_premium_pct: stats.avg_ask_premium_pct,
        best_bid_premium_pct: stats.best_bid_premium_pct,
        avg_bid_premium_pct: stats.avg_bid_premium_pct,
      }} />
      <PastPremiumsCard frames={stats.past_premiums ?? []} />
      <LifetimeCard lifetimes={stats.premium_lifetimes ?? { raw: { avg_offer_lifetime_ms: stats.avg_offer_lifetime_ms, avg_offer_lifetime_ms_by_exchange: stats.avg_offer_lifetime_ms_by_exchange }, net_full: { avg_offer_lifetime_ms: null, avg_offer_lifetime_ms_by_exchange: [] }, net_capped: { avg_offer_lifetime_ms: null, avg_offer_lifetime_ms_by_exchange: [] } }} />
      <PaymentMethodsCard counts={stats.payment_method_counts} />
    </div>
  );
}
