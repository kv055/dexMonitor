import { useState } from 'react';
import type { PastOrderStats, PastProfitableOrder, TakerOpportunityMode } from '../types';
import { useTimezone } from '../hooks/useTimezone';
import { formatDateTimeLabel, parseUtcTimestamp } from '../utils/formatters';

interface Props {
  stats: PastOrderStats | null;
  statsAll: PastOrderStats | null;
  statsNetCapped: PastOrderStats | null;
  statsAllNetCapped: PastOrderStats | null;
  orders: PastProfitableOrder[];
  ordersAll: PastProfitableOrder[];
  ordersNetCapped: PastProfitableOrder[];
  ordersAllNetCapped: PastProfitableOrder[];
  loading: boolean;
  maxFiatLimit: number | null;
}

function fmtBTC(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value.toLocaleString('de-DE', { minimumFractionDigits: 4, maximumFractionDigits: 8 })} BTC`;
}

function fmtFiat(value: number | null | undefined, currency: string): string {
  if (value == null) return '—';
  return value.toLocaleString('de-DE', { style: 'currency', currency, maximumFractionDigits: 2 });
}

function fmtPct(value: number | null | undefined): string {
  if (value == null) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function labelForTimeframe(timeframe: string): string {
  switch (timeframe) {
    case '1h': return 'Past 1h';
    case '6h': return 'Past 6h';
    case '24h': return 'Past 24h';
    case '48h': return 'Past 48h';
    case '7d': return 'Past 7d';
    default: return timeframe;
  }
}

function timeframeHours(timeframe: string): number {
  switch (timeframe) {
    case '1h': return 1;
    case '6h': return 6;
    case '24h': return 24;
    case '48h': return 48;
    case '7d': return 168;
    default: return 24;
  }
}

function humanizeKey(key: string): string {
  return key.replaceAll('_', ' ');
}

function sortOfferEntries(offer: Record<string, string | number | boolean | null>) {
  return Object.entries(offer).sort(([a], [b]) => a.localeCompare(b));
}

function pickScenario(order: PastProfitableOrder, mode: TakerOpportunityMode) {
  if (mode === 'net_capped' && order.analysis.capped_volume && (order.analysis.capped_volume.profit.avg_btc ?? 0) > 0) {
    return order.analysis.capped_volume;
  }
  return order.analysis.full_volume;
}

function formatOfferValue(value: string | number | boolean | null): string {
  if (value == null) return '—';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? value.toLocaleString('de-DE')
      : value.toLocaleString('de-DE', { maximumFractionDigits: 8 });
  }
  return value;
}

interface PillGroupProps {
  label: string;
  description: string;
  options: { value: string; label: string }[];
  selected: string;
  onChange: (v: string) => void;
}

function PillGroup({ label, description, options, selected, onChange }: PillGroupProps) {
  const base = 'rounded border px-2 py-0.5 text-[0.7rem] font-medium transition-colors';
  const active = 'border-accent/60 bg-accent/10 text-accent';
  const inactive = 'border-border bg-bg/40 text-muted hover:text-text';
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <div className="flex flex-wrap items-center gap-1">
        {options.map(o => (
          <button
            key={o.value}
            type="button"
            title={description}
            onClick={() => onChange(o.value)}
            className={`${base} ${selected === o.value ? active : inactive}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface SelectGroupProps {
  label: string;
  description: string;
  options: { value: string; label: string }[];
  selected: string;
  onChange: (v: string) => void;
}

