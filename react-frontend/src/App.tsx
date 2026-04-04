import { useState, useEffect, useMemo, useLayoutEffect } from 'react';
import { useDashboard } from './hooks/useDashboard';
import { useLiveOffers } from './hooks/useLiveOffers';
import { useKrakenPrice } from './hooks/useKrakenPrice';
import { FiltersProvider, useFilters } from './context/FiltersContext';
import { Header } from './components/Header';
import type { Tab } from './components/Header';
import { SettingsOverlay } from './components/SettingsOverlay';
import { ControlPanel } from './components/ControlPanel';
import { OffersPreviewTable } from './components/OffersPreviewTable';
import { OHLCChart } from './components/OHLCChart';
import { DepthChart } from './components/DepthChart';
import { GeneralStats } from './components/GeneralStats';
import { SnapshotLog } from './components/SnapshotLog';

type ThemeMode = 'dark' | 'light';
type PaymentMethodMode = 'neutral' | 'include' | 'exclude';

const PAYMENT_METHODS = ['SEPA', 'Revolut', 'Wise', 'Zelle', 'PayPal', 'Cash App'] as const;

function getInitialTheme(): ThemeMode {
  const stored = localStorage.getItem('dex-theme');
  return stored === 'light' ? 'light' : 'dark';
}

function OhlcPanelHeader() {
  const price = useKrakenPrice();
  return (
    <div className="flex items-center justify-between mb-2 shrink-0">
      <h3 className="text-[0.85rem] text-muted">DEX Premium Offer Overlay</h3>
      <div className="flex items-center gap-1.5 text-[0.75rem]">
        <span className="text-muted">BTC/EUR</span>
        <span className={price != null ? 'text-text font-medium' : 'text-muted'}>
          {price != null ? `€${price.toLocaleString('de-DE', { maximumFractionDigits: 0 })}` : '—'}
        </span>
      </div>
    </div>
  );
}

// Inner component so it can consume FiltersContext
function MonitorView({ ohlcData, lastUpdated, error, load, stats }: {
  ohlcData: ReturnType<typeof useDashboard>['ohlcData'];
  stats: ReturnType<typeof useDashboard>['stats'] | null;
  lastUpdated: string;
  error: string | null;
  load: (hours: string) => void;
}) {
  const { filters } = useFilters();

  useEffect(() => {
    load(filters.hours);
    const interval = setInterval(() => load(filters.hours), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [filters.hours]);

  return (
    <div className="flex-1 lg:min-h-0 flex flex-col gap-2 sm:gap-3">
      {error && (
        <div className="bg-error border border-red rounded-lg px-3 py-2 text-red text-sm shrink-0">
          {error}
        </div>
      )}

      {/* Top row: control panel + offers */}
      <div className="lg:flex-2 lg:min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-2 sm:gap-3">
        <div className="bg-surface border border-border rounded-lg p-3 flex flex-col min-h-0">
          <h3 className="text-[0.85rem] text-muted mb-2 shrink-0">Control Panel</h3>
          <ControlPanel onRefresh={() => load(filters.hours)} lastUpdated={lastUpdated} stats={stats} />
        </div>

        <div className="bg-surface border border-border rounded-lg p-3 flex flex-col min-h-0 overflow-hidden">
          <h3 className="text-[0.85rem] text-muted mb-2 shrink-0">Offers</h3>
          <div className="relative flex-1 min-h-64 sm:min-h-80 lg:min-h-0">
            <OffersPreviewTable />
          </div>
        </div>
      </div>

      {/* Bottom row: OHLC chart + depth chart */}
      <div className="lg:flex-5 lg:min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-2 sm:gap-3">
        <div className="lg:col-span-2 bg-surface border border-border rounded-lg p-3 flex flex-col min-h-72 sm:min-h-80 lg:min-h-0">
          <OhlcPanelHeader />
          <div className="flex-1 min-h-0 relative">
            <OHLCChart data={ohlcData} />
          </div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3 flex flex-col min-h-56 sm:min-h-64 lg:min-h-0">
          <DepthChart />
        </div>
      </div>
    </div>
  );
}

function MmControllerView() {
  return (
    <div className="flex-1 lg:min-h-0 flex flex-col gap-2 sm:gap-3">
      <div className="grid grid-cols-1 gap-2 sm:gap-3 shrink-0">
        <div className="bg-surface border border-border rounded-lg p-3 flex flex-col">
          <h3 className="text-[0.85rem] text-muted mb-2 shrink-0">Snapshot Log</h3>
          <div className="relative flex-1 min-h-52">
            <SnapshotLog />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { pastOffers, stats, ohlcData, lastUpdated, error, loading, load } = useDashboard();
  const { liveOffers } = useLiveOffers();
  const [activeTab, setActiveTab] = useState<Tab>('monitor');
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferredTimezone, setPreferredTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [paymentMethodModes, setPaymentMethodModes] = useState<Record<string, PaymentMethodMode>>(
    () => Object.fromEntries(PAYMENT_METHODS.map(method => [method, 'neutral']))
  );

  const allOffers = useMemo(
    () => [...liveOffers, ...pastOffers],
    [liveOffers, pastOffers]
  );

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dex-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <FiltersProvider offers={allOffers} loading={loading}>
      <div className="min-h-screen lg:h-screen lg:overflow-hidden flex flex-col bg-bg text-text p-2 sm:p-3 gap-2 sm:gap-3">
        <Header
          stats={stats}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <SettingsOverlay
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          preferredTimezone={preferredTimezone}
          onTimezoneChange={setPreferredTimezone}
          paymentMethodModes={paymentMethodModes}
          onPaymentMethodModeChange={(method, mode) => {
            setPaymentMethodModes(prev => ({ ...prev, [method]: mode }));
          }}
        />

        {activeTab === 'monitor' && (
          <MonitorView
            ohlcData={ohlcData}
            stats={stats}
            lastUpdated={lastUpdated}
            error={error}
            load={load}
          />
        )}

        {activeTab === 'mmcontroller' && (
          <MmControllerView />
        )}

        {activeTab === 'insights' && (
          <div className="flex-1 lg:min-h-0 flex flex-col gap-2 sm:gap-3">
            {/* Top — statistics */}
            <div className="lg:flex-1 bg-surface border border-border rounded-lg px-2 py-2 flex flex-col min-h-40 lg:min-h-0">
              <span className="text-[0.6rem] uppercase text-muted font-semibold tracking-wide mb-1.5">General Statistics</span>
              <div className="flex-1 min-h-0">
                <GeneralStats theme={theme} />
              </div>
            </div>
            {/* Middle — bigger */}
            <div className="lg:flex-2 bg-surface border border-border rounded-lg p-3 flex flex-col min-h-40 lg:min-h-0">
              <span className="text-[0.65rem] uppercase text-muted font-semibold tracking-wide mb-2">Taker Opportunities</span>
            </div>
            {/* Bottom — bigger */}
            <div className="lg:flex-2 bg-surface border border-border rounded-lg p-3 flex flex-col min-h-40 lg:min-h-0">
              <span className="text-[0.65rem] uppercase text-muted font-semibold tracking-wide mb-2">Maker Opportunities</span>
            </div>
          </div>
        )}
      </div>
    </FiltersProvider>
  );
}
