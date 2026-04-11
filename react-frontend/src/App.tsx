import { useState, useEffect, useMemo, useLayoutEffect } from 'react';
import { useDashboard } from './hooks/useDashboard';
import { useLiveOffers } from './hooks/useLiveOffers';
import { usePaymentMethodGroups } from './hooks/usePaymentMethodGroups';
import { FiltersProvider, useFilters } from './context/FiltersContext';
import { TimezoneProvider } from './context/TimezoneContext';
import { Header } from './components/Header';
import type { Tab } from './components/Header';
import { SettingsOverlay } from './components/SettingsOverlay';
import { ControlPanel } from './components/ControlPanel';
import { OffersPreviewTable } from './components/OffersPreviewTable';
import { OHLCChart } from './components/OHLCChart';
import { DepthChart } from './components/DepthChart';
import { GeneralStats } from './components/GeneralStats';
import { SnapshotLog } from './components/SnapshotLog';
import { MmTransactionsLog } from './components/MmTransactionsLog';
import { TakerOpportunities } from './components/TakerOpportunities';

type ThemeMode = 'dark' | 'light';

function getInitialTheme(): ThemeMode {
  const stored = localStorage.getItem('dex-theme');
  return stored === 'light' ? 'light' : 'dark';
}

function OhlcPanelHeader() {
  const { refPrice, filters } = useFilters();
  const cexLabel = filters.cex.charAt(0).toUpperCase() + filters.cex.slice(1);
  return (
    <div className="flex items-center justify-between mb-2 shrink-0">
      <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted">DEX Premium Offer Overlay</h3>
      <div className="flex items-center gap-1.5 text-[0.75rem]">
        <span className="text-muted">BTC/EUR — {cexLabel}</span>
        <span className={refPrice != null ? 'text-text font-medium' : 'text-muted'}>
          {refPrice != null ? `€${refPrice.toLocaleString('de-DE', { maximumFractionDigits: 0 })}` : '—'}
        </span>
      </div>
    </div>
  );
}

