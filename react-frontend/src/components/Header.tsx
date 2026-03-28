import type { Stats, Offer } from '../types';
import { KpiGrid } from './KpiGrid';

interface Props {
  stats: Stats | null;
  offers: Offer[];
  lastUpdated: string;
}

export function Header({ stats, offers, lastUpdated }: Props) {
  return (
    <header className="bg-surface border-b border-border px-4 py-1.5 flex items-center gap-4">
      <h1 className="text-[0.9rem] font-semibold whitespace-nowrap border-l border-border pl-2.5 text-accent">dex Monitor</h1>
      <h1 className="text-[0.9rem] font-semibold whitespace-nowrap border-l border-border pl-2.5 text-blue">dex Insights</h1>
      <h1 className="text-[0.9rem] font-semibold whitespace-nowrap border-l border-border pl-2.5 text-green">dex Mm Controller</h1>
      <h1 className="text-[0.9rem] font-semibold whitespace-nowrap border-l border-border pl-2.5 text-purple">dex Trading</h1>

      {stats && <KpiGrid stats={stats} offers={offers} />}

      <span className="ml-auto text-[0.7rem] text-muted whitespace-nowrap">{lastUpdated}</span>

      <button
        className="bg-transparent border border-border rounded-md text-text text-base px-1.5 py-0.5 opacity-40 cursor-not-allowed flex-shrink-0"
        disabled
        title="Theme — coming soon"
      >
        🌙
      </button>
      <button
        className="bg-transparent border border-border rounded-md text-text text-base px-1.5 py-0.5 opacity-40 cursor-not-allowed flex-shrink-0"
        disabled
        title="Settings — coming soon"
      >
        ⚙️
      </button>
    </header>
  );
}
