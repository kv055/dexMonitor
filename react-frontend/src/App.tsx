import { useState, useEffect, useMemo, useLayoutEffect } from 'react';
import { useDashboard } from './hooks/useDashboard';
import { useLiveOffers } from './hooks/useLiveOffers';
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
import { MmTransactionsLog } from './components/MmTransactionsLog';
import { TakerOpportunities } from './components/TakerOpportunities';

type ThemeMode = 'dark' | 'light';
type PaymentMethodMode = 'neutral' | 'include' | 'exclude';

const PAYMENT_METHODS = ['SEPA', 'Revolut', 'Wise', 'Zelle', 'PayPal', 'Cash App'] as const;

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
function MonitorView({ ohlcData, lastUpdated, error, load, extendOhlc, stats, refreshForCex, excludedPaymentMethods }: {
  ohlcData: ReturnType<typeof useDashboard>['ohlcData'];
  stats: ReturnType<typeof useDashboard>['stats'] | null;
  lastUpdated: string;
  error: string | null;
  load: (hours: string, cex?: string, excludedPaymentMethods?: string[]) => void;
  extendOhlc: (hours: number, cex?: string) => void;
  refreshForCex: (cex: string) => void;
  excludedPaymentMethods: string[];
}) {
  const { filters } = useFilters();

  useEffect(() => {
    refreshForCex(filters.cex);
    load(filters.hours, filters.cex, excludedPaymentMethods);
    const interval = setInterval(() => load(filters.hours, filters.cex, excludedPaymentMethods), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [filters.hours, filters.cex, excludedPaymentMethods, load, refreshForCex]);

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
          <ControlPanel onRefresh={() => load(filters.hours, filters.cex, excludedPaymentMethods)} lastUpdated={lastUpdated} stats={stats} />
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

function InsightsView({ theme, pastOrderStats, loading, load, excludedPaymentMethods }: {
  theme: ThemeMode;
  pastOrderStats: ReturnType<typeof useDashboard>['pastOrderStats'];
  loading: boolean;
  load: (hours: string, cex?: string, excludedPaymentMethods?: string[]) => void;
  excludedPaymentMethods: string[];
}) {
  const { filters } = useFilters();

  useEffect(() => {
    load(filters.hours, filters.cex, excludedPaymentMethods);
  }, [filters.hours, filters.cex, excludedPaymentMethods, load]);

  return (
    <div className="flex-1 lg:min-h-0 flex flex-col gap-2 sm:gap-3">
      {/* Top — statistics */}
      <div className="lg:flex-1 bg-surface border border-border rounded-lg px-2 py-2 flex flex-col min-h-40 lg:min-h-0">
        <span className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted mb-1.5">General Statistics</span>
        <div className="flex-1 min-h-0">
          <GeneralStats theme={theme} />
        </div>
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
  const { pastOffers, stats, pastOrderStats, ohlcData, lastUpdated, error, loading, load, extendOhlc } = useDashboard();
  const { liveOffers, refreshForCex } = useLiveOffers();
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

  const excludedPaymentMethods = useMemo(
    () => Object.entries(paymentMethodModes)
      .filter(([, mode]) => mode === 'exclude')
      .map(([method]) => method),
    [paymentMethodModes]
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
            extendOhlc={extendOhlc}
            refreshForCex={refreshForCex}
            excludedPaymentMethods={excludedPaymentMethods}
          />
        )}

        {activeTab === 'mmcontroller' && (
          <MmControllerView />
        )}

        {activeTab === 'insights' && (
          <InsightsView
            theme={theme}
            pastOrderStats={pastOrderStats}
            loading={loading}
            load={load}
            excludedPaymentMethods={excludedPaymentMethods}
          />
        )}
      </div>
    </FiltersProvider>
  );
}
