import type { Stats, Offer } from '../types';
import { ExchangeTag } from './ExchangeTag';
import { formatNum } from '../utils/formatters';

interface Props {
  stats: Stats;
  offers: Offer[];
}

export function KpiGrid({ stats, offers }: Props) {
  const totalOffers = stats.offer_counts.reduce((s, e) => s + e.offer_count, 0);
  return (
    <div className="flex flex-nowrap items-center gap-4 overflow-hidden">
      {/* Total Offers */}
      <div className="flex items-center gap-1.5 border-l border-border pl-2.5">
        <span className="text-[0.65rem] text-muted uppercase tracking-wide whitespace-nowrap">Offers</span>
        <span className="text-[0.75rem] font-bold">{totalOffers}</span>
        <span className="text-[0.6rem] text-muted flex gap-1">
          {stats.offer_counts.map(e => (
            <span key={e.exchange} className="flex items-center gap-0.5">
              <ExchangeTag exchange={e.exchange} />{e.offer_count}
            </span>
          ))}
        </span>
      </div>

      {/* Per-exchange price stats */}
      {stats.price_stats.map(ps => (
        <div key={ps.exchange} className="flex items-center gap-1.5 border-l border-border pl-2.5">
          <span className="text-[0.65rem] text-muted flex items-center gap-0.5 whitespace-nowrap">
            <ExchangeTag exchange={ps.exchange} />BTC
          </span>
          <span className="text-[0.75rem] font-bold whitespace-nowrap">€{formatNum(ps.avg_price)}</span>
          <span className="text-[0.6rem] text-muted whitespace-nowrap">€{formatNum(ps.min_price)}–€{formatNum(ps.max_price)}</span>
        </div>
      ))}
    </div>
  );
}
