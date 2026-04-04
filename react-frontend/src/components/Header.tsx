import type { Stats } from '../types';
import { KpiGrid } from './KpiGrid';

export type Tab = 'monitor' | 'insights' | 'mmcontroller' | 'trading';

interface Props {
  stats: Stats | null;
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onOpenSettings: () => void;
}

const tabs: { id: Tab; label: string; color: string; disabled: boolean }[] = [
  { id: 'monitor', label: 'dex Monitor', color: 'text-accent', disabled: false },
  { id: 'insights', label: 'dex Insights', color: 'text-blue', disabled: false },
  { id: 'mmcontroller', label: 'dex Mm Controller', color: 'text-green', disabled: false },
  { id: 'trading', label: 'dex Trading', color: 'text-purple', disabled: true },
];

export function Header({ stats, activeTab, onTabChange, theme, onToggleTheme, onOpenSettings }: Props) {
  return (
    <header className="bg-surface border border-border rounded-lg px-3 py-1 flex items-center gap-1.5 shrink-0 min-w-0 overflow-hidden">
      {/* Scrollable tab area */}
      <div className="flex items-center overflow-x-auto flex-1 min-w-0 gap-1">
        {tabs.map(tab => (
          <button
            type="button"
            key={tab.id}
            onClick={() => !tab.disabled && onTabChange(tab.id)}
            disabled={tab.disabled}
            title={tab.disabled ? 'Coming soon' : undefined}
            className={`text-[0.9rem] font-semibold whitespace-nowrap px-2.5 py-0.5 border-none rounded transition-colors shrink-0
              ${tab.disabled ? `opacity-40 cursor-not-allowed ${tab.color} bg-transparent` : `cursor-pointer ${tab.color}`}
              ${tab.id === activeTab && !tab.disabled
                ? `opacity-100 ${theme === 'dark' ? 'bg-white/20' : 'bg-black/15'}`
                : !tab.disabled ? 'opacity-60 hover:opacity-85 bg-transparent' : ''}
            `}
            style={{ borderLeft: '1px solid var(--color-border)' }}
          >
            {tab.label}
          </button>
        ))}

        {stats && activeTab === 'monitor' && (
          <div className="hidden lg:flex items-center">
            <KpiGrid stats={stats} />
          </div>
        )}
      </div>

      {/* Always-visible action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          className="bg-transparent border border-border rounded-md text-text text-base px-1.5 py-0.5 cursor-pointer hover:bg-bg"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to day mode' : 'Switch to night mode'}
        >
          {theme === 'dark' ? '🌞' : '🌙'}
        </button>
        <button
          type="button"
          className="bg-transparent border border-border rounded-md text-text text-base px-1.5 py-0.5 cursor-pointer hover:bg-bg"
          onClick={onOpenSettings}
          title="Settings"
        >
          ⚙️
        </button>
      </div>
    </header>
  );
}
