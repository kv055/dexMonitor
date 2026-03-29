import { useState, useEffect } from 'react';
import { useDashboard } from './hooks/useDashboard';
import { FiltersProvider, useFilters } from './context/FiltersContext';
import { Header } from './components/Header';
import type { Tab } from './components/Header';
import { ControlPanel } from './components/ControlPanel';
import { PaymentChart } from './components/PaymentChart';
import { OffersPreviewTable } from './components/OffersPreviewTable';
import { OHLCChart } from './components/OHLCChart';
import { DepthChart } from './components/DepthChart';
import { GeneralStats } from './components/GeneralStats';

// Inner component so it can consume FiltersContext
function MonitorView({ ohlcData, lastUpdated, error, load }: {
  ohlcData: ReturnType<typeof useDashboard>['ohlcData'];
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
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      {error && (
        <div className="bg-[#2d1b1b] border border-red rounded-lg px-3 py-2 text-red text-sm shrink-0">
          {error}
        </div>
      )}

      {/* Top row: 3 panels — fixed height driven by content */}
      <div className="grid grid-cols-3 gap-3 shrink-0">
        <div className="bg-surface border border-border rounded-lg p-3 flex flex-col">
          <h3 className="text-[0.85rem] text-muted mb-2 shrink-0">Control Panel</h3>
          <ControlPanel onRefresh={() => load(filters.hours)} lastUpdated={lastUpdated} />
        </div>

        <div className="bg-surface border border-border rounded-lg p-3 flex flex-col">
          <h3 className="text-[0.85rem] text-muted mb-2 shrink-0">Offers by Payment Method</h3>
          <PaymentChart />
        </div>

        <div className="bg-surface border border-border rounded-lg p-3 flex flex-col">
          <h3 className="text-[0.85rem] text-muted mb-2 shrink-0">Offers</h3>
          <div className="relative flex-1 min-h-35">
            <OffersPreviewTable />
          </div>
        </div>
      </div>

      {/* Bottom row: fills all remaining height */}
      <div className="flex-1 min-h-0 grid grid-cols-3 gap-3">
        <div className="col-span-2 bg-surface border border-border rounded-lg p-3 flex flex-col min-h-0">
          <h3 className="text-[0.85rem] text-muted mb-2 shrink-0">Kraken BTC/EUR — DEX Premium Offer Overlay</h3>
          <div className="flex-1 min-h-0 relative">
            <OHLCChart data={ohlcData} />
          </div>
        </div>
        <div className="bg-surface border border-border rounded-lg p-3 flex flex-col min-h-0">
          <DepthChart />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const { offers, stats, ohlcData, lastUpdated, error, loading, load } = useDashboard();
  const [activeTab, setActiveTab] = useState<Tab>('monitor');

  return (
    <FiltersProvider offers={offers} loading={loading}>
      <div className="h-screen overflow-hidden flex flex-col bg-bg text-text p-3 gap-3">
        <Header stats={stats} offers={offers} activeTab={activeTab} onTabChange={setActiveTab} />

        {activeTab === 'monitor' && (
          <MonitorView
            ohlcData={ohlcData}
            lastUpdated={lastUpdated}
            error={error}
            load={load}
          />
        )}

        {activeTab === 'insights' && (
          <div className="flex-1 min-h-0 flex flex-col gap-3">
            {/* Top — smaller */}
            <div className="flex-1 bg-surface border border-border rounded-lg p-3 flex flex-col min-h-0">
              <span className="text-[0.65rem] uppercase text-muted font-semibold tracking-wide mb-2">General Statistics</span>
              <div className="flex-1 min-h-0 overflow-y-auto">
                <GeneralStats />
              </div>
            </div>
            {/* Middle — bigger */}
            <div className="flex-2 bg-surface border border-border rounded-lg p-3 flex flex-col min-h-0">
              <span className="text-[0.65rem] uppercase text-muted font-semibold tracking-wide mb-2">Taker Opportunities</span>
            </div>
            {/* Bottom — bigger */}
            <div className="flex-2 bg-surface border border-border rounded-lg p-3 flex flex-col min-h-0">
              <span className="text-[0.65rem] uppercase text-muted font-semibold tracking-wide mb-2">Maker Opportunities</span>
            </div>
          </div>
        )}
      </div>
    </FiltersProvider>
  );
}
