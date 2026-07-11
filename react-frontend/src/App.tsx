import { useEffect, useMemo, useState } from 'react';
import { useDashboard } from './hooks/useDashboard';
import { useLiveOffers } from './hooks/useLiveOffers';
import { usePaymentMethodGroups } from './hooks/usePaymentMethodGroups';
import { FiltersProvider } from './context/FiltersContext';
import { TimezoneProvider } from './context/TimezoneContext';
import { PreferencesProvider } from './context/PreferencesContext';
import { AuthProvider } from './context/AuthContext';
import { useFilters } from './hooks/useFilters';
import { usePreferences } from './hooks/usePreferences';
import { useAuth } from './hooks/useAuth';
import { LoginPage } from './components/LoginPage';
import { LoadingSpinner } from './components/LoadingSpinner';
import { Header } from './components/Header';
import type { Tab } from './components/Header';
import { SettingsOverlay } from './components/SettingsOverlay';
import { OHLCChart } from './components/OHLCChart';
import { SnapshotLog } from './components/SnapshotLog';
import { MmTransactionsLog } from './components/MmTransactionsLog';
import { TakerOpportunities } from './components/TakerOpportunities';
import { TradingAccountsPanel } from './components/TradingAccountsPanel';
import { PaymentMethodsPanel } from './components/PaymentMethodsPanel';
import { StatisticsView } from './components/StatisticsView';

