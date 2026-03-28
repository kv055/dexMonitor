import type { Stats, Offer } from '../types';
import { ExchangeTag } from './ExchangeTag';
import { formatNum, premiumClass } from '../utils/formatters';

interface Props {
  stats: Stats;
  offers: Offer[];
}

export function KpiGrid({ stats, offers }: Props) {
  const totalOffers = stats.offer_counts.reduce((s, e) => s + e.offer_count, 0);
  const avgPremium = offers.length
    ? (offers.reduce((s, o) => s + (o.price_diff_percent || 0), 0) / offers.length).toFixed(1)
    : '—';

  return (
    <div className="flex flex-nowrap flex-1 justify-between items-center">
      <div className="flex flex-col border-l border-border pl-2.5 flex-1">
        <span className="text-[0.6rem] text-muted uppercase tracking-wide">Total Offers</span>
        <span className="text-[0.8rem] font-bold leading-tight">{totalOffers}</span>
        <span className="text-[0.6rem] text-muted flex gap-1 flex-wrap">
          {stats.offer_counts.map(e => (
            <span key={e.exchange} className="flex items-center gap-1">
              <ExchangeTag exchange={e.exchange} /> {e.offer_count}
            </span>
          ))}
        </span>
      </div>

      {stats.price_stats.map(ps => (
        <div key={ps.exchange} className="flex flex-col border-l border-border pl-2.5 flex-1">
          <span className="text-[0.6rem] text-muted uppercase tracking-wide flex items-center gap-1">
            <ExchangeTag exchange={ps.exchange} /> BTC
          </span>
          <span className="text-[0.8rem] font-bold leading-tight">€{formatNum(ps.avg_price)}</span>
          <span className="text-[0.6rem] text-muted">€{formatNum(ps.min_price)} – €{formatNum(ps.max_price)}</span>
        </div>
      ))}

      <div className="flex flex-col border-l border-border pl-2.5 flex-1">
        <span className="text-[0.6rem] text-muted uppercase tracking-wide">Avg Premium</span>
        <span className={`text-[0.8rem] font-bold leading-tight ${premiumClass(parseFloat(avgPremium))}`}>
          {avgPremium}%
        </span>
      </div>
    </div>
  );
}
