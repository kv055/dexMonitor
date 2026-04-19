import { useState, useEffect, useMemo, useLayoutEffect } from 'react';
import { useDashboard } from './hooks/useDashboard';
import { useLiveOffers } from './hooks/useLiveOffers';
import { usePaymentMethodGroups } from './hooks/usePaymentMethodGroups';
import { useTradeCostConfig } from './hooks/useTradeCostConfig';
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
function MonitorView({ ohlcData, lastUpdatedAt, error, load, extendOhlc, stats, refreshForCex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit }: {
  ohlcData: ReturnType<typeof useDashboard>['ohlcData'];
  stats: ReturnType<typeof useDashboard>['stats'] | null;
  lastUpdatedAt: string;
  error: string | null;
  load: (hours: string, cex?: string, excludedPaymentMethods?: string[], excludedCEXes?: string[], feeTier?: string, coupledHedge?: boolean, maxFiatLimit?: number | null) => void;
  extendOhlc: (hours: number, cex?: string) => void;
  refreshForCex: (cex: string, excludedCEXes?: string[], feeTier?: string, coupledHedge?: boolean, maxFiatLimit?: number | null) => void;
  excludedPaymentMethods: string[];
  excludedCEXes: string[];
  feeTier: string;
  coupledHedge: boolean;
  maxFiatLimit: number | null;
}) {
  const { filters } = useFilters();

  useEffect(() => {
    refreshForCex(filters.cex, excludedCEXes, feeTier, coupledHedge, maxFiatLimit);
    load(filters.hours, filters.cex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit);
    const interval = setInterval(() => load(filters.hours, filters.cex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [filters.hours, filters.cex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit, load, refreshForCex]);

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
          <ControlPanel onRefresh={() => load(filters.hours, filters.cex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit)} lastUpdatedAt={lastUpdatedAt} stats={stats} />
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

function InsightsView({ theme, pastOrderStats, pastOrderStatsAll, pastOrderStatsNetCapped, pastOrderStatsAllNetCapped, pastProfitableOrders, pastProfitableOrdersAll, pastProfitableOrdersNetCapped, pastProfitableOrdersAllNetCapped, generalStats, loading, load, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit }: {
  theme: ThemeMode;
  pastOrderStats: ReturnType<typeof useDashboard>['pastOrderStats'];
  pastOrderStatsAll: ReturnType<typeof useDashboard>['pastOrderStatsAll'];
  pastOrderStatsNetCapped: ReturnType<typeof useDashboard>['pastOrderStatsNetCapped'];
  pastOrderStatsAllNetCapped: ReturnType<typeof useDashboard>['pastOrderStatsAllNetCapped'];
  pastProfitableOrders: ReturnType<typeof useDashboard>['pastProfitableOrders'];
  pastProfitableOrdersAll: ReturnType<typeof useDashboard>['pastProfitableOrdersAll'];
  pastProfitableOrdersNetCapped: ReturnType<typeof useDashboard>['pastProfitableOrdersNetCapped'];
  pastProfitableOrdersAllNetCapped: ReturnType<typeof useDashboard>['pastProfitableOrdersAllNetCapped'];
  generalStats: ReturnType<typeof useDashboard>['generalStats'];
  loading: boolean;
  load: (hours: string, cex?: string, excludedPaymentMethods?: string[], excludedCEXes?: string[], feeTier?: string, coupledHedge?: boolean, maxFiatLimit?: number | null) => void;
  excludedPaymentMethods: string[];
  excludedCEXes: string[];
  feeTier: string;
  coupledHedge: boolean;
  maxFiatLimit: number | null;
}) {
  const { filters } = useFilters();

  useEffect(() => {
    load(filters.hours, filters.cex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit);
  }, [filters.hours, filters.cex, excludedPaymentMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit, load]);

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
        <TakerOpportunities
          stats={pastOrderStats}
          statsAll={pastOrderStatsAll}
          statsNetCapped={pastOrderStatsNetCapped}
          statsAllNetCapped={pastOrderStatsAllNetCapped}
          orders={pastProfitableOrders}
          ordersAll={pastProfitableOrdersAll}
          ordersNetCapped={pastProfitableOrdersNetCapped}
          ordersAllNetCapped={pastProfitableOrdersAllNetCapped}
          loading={loading}
          maxFiatLimit={maxFiatLimit}
        />
      </div>
      {/* Bottom — bigger */}
      <div className="lg:flex-2 bg-surface border border-border rounded-lg p-3 flex flex-col min-h-40 lg:min-h-0">
        <span className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted mb-2">Maker Opportunities</span>
      </div>
    </div>
  );
}

export default function App() {
  const {
    pastOffers,
    stats,
    pastOrderStats,
    pastOrderStatsAll,
    pastOrderStatsNetCapped,
    pastOrderStatsAllNetCapped,
    pastProfitableOrders,
    pastProfitableOrdersAll,
    pastProfitableOrdersNetCapped,
    pastProfitableOrdersAllNetCapped,
    generalStats,
    ohlcData,
    lastUpdatedAt,
    error,
    loading,
    load,
    extendOhlc,
  } = useDashboard();
  const { liveOffers, refreshForCex } = useLiveOffers();
  const { groups } = usePaymentMethodGroups();
  const { config: tradeCostConfig } = useTradeCostConfig();
  const [activeTab, setActiveTab] = useState<Tab>('monitor');
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [preferredTimezone, setPreferredTimezone] = useState(() => localStorage.getItem('dex-timezone') || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [excludedMethods, setExcludedMethods] = useState<string[]>(
    () => JSON.parse(localStorage.getItem('dex-excluded-payment-methods') || '[]')
  );
  const [excludedCEXes, setExcludedCEXes] = useState<string[]>(
    () => JSON.parse(localStorage.getItem('dex-excluded-cexes') || '[]')
  );
  const [feeTier, setFeeTier] = useState<string>(
    () => localStorage.getItem('dex-fee-tier') || ''
  );
  const [coupledHedge, setCoupledHedge] = useState<boolean>(
    () => localStorage.getItem('dex-coupled-hedge') !== 'false'
  );
  const [maxFiatLimit, setMaxFiatLimit] = useState<number | null>(() => {
    const v = localStorage.getItem('dex-max-fiat-limit');
    return v ? Number(v) : null;
  });

  const allOffers = useMemo(() => {
    const seen = new Set<number>();
    return [...liveOffers, ...pastOffers].filter(o => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });
  }, [liveOffers, pastOffers]);

  const excludedPaymentMethods = excludedMethods;

  useEffect(() => {
    localStorage.setItem('dex-excluded-payment-methods', JSON.stringify(excludedMethods));
  }, [excludedMethods]);

  useEffect(() => {
    localStorage.setItem('dex-excluded-cexes', JSON.stringify(excludedCEXes));
  }, [excludedCEXes]);

  useEffect(() => {
    localStorage.setItem('dex-fee-tier', feeTier);
  }, [feeTier]);

  useEffect(() => {
    localStorage.setItem('dex-coupled-hedge', String(coupledHedge));
  }, [coupledHedge]);

  useEffect(() => {
    localStorage.setItem('dex-max-fiat-limit', maxFiatLimit != null ? String(maxFiatLimit) : '');
  }, [maxFiatLimit]);

  const handleToggleCEX = (cex: string) => {
    setExcludedCEXes(prev =>
      prev.includes(cex) ? prev.filter(c => c !== cex) : [...prev, cex]
    );
  };

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
          groups={groups}
          excludedMethods={excludedMethods}
          onToggleMethod={handleToggleMethod}
          onToggleGroup={handleToggleGroup}
          tradeCostConfig={tradeCostConfig}
          excludedCEXes={excludedCEXes}
          onToggleCEX={handleToggleCEX}
          feeTier={feeTier}
          onFeeTierChange={setFeeTier}
          coupledHedge={coupledHedge}
          onCoupledHedgeChange={setCoupledHedge}
          maxFiatLimit={maxFiatLimit}
          onMaxFiatLimitChange={setMaxFiatLimit}
        />

        {activeTab === 'monitor' && (
          <MonitorView
            ohlcData={ohlcData}
            stats={stats}
            lastUpdatedAt={lastUpdatedAt}
            error={error}
            load={load}
            extendOhlc={extendOhlc}
            refreshForCex={refreshForCex}
            excludedPaymentMethods={excludedPaymentMethods}
            excludedCEXes={excludedCEXes}
            feeTier={feeTier}
            coupledHedge={coupledHedge}
            maxFiatLimit={maxFiatLimit}
          />
        )}

        {activeTab === 'mmcontroller' && (
          <MmControllerView />
        )}

        {activeTab === 'insights' && (
          <InsightsView
            theme={theme}
            pastOrderStats={pastOrderStats}
            pastOrderStatsAll={pastOrderStatsAll}
            pastOrderStatsNetCapped={pastOrderStatsNetCapped}
            pastOrderStatsAllNetCapped={pastOrderStatsAllNetCapped}
            pastProfitableOrders={pastProfitableOrders}
            pastProfitableOrdersAll={pastProfitableOrdersAll}
            pastProfitableOrdersNetCapped={pastProfitableOrdersNetCapped}
            pastProfitableOrdersAllNetCapped={pastProfitableOrdersAllNetCapped}
            generalStats={generalStats}
            loading={loading}
            load={load}
            excludedPaymentMethods={excludedPaymentMethods}
            excludedCEXes={excludedCEXes}
            feeTier={feeTier}
            coupledHedge={coupledHedge}
            maxFiatLimit={maxFiatLimit}
          />
        )}
      </div>
      </FiltersProvider>
    </TimezoneProvider>
  );
}