// Inner component so it can consume FiltersContext
function MonitorView({ ohlcData, lastUpdatedAt, error, load, extendOhlc, stats, refreshForCex, excludedPaymentMethods, requiredConfirmations }: {
  ohlcData: ReturnType<typeof useDashboard>['ohlcData'];
  stats: ReturnType<typeof useDashboard>['stats'] | null;
  lastUpdatedAt: string;
  error: string | null;
  load: (hours: string, cex?: string, excludedPaymentMethods?: string[], confirmations?: number) => void;
  extendOhlc: (hours: number, cex?: string) => void;
  refreshForCex: (cex: string, confirmations: number) => void;
  excludedPaymentMethods: string[];
  requiredConfirmations: number;
}) {
  const { filters } = useFilters();

  useEffect(() => {
    refreshForCex(filters.cex, requiredConfirmations);
    load(filters.hours, filters.cex, excludedPaymentMethods, requiredConfirmations);
    const interval = setInterval(() => load(filters.hours, filters.cex, excludedPaymentMethods, requiredConfirmations), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [filters.hours, filters.cex, excludedPaymentMethods, load, refreshForCex, requiredConfirmations]);

  return (
    <div className="flex-1 lg:min-h-0 flex flex-col gap-2 sm:gap-3">
      {error && (
        <div className="bg-error border border-red rounded-lg px-3 py-2 text-red text-sm shrink-0">
          {error}
        </div>
      )}

      {/* Top row: control panel + offers */}
      <div className="lg:flex-2 lg:min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_3fr] gap-2 sm:gap-3">
        <div className="bg-surface border border-border rounded-lg p-3 flex flex-col min-h-0">
          <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted mb-2 shrink-0">Control Panel</h3>
          <ControlPanel onRefresh={() => load(filters.hours, filters.cex, excludedPaymentMethods, requiredConfirmations)} lastUpdatedAt={lastUpdatedAt} stats={stats} />
        </div>

        <div className="bg-surface border border-border rounded-lg p-3 flex flex-col min-h-0 overflow-hidden">
          <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted mb-2 shrink-0">Offers</h3>
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
              <OHLCChart
              data={ohlcData}
              loadedHours={Number(filters.hours)}
              onNeedMoreData={(hours) => extendOhlc(hours, filters.cex)}
            />
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
      <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 gap-2 sm:gap-3">
        <div className="bg-surface border border-border rounded-lg p-3 flex flex-col min-h-52 xl:min-h-0 overflow-hidden">
          <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted mb-2 shrink-0">Snapshot Log</h3>
          <div className="relative flex-1 min-h-0">
            <SnapshotLog />
          </div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3 flex flex-col min-h-52 xl:min-h-0 overflow-hidden">
          <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted mb-2 shrink-0">MM Controller Transactions</h3>
          <div className="relative flex-1 min-h-0">
            <MmTransactionsLog />
          </div>
        </div>
      </div>
    </div>
  );
}

function InsightsView({ theme, pastOrderStats, generalStats, loading, load, excludedPaymentMethods, requiredConfirmations }: {
  theme: ThemeMode;
  pastOrderStats: ReturnType<typeof useDashboard>['pastOrderStats'];
  generalStats: ReturnType<typeof useDashboard>['generalStats'];
  loading: boolean;
  load: (hours: string, cex?: string, excludedPaymentMethods?: string[], confirmations?: number) => void;
  excludedPaymentMethods: string[];
  requiredConfirmations: number;
}) {
  const { filters } = useFilters();

  useEffect(() => {
    load(filters.hours, filters.cex, excludedPaymentMethods, requiredConfirmations);
  }, [filters.hours, filters.cex, excludedPaymentMethods, load, requiredConfirmations]);

  return (
    <div className="flex-1 lg:min-h-0 flex flex-col gap-2 sm:gap-3">
      {/* Top — statistics */}
      <div className="lg:flex-none bg-surface border border-border rounded-lg px-2 py-1.5">
        <span className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted mb-1 block">General Statistics</span>
        <GeneralStats theme={theme} stats={generalStats} loading={loading} />
      </div>
      {/* Middle — bigger */}
      <div className="lg:flex-2 bg-surface border border-border rounded-lg p-3 flex flex-col min-h-40 lg:min-h-0">
        <span className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted mb-2">Taker Opportunities</span>
        <TakerOpportunities stats={pastOrderStats} loading={loading} />
      </div>
      {/* Bottom — bigger */}
      <div className="lg:flex-2 bg-surface border border-border rounded-lg p-3 flex flex-col min-h-40 lg:min-h-0">
        <span className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted mb-2">Maker Opportunities</span>
      </div>
    </div>
  );
}

export default function App() {
  const { pastOffers, stats, pastOrderStats, generalStats, ohlcData, lastUpdatedAt, error, loading, load, extendOhlc } = useDashboard();
  const { liveOffers, refreshForConfig } = useLiveOffers();
  const { groups } = usePaymentMethodGroups();
  const [activeTab, setActiveTab] = useState<Tab>('monitor');
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferredTimezone, setPreferredTimezone] = useState(() => localStorage.getItem('dex-timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [requiredConfirmations, setRequiredConfirmations] = useState<number>(() => {
    const raw = Number(localStorage.getItem('dex-required-confirmations') || '1');
    return Number.isFinite(raw) && raw >= 1 && raw <= 6 ? raw : 1;
  });
  const [excludedMethods, setExcludedMethods] = useState<string[]>(
    () => JSON.parse(localStorage.getItem('dex-excluded-payment-methods') || '[]')
  );

  const allOffers = useMemo(
    () => [...liveOffers, ...pastOffers],
    [liveOffers, pastOffers]
  );

  const excludedPaymentMethods = excludedMethods;

  useEffect(() => {
    localStorage.setItem('dex-excluded-payment-methods', JSON.stringify(excludedMethods));
  }, [excludedMethods]);

  const handleToggleMethod = (method: string) => {
    setExcludedMethods(prev =>
      prev.includes(method) ? prev.filter(m => m !== method) : [...prev, method]
    );
  };

  const handleToggleGroup = (groupMethods: string[], exclude: boolean) => {
    setExcludedMethods(prev => {
      const without = prev.filter(m => !groupMethods.includes(m));
      return exclude ? [...without, ...groupMethods] : without;
    });
  };

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('dex-theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('dex-timezone', preferredTimezone);
  }, [preferredTimezone]);

  useEffect(() => {
    localStorage.setItem('dex-required-confirmations', String(requiredConfirmations));
  }, [requiredConfirmations]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <TimezoneProvider timezone={preferredTimezone}>
      <FiltersProvider offers={allOffers} loading={loading} groups={groups} excludedMethods={excludedMethods}>
      <div className="min-h-screen lg:h-screen lg:overflow-hidden flex flex-col bg-bg text-text p-2 sm:p-3 gap-2 sm:gap-3">
        <Header
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
          requiredConfirmations={requiredConfirmations}
          onConfirmationsChange={setRequiredConfirmations}
          groups={groups}
          excludedMethods={excludedMethods}
          onToggleMethod={handleToggleMethod}
          onToggleGroup={handleToggleGroup}
        />

        {activeTab === 'monitor' && (
          <MonitorView
            ohlcData={ohlcData}
            stats={stats}
            lastUpdatedAt={lastUpdatedAt}
            error={error}
            load={load}
            extendOhlc={extendOhlc}
            refreshForCex={refreshForConfig}
            excludedPaymentMethods={excludedPaymentMethods}
            requiredConfirmations={requiredConfirmations}
          />
        )}

        {activeTab === 'mmcontroller' && (
          <MmControllerView />
        )}

        {activeTab === 'insights' && (
          <InsightsView
            theme={theme}
            pastOrderStats={pastOrderStats}
            generalStats={generalStats}
            loading={loading}
            load={load}
            excludedPaymentMethods={excludedPaymentMethods}
            requiredConfirmations={requiredConfirmations}
          />
        )}
      </div>
      </FiltersProvider>
    </TimezoneProvider>
  );
}
