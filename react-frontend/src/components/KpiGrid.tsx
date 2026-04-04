import type { Stats } from '../types';
import { ExchangeTag } from './ExchangeTag';
import { formatNum } from '../utils/formatters';

interface Props {
  stats: Stats;
}

export function KpiGrid({ stats }: Props) {
  return (
    <div className="flex flex-nowrap items-center gap-4 overflow-x-auto">
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
