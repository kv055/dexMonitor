import { useEffect, useMemo, useState } from 'react';
import { useDashboard } from './hooks/useDashboard';
import { useLiveOffers } from './hooks/useLiveOffers';
import { usePaymentMethodGroups } from './hooks/usePaymentMethodGroups';
import { FiltersProvider } from './context/FiltersContext';
import { TimezoneProvider } from './context/TimezoneContext';
import { PreferencesProvider } from './context/PreferencesContext';
import { useFilters } from './hooks/useFilters';
import { usePreferences } from './hooks/usePreferences';
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
import { TradingAccountsPanel } from './components/TradingAccountsPanel';

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
function MonitorView({ ohlcData, lastUpdatedAt, error, loadCore, extendOhlc, refreshForCex, allowOhlcExtend }: {
  ohlcData: ReturnType<typeof useDashboard>['ohlcData'];
  lastUpdatedAt: string;
  error: string | null;
  loadCore: (hours: string, cex?: string, excludedPaymentMethods?: string[], excludedCEXes?: string[], feeTier?: string, coupledHedge?: boolean, maxFiatLimit?: number | null) => void;
  extendOhlc: (hours: number, cex?: string, intervalMin?: number) => void;
  refreshForCex: (cex: string, excludedCEXes?: string[], feeTier?: string, coupledHedge?: boolean, maxFiatLimit?: number | null) => void;
  allowOhlcExtend: boolean;
}) {
  const { filters } = useFilters();
  const { excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit } = usePreferences();

  useEffect(() => {
    refreshForCex(filters.cex, excludedCEXes, feeTier, coupledHedge, maxFiatLimit);
    loadCore(filters.hours, filters.cex, excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit);
    const interval = setInterval(() => loadCore(filters.hours, filters.cex, excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [filters.hours, filters.cex, excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit, loadCore, refreshForCex]);

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
          <ControlPanel onRefresh={() => loadCore(filters.hours, filters.cex, excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit)} lastUpdatedAt={lastUpdatedAt} />
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
              allowExtend={allowOhlcExtend}
              onNeedMoreData={(hours, intervalMin) => extendOhlc(hours, filters.cex, intervalMin)}
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

function InsightsView({ pastOrderStats, pastOrderStatsAll, pastOrderStatsNetCapped, pastOrderStatsAllNetCapped, pastProfitableOrders, pastProfitableOrdersAll, pastProfitableOrdersNetCapped, pastProfitableOrdersAllNetCapped, generalStats, loading, load }: {
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
}) {
  const { filters } = useFilters();
  const { excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit } = usePreferences();

  useEffect(() => {
    load(filters.hours, filters.cex, excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit);
  }, [filters.hours, filters.cex, excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit, load]);

  return (
    <div className="flex-1 lg:min-h-0 flex flex-col gap-2 sm:gap-3">
      {/* Top — statistics */}
      <div className="lg:flex-none bg-surface border border-border rounded-lg px-2 py-1.5">
        <span className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted mb-1 block">General Statistics</span>
        <GeneralStats stats={generalStats} loading={loading} />
      </div>
      <div className="lg:flex-1 bg-surface border border-border rounded-lg p-3 flex flex-col min-h-40 lg:min-h-0">
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
    </div>
  );
}

function TradingView() {
  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3 overflow-hidden">
      <TradingAccountsPanel />
      <div className="min-h-0 rounded-lg border border-border bg-surface p-3 flex flex-col">
        <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted">Trade Flow Monitor</h3>
        <div className="flex flex-1 items-center justify-center text-sm text-muted">
          comming soon
        </div>
      </div>
    </div>
  );
}

function AppShell() {
  const {
    pastOffers,
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
    analyticsLoading,
    load,
    loadCore,
    extendOhlc,
    initialLoadComplete,
  } = useDashboard();
  const { liveOffers, refreshForCex } = useLiveOffers();
  const { groups } = usePaymentMethodGroups();
  const { preferredTimezone, excludedMethods } = usePreferences();
  const [activeTab, setActiveTab] = useState<Tab>('monitor');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const allOffers = useMemo(() => {
    const seen = new Set<number>();
    return [...liveOffers, ...pastOffers].filter(o => {
      if (seen.has(o.id)) return false;
      seen.add(o.id);
      return true;
    });
  }, [liveOffers, pastOffers]);

  return (
    <TimezoneProvider timezone={preferredTimezone}>
      <FiltersProvider offers={allOffers} loading={loading} groups={groups} excludedMethods={excludedMethods}>
      <div className="h-screen overflow-hidden flex flex-col bg-bg text-text p-2 sm:p-3 gap-2 sm:gap-3">
        <Header
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        <SettingsOverlay
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          groups={groups}
        />

        {activeTab === 'monitor' && (
          <MonitorView
            ohlcData={ohlcData}
            lastUpdatedAt={lastUpdatedAt}
            error={error}
            loadCore={loadCore}
            extendOhlc={extendOhlc}
            refreshForCex={refreshForCex}
            allowOhlcExtend={initialLoadComplete}
          />
        )}

        {activeTab === 'mmcontroller' && (
          <MmControllerView />
        )}

        {activeTab === 'insights' && (
          <InsightsView
            pastOrderStats={pastOrderStats}
            pastOrderStatsAll={pastOrderStatsAll}
            pastOrderStatsNetCapped={pastOrderStatsNetCapped}
            pastOrderStatsAllNetCapped={pastOrderStatsAllNetCapped}
            pastProfitableOrders={pastProfitableOrders}
            pastProfitableOrdersAll={pastProfitableOrdersAll}
            pastProfitableOrdersNetCapped={pastProfitableOrdersNetCapped}
            pastProfitableOrdersAllNetCapped={pastProfitableOrdersAllNetCapped}
            generalStats={generalStats}
            loading={analyticsLoading}
            load={load}
          />
        )}

        {activeTab === 'trading' && (
          <TradingView />
        )}
      </div>
      </FiltersProvider>
    </TimezoneProvider>
  );
}

export default function App() {
  return (
    <PreferencesProvider>
      <AppShell />
    </PreferencesProvider>
  );
}
