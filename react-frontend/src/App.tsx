import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useDashboard } from './hooks/useDashboard';
import { useLiveOffers } from './hooks/useLiveOffers';
import { usePaymentMethodGroups } from './hooks/usePaymentMethodGroups';
import { FiltersProvider } from './context/FiltersContext';
import { TimezoneProvider } from './context/TimezoneContext';
import { PreferencesProvider } from './context/PreferencesContext';
import { AuthProvider } from './context/AuthContext';
import { CEXPermissionsProvider } from './context/CEXPermissionsContext';
import { useFilters } from './hooks/useFilters';
import { usePreferences } from './hooks/usePreferences';
import { useAuth } from './hooks/useAuth';
import { useMarketRequestParams } from './hooks/useMarketRequestParams';
import type { AnalyticsPastRange, MarketRequestParams } from './shared/marketParams';
import { LoginPage } from './components/LoginPage';
import { LoadingSpinner } from './components/LoadingSpinner';
import { ErrorBoundary, LazyView } from './components/ErrorBoundary';
import { Header } from './components/Header';
import { ResizableColumns } from './components/ResizableColumns';
import type { Tab } from './components/Header';
import { TakerOpportunities } from './components/TakerOpportunities';

const OHLCChart = lazy(() => import('./components/OHLCChart').then(module => ({ default: module.OHLCChart })));
const SettingsOverlay = lazy(() => import('./components/SettingsOverlay').then(module => ({ default: module.SettingsOverlay })));
const MmTransactionsLog = lazy(() => import('./components/MmTransactionsLog').then(module => ({ default: module.MmTransactionsLog })));
const LiquidityWorkspace = lazy(() => import('./components/LiquidityWorkspace').then(module => ({ default: module.LiquidityWorkspace })));
const TradingAccountsPanel = lazy(() => import('./components/TradingAccountsPanel').then(module => ({ default: module.TradingAccountsPanel })));
const PaymentMethodsPanel = lazy(() => import('./components/PaymentMethodsPanel').then(module => ({ default: module.PaymentMethodsPanel })));
const StatisticsView = lazy(() => import('./components/StatisticsView').then(module => ({ default: module.StatisticsView })));
const AppSettingsPage = lazy(() => import('./components/AppSettingsPage').then(module => ({ default: module.AppSettingsPage })));

function MmControllerView() {
  return (
    <div className="lg:flex-1 lg:min-h-0 flex flex-col gap-2 sm:gap-3">
      <ResizableColumns
        className="lg:flex-1"
        storageKey="dex-taker-controller-split"
        minRightPx={600}
        label="Resize transactions and liquidity panels"
        left={(
          <section className="bg-surface border border-border rounded-lg p-3 flex flex-col min-h-104 xl:min-h-0 overflow-hidden">
            <h3 className="text-[0.65rem] uppercase tracking-widest font-semibold text-muted mb-2 shrink-0">Transactions</h3>
            <div className="relative flex-1 min-h-0">
              <LazyView view="transactions" label="Loading transactions"><MmTransactionsLog /></LazyView>
            </div>
          </section>
        )}
        right={(
          <div className="bg-surface border border-border rounded-lg p-3 flex flex-col min-h-104 xl:min-h-0 overflow-hidden">
            <div className="relative flex-1 min-h-0">
              <LazyView view="liquidity workspace" label="Loading liquidity workspace"><LiquidityWorkspace /></LazyView>
            </div>
          </div>
        )}
      />
    </div>
  );
}

