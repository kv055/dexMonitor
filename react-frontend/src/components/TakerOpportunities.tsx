import { useMemo, useState } from 'react';
import type { PastOrderStats } from '../types';

interface Props {
  stats: PastOrderStats | null;
  loading: boolean;
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

export function TakerOpportunities({ stats, loading }: Props) {
  const [selectedTimeframe, setSelectedTimeframe] = useState('24h');
  const fiat = stats?.fiat_currency || 'EUR';
  const excluded = stats?.excluded_payment_methods ?? [];
  const selected = useMemo(() => {
    if (!stats) return null;
    return stats.timeframes.find(row => row.timeframe === selectedTimeframe)
      ?? stats.timeframes.find(row => row.timeframe === '24h')
      ?? stats.timeframes[0]
      ?? null;
  }, [stats, selectedTimeframe]);

  if (loading && !stats) {
    return <div className="text-[0.8rem] text-muted">Loading taker opportunity statistics…</div>;
  }

  if (!stats) {
    return <div className="text-[0.8rem] text-muted">No taker opportunity statistics available yet.</div>;
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {stats.timeframes.map(row => (
            <button
              key={row.timeframe}
              type="button"
              onClick={() => setSelectedTimeframe(row.timeframe)}
              className={`rounded-md border px-2.5 py-1 text-[0.72rem] font-medium transition-colors ${
                selected?.timeframe === row.timeframe
                  ? 'border-accent bg-accent text-black'
                  : 'border-border bg-bg/40 text-muted hover:text-text'
              }`}
            >
              {labelForTimeframe(row.timeframe)}
            </button>
          ))}
        </div>
        <div className="text-[0.72rem] text-muted truncate">
          {excluded.length > 0 ? `Excluding ${excluded.join(', ')}` : 'All payment methods'}
        </div>
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

      <p className="text-[0.7rem] text-muted">
        Estimates sum the net profit of all premium closed orders in each window after trade costs.
      </p>
    </div>
  );
}
