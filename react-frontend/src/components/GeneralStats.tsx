import { useMemo, useState } from 'react';
import type {
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

const EXCHANGE_COLOR: Record<string, string> = {
  bisq: 'text-accent',
  bisq2: 'text-blue',
  hodlhodl: 'text-green',
  robosats: 'text-purple',
  peachbitcoin: 'text-peach',
};

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

function buildConicGradient(entries: { value: number; color: string }[]): string {
  const total = entries.reduce((sum, entry) => sum + entry.value, 0);
  if (total <= 0 || entries.length === 0) {
    return 'conic-gradient(#30363d 0deg 360deg)';
  }

  let current = 0;
  const stops = entries.map(entry => {
    const start = current;
    const sweep = (entry.value / total) * 360;
    current += sweep;
    return `${entry.color} ${start}deg ${current}deg`;
  });

  return `conic-gradient(${stops.join(', ')})`;
}

const PIE_SIZE = 'clamp(180px, 28vh, 300px)';
const PIE_INSET = 'clamp(28px, 4.5vh, 40px)';

function BreakdownPie({
  entries,
  total,
  centerLabel,
}: {
  entries: { name: string; value: number; color: string; textClass?: string }[];
  total: number;
  centerLabel: string;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center gap-4 py-2">
      <div
        className="relative shrink-0"
        style={{ width: PIE_SIZE, height: PIE_SIZE }}
      >
        <div
          className="h-full w-full rounded-full border border-border/70"
          style={{ background: buildConicGradient(entries.map(entry => ({ value: entry.value, color: entry.color }))) }}
        />
        <div
          className="absolute rounded-full border border-border bg-bg flex flex-col items-center justify-center"
          style={{ inset: PIE_INSET }}
        >
          <span className="text-[1.05rem] font-bold mono-nums tabular-nums leading-none text-text">{total}</span>
          <span className="mt-1 text-[0.52rem] uppercase tracking-[0.16em] text-muted leading-none">{centerLabel}</span>
        </div>
      </div>

      <div className="grid w-full grid-cols-1 gap-1.5 min-w-0">
        {entries.map(entry => {
          const pct = total > 0 ? (entry.value / total) * 100 : 0;
          return (
            <div key={entry.name} className="flex items-center justify-between gap-3 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
                <span className={`truncate text-[0.68rem] font-medium ${entry.textClass ?? 'text-text'}`}>{entry.name}</span>
              </div>
              <span className="text-[0.68rem] mono-nums tabular-nums text-muted shrink-0">
                {entry.value} · {pct.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type CardTone = 'amber' | 'blue' | 'green' | 'purple' | 'peach' | 'neutral';

const ACTIVE_SEGMENT_CLASS: Record<CardTone, string> = {
  amber: 'border-accent bg-accent text-black',
  blue: 'border-blue bg-blue text-black',
  green: 'border-green bg-green text-black',
  purple: 'border-purple bg-purple text-black',
  peach: 'border-peach bg-peach text-black',
  neutral: 'border-border bg-surface text-text',
};

function segmentedClass(active: boolean, tone: CardTone): string {
  return active
    ? `rounded-md border px-2 py-0.5 text-[0.68rem] font-medium transition-colors ${ACTIVE_SEGMENT_CLASS[tone]}`
    : 'rounded-md border border-border bg-bg/40 px-2 py-0.5 text-[0.68rem] font-medium text-muted transition-colors hover:text-text';
}

export function Card({
  accent = 'bg-border',
  accentHex,
  bottomFill,
  bottomColor,
  children,
}: {
  accent?: string;
  accentHex?: string;
  bottomFill?: number;
  bottomColor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative h-full bg-bg border border-border rounded-lg px-3 py-2.5 flex flex-col gap-2 overflow-hidden min-w-0">
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
  const leading = entries[0];
  const accentHex = leading ? exchangeHex(leading.name) : undefined;
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  const chartEntries = entries.map(entry => ({
    name: entry.name,
    value: entry.count,
    color: exchangeHex(entry.name),
    textClass: exchangeColor(entry.name),
  }));

  return (
    <Card accentHex={accentHex}>
      <div className="flex items-baseline justify-between gap-2">
        <Label>Exchanges Live</Label>
        <span className="text-sm font-bold tabular-nums mono-nums leading-none text-text">
          {exchangesLive}
        </span>
      </div>
      <BreakdownPie entries={chartEntries} total={total} centerLabel="offers" />
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
        <div className="flex items-end gap-2">
          <span className="text-sm font-bold tabular-nums mono-nums leading-none text-text">
            {overall != null ? fmtDuration(overall) : '—'}
          </span>
          <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] leading-none text-muted">{modeLabel}</span>
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
            className={segmentedClass(mode === value, 'green')}
          >
            {label}
          </button>
        ))}
      </div>
      {byExchange.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {byExchange.map(e => (
            <div key={e.name} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-surface/40 px-2 py-1.5">
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
  const avgAsk = premium?.avg_ask_premium_pct ?? null;
  const avgBid = premium?.avg_bid_premium_pct ?? null;
  const bestAsk = premium?.best_ask_premium_pct ?? null;
  const bestBid = premium?.best_bid_premium_pct ?? null;
  const strongest = Math.max(Math.abs(avgAsk ?? 0), Math.abs(avgBid ?? 0));
  const barValue = isFinite(strongest) ? strongest : 0;
  const barColor = barValue >= 3 ? 'bg-green' : barValue > 0 ? 'bg-accent' : 'bg-red';
  const accent = barValue > 0 ? barColor : 'bg-border';
  const modeLabel = mode === 'raw' ? 'Raw' : mode === 'net_full' ? 'Net Full' : 'Net Capped';
  const mirrorsRaw = mode !== 'raw';

  return (
    <Card accent={accent} bottomFill={barValue > 0 ? Math.min(barValue / 10, 1) : 0} bottomColor={barColor}>
      <div className="flex items-baseline justify-between gap-2">
        <Label>Open Premiums</Label>
        <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] leading-none text-muted">{modeLabel}</span>
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
            className={segmentedClass(mode === value, 'blue')}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-md border border-border/60 bg-surface/40 px-2.5 py-2 flex flex-col gap-2">
          <div className="flex items-end justify-between gap-3">
            <span className="text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-accent leading-none">Asks</span>
            <span className={`text-[0.88rem] font-bold tabular-nums mono-nums leading-none ${premiumColor(avgAsk ?? bestAsk)}`}>{fmtPct(avgAsk ?? bestAsk)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[0.62rem]">
            <span className="text-muted">Best</span>
            <span className={`font-semibold mono-nums ${premiumColor(bestAsk)}`}>{fmtPct(bestAsk)}</span>
          </div>
        </div>
        <div className="rounded-md border border-border/60 bg-surface/40 px-2.5 py-2 flex flex-col gap-2">
          <div className="flex items-end justify-between gap-3">
            <span className="text-[0.64rem] font-semibold uppercase tracking-[0.14em] text-blue leading-none">Bids</span>
            <span className={`text-[0.88rem] font-bold tabular-nums mono-nums leading-none ${premiumColor(avgBid ?? bestBid)}`}>{fmtPct(avgBid ?? bestBid)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[0.62rem]">
            <span className="text-muted">Best</span>
            <span className={`font-semibold mono-nums ${premiumColor(bestBid)}`}>{fmtPct(bestBid)}</span>
          </div>
        </div>
      </div>
      <span className="text-[0.62rem] text-muted leading-none">
        {mirrorsRaw
          ? 'Live offers do not have net-mode recomputes yet, so this view mirrors raw premiums.'
          : 'Live premiums are calculated from the currently open offer set.'}
      </span>
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
        <div className="flex items-end gap-2">
          <span className="text-sm font-bold tabular-nums mono-nums leading-none text-text">
            {selected ? labelForTimeframe(selected.timeframe) : '—'}
          </span>
          <span className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] leading-none text-muted">{modeLabel}</span>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {framesList.map(frame => (
          <button
            key={frame.timeframe}
            type="button"
            onClick={() => setSelectedTimeframe(frame.timeframe)}
            className={segmentedClass(selected?.timeframe === frame.timeframe, 'purple')}
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
            className={segmentedClass(mode === value, 'purple')}
          >
            {label}
          </button>
        ))}
      </div>
      {top.length > 0 ? (
        <div className="grid grid-cols-1 gap-2">
          {top.map(entry => (
            <div key={`${selected?.timeframe}-${entry.name}`} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-surface/40 px-2 py-1.5">
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
  const methodColors = ['text-accent', 'text-blue', 'text-green', 'text-purple', 'text-red'];
  const methodHex = ['#f7931a', '#58a6ff', '#3fb950', '#bc8cff', '#f85149'];
  const chartEntries = top.map((entry, i) => ({
    name: entry.name,
    value: entry.count,
    color: methodHex[i],
    textClass: methodColors[i],
  }));
  if (rest > 0) {
    chartEntries.push({
      name: 'Other',
      value: rest,
      color: '#8b949e',
      textClass: 'text-muted',
    });
  }
  const total = chartEntries.reduce((sum, entry) => sum + entry.value, 0);

  return (
    <Card accent="bg-blue">
      <div className="flex items-baseline justify-between gap-2">
        <Label>Payment Methods</Label>
        <span className="text-sm font-bold tabular-nums mono-nums leading-none text-blue">{list.length}</span>
      </div>
      <BreakdownPie entries={chartEntries} total={total} centerLabel="top mix" />
    </Card>
  );
}