function MmControllerView() {
  return (
    <div className="lg:flex-1 lg:min-h-0 flex flex-col gap-2 sm:gap-3">
      <div className="lg:flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-2 gap-2 sm:gap-3">
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

function InsightsView({ pastOrderStats, pastOrderStatsAll, pastOrderStatsNetCapped, pastOrderStatsAllNetCapped, fastPastProfitableOrders, detailedPastProfitableOrders, analyticsOverviewLoading, analyticsOrdersLoading, analyticsCappedLoading, loadAnalytics, loadCore, refreshForCex, error, lastUpdatedAt, ohlcData, extendOhlc, allowOhlcExtend }: {
  pastOrderStats: ReturnType<typeof useDashboard>['pastOrderStats'];
  pastOrderStatsAll: ReturnType<typeof useDashboard>['pastOrderStatsAll'];
  pastOrderStatsNetCapped: ReturnType<typeof useDashboard>['pastOrderStatsNetCapped'];
  pastOrderStatsAllNetCapped: ReturnType<typeof useDashboard>['pastOrderStatsAllNetCapped'];
  fastPastProfitableOrders: ReturnType<typeof useDashboard>['fastPastProfitableOrders'];
  detailedPastProfitableOrders: ReturnType<typeof useDashboard>['detailedPastProfitableOrders'];
  analyticsOverviewLoading: boolean;
  analyticsOrdersLoading: boolean;
  analyticsCappedLoading: boolean;
  loadAnalytics: ReturnType<typeof useDashboard>['loadAnalytics'];
  loadCore: ReturnType<typeof useDashboard>['loadCore'];
  refreshForCex: (cex: string, excludedCEXes?: string[], feeTier?: string, coupledHedge?: boolean, maxFiatLimit?: number | null) => void;
  error: string | null;
  lastUpdatedAt: string;
  ohlcData: ReturnType<typeof useDashboard>['ohlcData'];
  extendOhlc: (hours: number, cex?: string, intervalMin?: number) => void;
  allowOhlcExtend: boolean;
}) {
  const { filters } = useFilters();
  const { excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit } = usePreferences();

  useEffect(() => {
    loadAnalytics(filters.hours, filters.cex, excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit);
  }, [filters.hours, filters.cex, excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit, loadAnalytics]);

  // Same core-data refresh cycle as the Monitor tab: reload live offers and
  // the offers/OHLC dataset when the CEX or cost preferences change, and keep
  // them fresh with a 5-minute poll while the tab stays open.
  useEffect(() => {
    refreshForCex(filters.cex, excludedCEXes, feeTier, coupledHedge, maxFiatLimit);
    loadCore(filters.hours, filters.cex, excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit);
    const interval = setInterval(() => loadCore(filters.hours, filters.cex, excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [filters.hours, filters.cex, excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit, loadCore, refreshForCex]);

  return (
    <div className="lg:flex-1 lg:min-h-0 flex flex-col gap-2 sm:gap-3">
      {error && (
        <div className="bg-error border border-red rounded-lg px-3 py-2 text-red text-sm shrink-0">
          {error}
        </div>
      )}

      <div className="lg:flex-1 bg-surface border border-border rounded-lg p-3 flex flex-col min-h-40 lg:min-h-0">
        <TakerOpportunities
          stats={pastOrderStats}
          statsAll={pastOrderStatsAll}
          statsNetCapped={pastOrderStatsNetCapped}
          statsAllNetCapped={pastOrderStatsAllNetCapped}
          fastOrders={fastPastProfitableOrders}
          detailedOrders={detailedPastProfitableOrders}
          statsLoading={analyticsOverviewLoading}
          ordersLoading={analyticsOrdersLoading}
          cappedLoading={analyticsCappedLoading}
          maxFiatLimit={maxFiatLimit}
          onRefreshLive={() => loadCore(filters.hours, filters.cex, excludedMethods, excludedCEXes, feeTier, coupledHedge, maxFiatLimit)}
          lastUpdatedAt={lastUpdatedAt}
          chart={(extraOffers, includeLiveOffers) => (
            <OHLCChart
              data={ohlcData}
              loadedHours={Number(filters.hours)}
              allowExtend={allowOhlcExtend}
              onNeedMoreData={(hours, intervalMin) => extendOhlc(hours, filters.cex, intervalMin)}
              extraOffers={extraOffers}
              includeContextOffers={includeLiveOffers}
              fitToOffers
              chartScope="insights"
            />
          )}
        />
      </div>
    </div>
  );
}

function TradingView() {
  return (
    <div className="lg:flex-1 lg:min-h-0 lg:overflow-hidden flex flex-col gap-3">
      <div className="flex-1 min-h-0 overflow-hidden">
        <TradingAccountsPanel />
      </div>
      <div className="shrink-0 pt-1">
        <div className="mb-2 px-1 text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-muted">
          Payment Method Catalog
        </div>
        <PaymentMethodsPanel />
      </div>
      {/* Trade Flow Monitor — temporarily disabled
      <div className="min-h-0 rounded-lg border border-border bg-surface p-3 flex flex-col">
        <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted">Trade Flow Monitor</h3>
        <div className="flex flex-1 items-center justify-center text-sm text-muted">
          comming soon
        </div>
      </div>
      */}
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
    fastPastProfitableOrders,
    detailedPastProfitableOrders,
    ohlcData,
    lastUpdatedAt,
    error,
    loading,
    analyticsOverviewLoading,
    analyticsOrdersLoading,
    analyticsCappedLoading,
    loadAnalytics,
    loadCore,
    extendOhlc,
    initialLoadComplete,
  } = useDashboard();
  const { liveOffers, wssConnected, pollError, refreshForCex } = useLiveOffers();
  const { groups } = usePaymentMethodGroups();
  const { preferredTimezone, excludedMethods, hideZeroTrustScore } = usePreferences();
  const [activeTab, setActiveTab] = useState<Tab>('insights');
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
      <FiltersProvider offers={allOffers} loading={loading} groups={groups} excludedMethods={excludedMethods} hideZeroTrustScore={hideZeroTrustScore}>
      <div className="min-h-dvh lg:h-dvh flex flex-col overflow-y-auto lg:overflow-hidden bg-bg text-text p-2 sm:p-3 gap-2 sm:gap-3">
        <Header
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onOpenSettings={() => setSettingsOpen(true)}
          wssConnected={wssConnected}
          pollError={pollError}
        />

        <SettingsOverlay
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          groups={groups}
        />

        {activeTab === 'mmcontroller' && (
          <MmControllerView />
        )}

        {activeTab === 'insights' && (
          <InsightsView
            pastOrderStats={pastOrderStats}
            pastOrderStatsAll={pastOrderStatsAll}
            pastOrderStatsNetCapped={pastOrderStatsNetCapped}
            pastOrderStatsAllNetCapped={pastOrderStatsAllNetCapped}
            fastPastProfitableOrders={fastPastProfitableOrders}
            detailedPastProfitableOrders={detailedPastProfitableOrders}
            analyticsOverviewLoading={analyticsOverviewLoading}
            analyticsOrdersLoading={analyticsOrdersLoading}
            analyticsCappedLoading={analyticsCappedLoading}
            loadAnalytics={loadAnalytics}
            loadCore={loadCore}
            refreshForCex={refreshForCex}
            error={error}
            lastUpdatedAt={lastUpdatedAt}
            ohlcData={ohlcData}
            extendOhlc={extendOhlc}
            allowOhlcExtend={initialLoadComplete}
          />
        )}

        {activeTab === 'trading' && (
          <TradingView />
        )}

        {activeTab === 'statistics' && (
          <StatisticsView />
        )}
      </div>
      </FiltersProvider>
    </TimezoneProvider>
  );
}

// AuthGate decides what to render based on session state: a brand spinner while
// the initial /api/auth/me is in flight, the login page when anonymous, and the
// full dashboard once authenticated.
function AuthGate() {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <div className="relative min-h-dvh bg-bg">
        <LoadingSpinner label="Loading…" />
      </div>
    );
  }
  if (status === 'anon') {
    return <LoginPage />;
  }
  return <AppShell />;
}

export default function App() {
  return (
    <PreferencesProvider>
      <AuthProvider>
        <AuthGate />
      </AuthProvider>
    </PreferencesProvider>
  );
}
