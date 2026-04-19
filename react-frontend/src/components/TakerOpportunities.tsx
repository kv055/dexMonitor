import { useMemo, useState } from 'react';
import type { PastOrderStats, PastProfitableOrder, TakerOpportunityMode } from '../types';
import { useTimezone } from '../context/TimezoneContext';
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
    <div className="flex flex-col gap-0.5">
      <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted">{label}</span>
      <div className="flex items-center gap-1">
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

export function TakerOpportunities({ stats, statsAll, statsNetCapped, statsAllNetCapped, orders, ordersAll, ordersNetCapped, ordersAllNetCapped, loading, maxFiatLimit }: Props) {
  const { timezone } = useTimezone();
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
  const selected = useMemo(() => {
    if (!activeStats) return null;
    return activeStats.timeframes.find(row => row.timeframe === selectedTimeframe)
      ?? activeStats.timeframes.find(row => row.timeframe === '24h')
      ?? activeStats.timeframes[0]
      ?? null;
  }, [activeStats, selectedTimeframe]);

  const visibleOrders = useMemo(() => {
    const cutoffMs = Date.now() - timeframeHours(selected?.timeframe ?? selectedTimeframe) * 60 * 60 * 1000;
    return activeOrders.filter(order => {
      const lastSeen = parseUtcTimestamp(order.status.last_seen);
      return lastSeen != null && lastSeen.getTime() >= cutoffMs;
    });
  }, [activeOrders, selected, selectedTimeframe]);

  if (loading && !stats) {
    return <div className="text-[0.8rem] text-muted">Loading taker opportunity statistics…</div>;
  }

  if (!stats) {
    return <div className="text-[0.8rem] text-muted">No taker opportunity statistics available yet.</div>;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
      <div className="flex flex-wrap items-end gap-3">
        <PillGroup
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
      </div>

      <div className="overflow-auto rounded-lg border border-border">
        <table className="w-full text-[0.78rem]">
          <thead className="bg-surface text-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Window</th>
              <th className="px-3 py-2 text-right font-medium">Orders</th>
              <th className="px-3 py-2 text-right font-medium">Net BTC</th>
              <th className="px-3 py-2 text-right font-medium">Net {fiat}</th>
              <th className="px-3 py-2 text-right font-medium">Avg Size</th>
              <th className="px-3 py-2 text-right font-medium">Smallest</th>
              <th className="px-3 py-2 text-right font-medium">Biggest</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-t border-border">
              <td className="px-3 py-2 text-text font-medium">{labelForTimeframe(selected?.timeframe ?? selectedTimeframe)}</td>
              <td className="px-3 py-2 text-right text-text">{selected?.premium_order_count ?? 0}</td>
              <td className="px-3 py-2 text-right text-green">{fmtBTC(selected?.total_net_profit_btc)}</td>
              <td className="px-3 py-2 text-right text-text">{fmtFiat(selected?.total_net_profit_fiat, fiat)}</td>
              <td className="px-3 py-2 text-right text-text">{fmtBTC(selected?.average_order_size_btc)}</td>
              <td className="px-3 py-2 text-right text-muted">{fmtBTC(selected?.smallest_order_size_btc)}</td>
              <td className="px-3 py-2 text-right text-muted">{fmtBTC(selected?.biggest_order_size_btc)}</td>
            </tr>
          </tbody>
        </table>
      </div>

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

      <p className="text-[0.7rem] text-muted">
        Net profit of closed orders that remain profitable under the selected net-premium mode.
        {mode === 'net_capped' && ' Capped mode models each oversized order at your max fiat position size.'}
      </p>
    </div>
  );
}