function SelectGroup({ label, description, options, selected, onChange }: SelectGroupProps) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <select
        title={description}
        value={selected}
        onChange={event => onChange(event.target.value)}
        className="w-full rounded border border-border bg-bg/60 px-2 py-1.5 text-[0.75rem] font-medium text-text outline-none transition-colors hover:border-accent/50 focus:border-accent"
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TakerOpportunities({ stats, statsAll, statsNetCapped, statsAllNetCapped, orders, ordersAll, ordersNetCapped, ordersAllNetCapped, loading, maxFiatLimit }: Props) {
  const { timezone } = useTimezone();
  const [referenceNowMs] = useState(() => Date.now());
  const [selectedTimeframe, setSelectedTimeframe] = useState('24h');
  const [mode, setMode] = useState<TakerOpportunityMode>('net_full');
  const [showAllMethods, setShowAllMethods] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const hasExcluded = (stats?.excluded_payment_methods.length ?? 0) > 0;
  const statsByMode = mode === 'net_capped'
    ? { filtered: statsNetCapped, all: statsAllNetCapped }
    : { filtered: stats, all: statsAll };
  const ordersByMode = mode === 'net_capped'
    ? { filtered: ordersNetCapped, all: ordersAllNetCapped }
    : { filtered: orders, all: ordersAll };
  const activeStats = showAllMethods && hasExcluded ? statsByMode.all : statsByMode.filtered;
  const activeOrders = showAllMethods && hasExcluded ? ordersByMode.all : ordersByMode.filtered;

  const fiat = activeStats?.fiat_currency || 'EUR';
  const selected = !activeStats
    ? null
    : activeStats.timeframes.find(row => row.timeframe === selectedTimeframe)
      ?? activeStats.timeframes.find(row => row.timeframe === '24h')
      ?? activeStats.timeframes[0]
      ?? null;
  const activeTimeframe = selected?.timeframe ?? selectedTimeframe;

  const cutoffMs = referenceNowMs - timeframeHours(activeTimeframe) * 60 * 60 * 1000;
  const visibleOrders = activeOrders.filter(order => {
    const lastSeen = parseUtcTimestamp(order.status.last_seen);
    return lastSeen != null && lastSeen.getTime() >= cutoffMs;
  });

  if (loading && !stats) {
    return <div className="text-[0.8rem] text-muted">Loading taker opportunity statistics…</div>;
  }

  if (!stats) {
    return <div className="text-[0.8rem] text-muted">No taker opportunity statistics available yet.</div>;
  }

  const summaryRows = [
    { label: 'Orders', value: (selected?.premium_order_count ?? 0).toLocaleString('de-DE'), className: 'text-text' },
    { label: 'Net BTC', value: fmtBTC(selected?.total_net_profit_btc), className: 'text-green' },
    { label: `Net ${fiat}`, value: fmtFiat(selected?.total_net_profit_fiat, fiat), className: 'text-text' },
    { label: 'Avg Size', value: fmtBTC(selected?.average_order_size_btc), className: 'text-text' },
    { label: 'Smallest', value: fmtBTC(selected?.smallest_order_size_btc), className: 'text-muted' },
    { label: 'Biggest', value: fmtBTC(selected?.biggest_order_size_btc), className: 'text-muted' },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div className="flex flex-1 min-h-0 flex-col gap-3 lg:flex-row">
        <aside className="flex shrink-0 flex-col gap-3 rounded-lg border border-border bg-bg/20 p-3 lg:w-72 xl:w-80 lg:overflow-y-auto">
          <SelectGroup
            label="Timeframe"
            description="Show stats for orders closed within this window"
            options={(activeStats ?? stats).timeframes.map(r => ({ value: r.timeframe, label: labelForTimeframe(r.timeframe) }))}
            selected={selected?.timeframe ?? selectedTimeframe}
            onChange={setSelectedTimeframe}
          />
          {hasExcluded && (
            <PillGroup
              label="Payment methods"
              description="Selected: only your enabled methods. All: every payment method regardless of settings."
              options={[
                { value: 'selected', label: 'Selected' },
                { value: 'all', label: 'All methods' },
              ]}
              selected={showAllMethods ? 'all' : 'selected'}
              onChange={v => setShowAllMethods(v === 'all')}
            />
          )}
          <PillGroup
            label="Premium mode"
            description="Net full uses full order size. Net capped applies your max fiat position limit where needed."
            options={[
              { value: 'net_full', label: 'Net Full' },
              { value: 'net_capped', label: maxFiatLimit != null && maxFiatLimit > 0 ? `Net Capped €${maxFiatLimit.toLocaleString('de-DE', { maximumFractionDigits: 0 })}` : 'Net Capped' },
            ]}
            selected={mode}
            onChange={v => setMode(v as TakerOpportunityMode)}
          />

          <div className="shrink-0 overflow-hidden rounded-lg border border-border bg-bg/20">
            <div className="border-b border-border bg-surface/70 px-3 py-2 text-[0.65rem] font-semibold uppercase tracking-wide text-muted">
              Backtesting summary
            </div>
            <div className="divide-y divide-border/70 text-[0.75rem]">
              {summaryRows.map(row => (
                <div key={row.label} className="grid grid-cols-[minmax(5rem,0.85fr)_minmax(0,1.15fr)] gap-2 px-3 py-2">
                  <span className="text-muted">{row.label}</span>
                  <span className={`min-w-0 break-words text-right tabular-nums mono-nums ${row.className}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <div className="min-h-0 flex-1 rounded-lg border border-border overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-surface/70 px-3 py-2 text-[0.72rem]">
            <span className="text-text font-medium">Profitable trades</span>
            <span className="text-muted">{visibleOrders.length} in {labelForTimeframe(selected?.timeframe ?? selectedTimeframe).toLowerCase()}</span>
          </div>
          <div className="h-full overflow-y-auto">
            {visibleOrders.length === 0 ? (
              <div className="px-3 py-4 text-[0.75rem] text-muted">No profitable closed trades in this window for the selected net mode.</div>
            ) : (
              visibleOrders.map(order => {
                const isOpen = expandedId === order.id;
                const activeScenario = pickScenario(order, mode);
                const seenLabel = formatDateTimeLabel(order.status.last_seen ?? '', timezone);
                const firstSeenLabel = formatDateTimeLabel(order.status.first_seen ?? '', timezone);

                return (
                  <div key={order.id} className="border-b border-border last:border-0">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isOpen ? null : order.id)}
                      className="w-full bg-transparent border-none px-3 py-2 text-left transition-colors hover:bg-white/5"
                    >
                      <div className="flex items-center gap-2 text-[0.72rem]">
                        <span className="min-w-18 text-text font-medium">{order.exchange}</span>
                        <span className="min-w-14 text-muted uppercase">{order.direction}</span>
                        <span className="truncate text-text">{order.payment_method || 'Unknown method'}</span>
                        <span className="ml-auto text-muted">{isOpen ? '▲' : '▼'}</span>
                      </div>
                      <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-[0.7rem] sm:grid-cols-5">
                        <span className="text-muted">Last seen <span className="text-text">{seenLabel}</span></span>
                        <span className="text-muted">Duration <span className="text-text">{order.status.duration?.display || '—'}</span></span>
                        <span className="text-muted">Size <span className="text-text">{fmtBTC(activeScenario.trade_size_btc)}</span></span>
                        <span className="text-muted">Net BTC <span className="text-green">{fmtBTC(activeScenario.profit.avg_btc)}</span></span>
                        <span className="text-muted">Net {fiat} <span className="text-text">{fmtFiat(activeScenario.profit.avg_fiat, fiat)}</span></span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="border-t border-border bg-bg/20 px-3 py-3 text-[0.72rem]">
                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                            <span className="text-muted">Offer ID</span>
                            <span className="text-text break-all">{order.offer_id || '—'}</span>
                            <span className="text-muted">First seen</span>
                            <span className="text-text">{firstSeenLabel}</span>
                            <span className="text-muted">Last seen</span>
                            <span className="text-text">{seenLabel}</span>
                            <span className="text-muted">Avg net %</span>
                            <span className={(activeScenario.premium.avg_net_percent ?? 0) > 0 ? 'text-green' : 'text-text'}>
                              {fmtPct(activeScenario.premium.avg_net_percent)}
                            </span>
                            <span className="text-muted">Avg trade cost %</span>
                            <span className="text-text">{fmtPct(activeScenario.premium.avg_trade_cost_percent)}</span>
                            <span className="text-muted">Route</span>
                            <span className="text-text">{activeScenario.route.cex} via {activeScenario.route.settlement}</span>
                            {mode === 'net_capped' && order.analysis.capped_volume?.cap_fiat != null && (
                              <>
                                <span className="text-muted">Cap</span>
                                <span className="text-text">{fmtFiat(order.analysis.capped_volume.cap_fiat, fiat)}</span>
                              </>
                            )}
                          </div>

                          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                            {sortOfferEntries(order.offer).map(([key, value]) => (
                              <div key={key} className="contents">
                                <span className="text-muted">{humanizeKey(key)}</span>
                                <span className="text-text break-all">{formatOfferValue(value)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
