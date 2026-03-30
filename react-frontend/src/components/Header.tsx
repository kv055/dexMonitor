import type { Stats } from '../types';
import { KpiGrid } from './KpiGrid';

export type Tab = 'monitor' | 'insights' | 'mmcontroller' | 'trading';

interface Props {
  stats: Stats | null;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
}

const tabs: { id: Tab; label: string; color: string; disabled: boolean }[] = [
  { id: 'monitor', label: 'dex Monitor', color: 'text-accent', disabled: false },
  { id: 'insights', label: 'dex Insights', color: 'text-blue', disabled: false },
  { id: 'mmcontroller', label: 'dex Mm Controller', color: 'text-green', disabled: false },
  { id: 'trading', label: 'dex Trading', color: 'text-purple', disabled: true },
];

export function Header({ stats, activeTab, onTabChange }: Props) {
  return (
    <header className="bg-surface border border-border rounded-lg px-3 py-1 flex items-center gap-4 shrink-0">
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => !tab.disabled && onTabChange(tab.id)}
          disabled={tab.disabled}
          title={tab.disabled ? 'Coming soon' : undefined}
          className={`text-[0.9rem] font-semibold whitespace-nowrap pl-2.5 bg-transparent border-none
            ${tab.disabled ? `opacity-40 cursor-not-allowed ${tab.color}` : `cursor-pointer ${tab.color}`}
            ${tab.id === activeTab && !tab.disabled ? 'opacity-100' : !tab.disabled ? 'opacity-60 hover:opacity-85' : ''}
          `}
          style={{ borderLeft: '1px solid var(--color-border)' }}
        >
          {tab.label}
        </button>
      ))}

      {stats && activeTab === 'monitor' && <KpiGrid stats={stats} />}

      <div className="ml-auto" />

      <button
        className="bg-transparent border border-border rounded-md text-text text-base px-1.5 py-0.5 opacity-40 cursor-not-allowed shrink-0"
        disabled
        title="Theme — coming soon"
      >
        🌙
      </button>
      <button
        className="bg-transparent border border-border rounded-md text-text text-base px-1.5 py-0.5 opacity-40 cursor-not-allowed shrink-0"
        disabled
        title="Settings — coming soon"
      >
        ⚙️
      </button>
    </header>
  );
}
