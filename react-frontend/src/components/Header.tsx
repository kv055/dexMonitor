
import { usePreferences } from '../hooks/usePreferences';
import { useAuth } from '../hooks/useAuth';

export type Tab = 'insights' | 'mmcontroller' | 'trading' | 'statistics';

interface Props {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  onOpenSettings: () => void;
  /** WS connected to /ws/live_offers (true) or running on the polling fallback (false). */
  wssConnected: boolean;
  /** Last live-offers poll failure — data on screen may be stale until it clears. */
  pollError: string | null;
}

function LiveStatusBadge({ wssConnected, pollError }: { wssConnected: boolean; pollError: string | null }) {
  const status = wssConnected
    ? { dot: 'bg-green', label: 'live', title: 'Live offers streaming over WebSocket' }
    : pollError
      ? { dot: 'bg-red', label: 'stale', title: `Live offers unavailable — showing last known data. ${pollError}` }
      : { dot: 'bg-peach', label: 'polling', title: 'WebSocket unavailable — refreshing live offers every 15s' };
  return (
    <span
      className="hidden sm:flex items-center gap-1 text-[0.7rem] font-mono opacity-70 whitespace-nowrap px-1.5"
      title={status.title}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${status.dot}`} />
      {status.label}
    </span>
  );
}

const tabs: { id: Tab; label: string; color: string; disabled: boolean }[] = [
  { id: 'insights', label: 'dex Insights', color: 'text-blue', disabled: false },
  { id: 'mmcontroller', label: 'dex Mm Controller', color: 'text-green', disabled: false },
  { id: 'trading', label: 'Trading Accounts', color: 'text-purple', disabled: false },
  { id: 'statistics', label: 'Statistics', color: 'text-peach', disabled: false },
];

export function Header({ activeTab, onTabChange, onOpenSettings, wssConnected, pollError }: Props) {
  const { theme, toggleTheme } = usePreferences();
  const { username, logout } = useAuth();

  return (
    <header className="bg-surface border border-border rounded-lg px-2 py-1.5 sm:px-3 sm:py-1 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-1.5 shrink-0 min-w-0">
      <div className="flex items-center justify-between gap-2 sm:contents">
        <img
          src={theme === 'dark' ? '/brand/mark-dark.svg' : '/brand/mark-light.svg'}
          alt="dexArbPendulum"
          className="h-7 w-auto shrink-0 sm:order-1 sm:h-8"
        />

        <div className="flex items-center gap-1 shrink-0 sm:order-3">
          <LiveStatusBadge wssConnected={wssConnected} pollError={pollError} />
          <span
            className="hidden md:inline text-[0.7rem] font-mono opacity-60 whitespace-nowrap px-1.5"
            title={__COMMIT_DATE__ ? `Deployed commit ${__COMMIT_HASH__} (${new Date(__COMMIT_DATE__).toLocaleString()})` : `Deployed commit ${__COMMIT_HASH__}`}
          >
            {__COMMIT_HASH__}
            {__COMMIT_DATE__ && (
              <span className="ml-1 opacity-80">
                {new Date(__COMMIT_DATE__).toLocaleString(undefined, {
                  year: '2-digit', month: '2-digit', day: '2-digit',
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            )}
          </span>
          <a
            href="/grafana/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[0.8rem] sm:text-[0.9rem] font-semibold whitespace-nowrap px-2 sm:px-2.5 py-0.5 rounded text-peach opacity-60 hover:opacity-100 no-underline"
            style={{ borderLeft: '1px solid var(--color-border)' }}
            title="Open Grafana metrics dashboard"
          >
            Metrics
          </a>
          <button
            type="button"
            className="bg-transparent border border-border rounded-md text-text text-base px-1.5 py-0.5 cursor-pointer hover:bg-bg"
            onClick={toggleTheme}
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
          <button
            type="button"
            className="bg-transparent border border-border rounded-md text-text text-base px-1.5 py-0.5 cursor-pointer hover:bg-bg"
            onClick={() => { void logout(); }}
            title={username ? `Log out (${username})` : 'Log out'}
          >
            🚪
          </button>
        </div>
      </div>

      <nav
        aria-label="Dashboard sections"
        className="flex items-center overflow-x-auto w-full min-w-0 gap-0.5 sm:order-2 sm:flex-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {tabs.map(tab => (
          <button
            type="button"
            key={tab.id}
            onClick={() => !tab.disabled && onTabChange(tab.id)}
            disabled={tab.disabled}
            title={tab.disabled ? 'Coming soon' : undefined}
            className={`text-[0.78rem] sm:text-[0.9rem] font-semibold whitespace-nowrap px-2 sm:px-2.5 py-0.5 border-none rounded transition-colors shrink-0
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
      </nav>
    </header>
  );
}