function InsightsView({ pastOrderStats, pastOrderStatsAll, pastOrderStatsNetCapped, pastOrderStatsAllNetCapped, pastOrderStatsNetMin, pastOrderStatsAllNetMin, fastPastProfitableOrders, detailedPastProfitableOrders, analyticsOverviewLoading, analyticsOrdersLoading, analyticsCappedLoading, loadAnalytics, loadCore, refreshForCex, error, lastUpdatedAt, ohlcData, extendOhlc, allowOhlcExtend }: {
  pastOrderStats: ReturnType<typeof useDashboard>['pastOrderStats'];
  pastOrderStatsAll: ReturnType<typeof useDashboard>['pastOrderStatsAll'];
  pastOrderStatsNetCapped: ReturnType<typeof useDashboard>['pastOrderStatsNetCapped'];
  pastOrderStatsAllNetCapped: ReturnType<typeof useDashboard>['pastOrderStatsAllNetCapped'];
  pastOrderStatsNetMin: ReturnType<typeof useDashboard>['pastOrderStatsNetMin'];
  pastOrderStatsAllNetMin: ReturnType<typeof useDashboard>['pastOrderStatsAllNetMin'];
  fastPastProfitableOrders: ReturnType<typeof useDashboard>['fastPastProfitableOrders'];
  detailedPastProfitableOrders: ReturnType<typeof useDashboard>['detailedPastProfitableOrders'];
  analyticsOverviewLoading: boolean;
  analyticsOrdersLoading: boolean;
  analyticsCappedLoading: boolean;
  loadAnalytics: ReturnType<typeof useDashboard>['loadAnalytics'];
  loadCore: ReturnType<typeof useDashboard>['loadCore'];
  refreshForCex: (params: MarketRequestParams) => void;
  error: string | null;
  lastUpdatedAt: string;
  ohlcData: ReturnType<typeof useDashboard>['ohlcData'];
  extendOhlc: (hours: number, cex?: string, intervalMin?: number, fiat?: string) => void;
  allowOhlcExtend: boolean;
}) {
  const { filters } = useFilters();
  const { params, ready } = useMarketRequestParams();
  const { preferredTimezone } = usePreferences();
  const [pastRange, setPastRange] = useState<AnalyticsPastRange | null>(null);

  const handleCustomRangeChange = useCallback((range: { startDate: string; endDate: string } | null) => {
    setPastRange(range ? { ...range, timezone: preferredTimezone } : null);
  }, [preferredTimezone]);

  useEffect(() => {
    if (!ready) return;
    loadAnalytics(params, pastRange);
  }, [params, pastRange, loadAnalytics, ready]);

  // Same core-data refresh cycle as the Monitor tab: reload live offers and
  // the offers/OHLC dataset when the CEX or cost preferences change, and keep
  // them fresh with a 5-minute poll while the tab stays open.
  useEffect(() => {
    if (!ready) return;
    refreshForCex(params);
    loadCore(params);
    const interval = setInterval(() => loadCore(params), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [params, loadCore, refreshForCex, ready]);

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
          statsNetMin={pastOrderStatsNetMin}
          statsAllNetMin={pastOrderStatsAllNetMin}
          fastOrders={fastPastProfitableOrders}
          detailedOrders={detailedPastProfitableOrders}
          statsLoading={analyticsOverviewLoading}
          ordersLoading={analyticsOrdersLoading}
          cappedLoading={analyticsCappedLoading}
          maxFiatLimit={params.maxFiatLimit}
          onRefreshLive={() => loadCore(params)}
          lastUpdatedAt={lastUpdatedAt}
          customRangeLoading={pastRange != null && (analyticsOverviewLoading || analyticsOrdersLoading || analyticsCappedLoading)}
          onCustomRangeChange={handleCustomRangeChange}
          chart={(extraOffers, includeLiveOffers) => (
            <LazyView view="market chart" label="Loading market chart">
            <OHLCChart
              data={ohlcData}
              loadedHours={Number(filters.hours)}
              allowExtend={allowOhlcExtend}
			  onNeedMoreData={(hours, intervalMin) => extendOhlc(hours, filters.cex, intervalMin, filters.fiat)}
              extraOffers={extraOffers}
              includeContextOffers={includeLiveOffers}
              fitToOffers
              chartScope="insights"
            />
            </LazyView>
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
        <LazyView view="trading accounts" label="Loading trading accounts"><TradingAccountsPanel /></LazyView>
      </div>
      <div className="shrink-0 pt-1">
        <div className="mb-2 px-1 text-[0.6rem] font-semibold uppercase tracking-[0.18em] text-muted">
          Payment Method Catalog
        </div>
        <LazyView view="payment methods" label="Loading payment methods"><PaymentMethodsPanel /></LazyView>
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
    pastOrderStatsNetMin,
    pastOrderStatsAllNetMin,
    fastPastProfitableOrders,
    detailedPastProfitableOrders,
    ohlcData,
    lastUpdatedAt,
    error,
    analyticsError,
    loading,
    analyticsOverviewLoading,
    analyticsOrdersLoading,
    analyticsCappedLoading,
    loadAnalytics,
    loadCore,
    extendOhlc,
    initialLoadComplete,
  } = useDashboard();
  const { liveOffers, wssConnected, pollError, refreshForMarket } = useLiveOffers();
  const { groups } = usePaymentMethodGroups();
  const { preferredTimezone, hideZeroTrustScore } = usePreferences();
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
      <FiltersProvider offers={allOffers} loading={loading} groups={groups} hideZeroTrustScore={hideZeroTrustScore}>
      <div className="min-h-dvh lg:h-dvh flex flex-col overflow-y-auto lg:overflow-hidden bg-bg text-text gap-1 sm:gap-2">
        <Header
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onOpenSettings={() => setSettingsOpen(true)}
          wssConnected={wssConnected}
          pollError={pollError}
        />

        {settingsOpen && (
          <ErrorBoundary viewName="settings">
            <Suspense fallback={null}>
              <SettingsOverlay
                open
                onClose={() => setSettingsOpen(false)}
              />
            </Suspense>
          </ErrorBoundary>
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
            pastOrderStatsNetMin={pastOrderStatsNetMin}
            pastOrderStatsAllNetMin={pastOrderStatsAllNetMin}
            fastPastProfitableOrders={fastPastProfitableOrders}
            detailedPastProfitableOrders={detailedPastProfitableOrders}
            analyticsOverviewLoading={analyticsOverviewLoading}
            analyticsOrdersLoading={analyticsOrdersLoading}
            analyticsCappedLoading={analyticsCappedLoading}
            loadAnalytics={loadAnalytics}
            loadCore={loadCore}
            refreshForCex={refreshForMarket}
            error={error ?? analyticsError}
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
          <LazyView view="statistics" label="Loading statistics"><StatisticsView lastUpdatedAt={lastUpdatedAt} /></LazyView>
        )}

        {activeTab === 'settings' && (
          <LazyView view="settings" label="Loading settings"><AppSettingsPage /></LazyView>
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
  return (
    <CEXPermissionsProvider>
      <AppShell />
    </CEXPermissionsProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary viewName="dashboard">
      <PreferencesProvider>
        <AuthProvider>
          <AuthGate />
        </AuthProvider>
      </PreferencesProvider>
    </ErrorBoundary>
  );
}
