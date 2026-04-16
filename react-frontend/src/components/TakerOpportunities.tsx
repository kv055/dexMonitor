import { useMemo, useState } from 'react';
import type { PastOrderTimeframeStats, PastOrderStats } from '../types';

interface Props {
  stats: PastOrderStats | null;
  statsAll: PastOrderStats | null;
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

function hasCappedData(row: PastOrderTimeframeStats): boolean {
  return row.total_net_profit_btc_capped != null;
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

export function TakerOpportunities({ stats, statsAll, loading, maxFiatLimit }: Props) {
  const [selectedTimeframe, setSelectedTimeframe] = useState('24h');
  const [showCapped, setShowCapped] = useState(false);
  const [showAllMethods, setShowAllMethods] = useState(false);

  const hasExcluded = (stats?.excluded_payment_methods.length ?? 0) > 0;
  const activeStats = showAllMethods && hasExcluded ? statsAll : stats;

  const fiat = activeStats?.fiat_currency || 'EUR';
  const selected = useMemo(() => {
    if (!activeStats) return null;
    return activeStats.timeframes.find(row => row.timeframe === selectedTimeframe)
      ?? activeStats.timeframes.find(row => row.timeframe === '24h')
      ?? activeStats.timeframes[0]
      ?? null;
  }, [activeStats, selectedTimeframe]);

  const anyCapped = useMemo(() => activeStats?.timeframes.some(hasCappedData) ?? false, [activeStats]);
  const cappedAvailable = selected != null && hasCappedData(selected);

  const netBTC  = showCapped && cappedAvailable ? selected?.total_net_profit_btc_capped   : selected?.total_net_profit_btc;
  const netFiat = showCapped && cappedAvailable ? selected?.total_net_profit_fiat_capped  : selected?.total_net_profit_fiat;
  const avgBTC  = showCapped && cappedAvailable ? selected?.average_order_size_btc_capped : selected?.average_order_size_btc;

  const cappedLabel = maxFiatLimit != null && maxFiatLimit > 0
    ? `Capped €${maxFiatLimit.toLocaleString('de-DE', { maximumFractionDigits: 0 })}`
    : 'Capped';

  if (loading && !stats) {
    return <div className="text-[0.8rem] text-muted">Loading taker opportunity statistics…</div>;
  }

  if (!stats) {
    return <div className="text-[0.8rem] text-muted">No taker opportunity statistics available yet.</div>;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">

      {/* Controls: all groups left-aligned in one row */}
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
        {anyCapped && (
          <PillGroup
            label="Position size"
            description="Full size: order's max BTC volume. Capped: model profit at your max fiat position limit."
            options={[
              { value: 'full', label: 'Full size' },
              { value: 'capped', label: cappedLabel },
            ]}
            selected={showCapped ? 'capped' : 'full'}
            onChange={v => setShowCapped(v === 'capped')}
          />
        )}
      </div>

      {/* Stats table */}
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
              <td className="px-3 py-2 text-right text-green">{fmtBTC(netBTC)}</td>
              <td className="px-3 py-2 text-right text-text">{fmtFiat(netFiat, fiat)}</td>
              <td className="px-3 py-2 text-right text-text">{fmtBTC(avgBTC)}</td>
              <td className="px-3 py-2 text-right text-muted">{fmtBTC(selected?.smallest_order_size_btc)}</td>
              <td className="px-3 py-2 text-right text-muted">{fmtBTC(selected?.biggest_order_size_btc)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[0.7rem] text-muted">
        Net profit of all premium closed orders in the selected window, after trade costs.
        {showCapped && cappedAvailable && ' Capped view models each order at your max fiat position size.'}
      </p>
    </div>
  );
}
