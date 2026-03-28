import { useState, useEffect, useMemo } from 'react';
import { useDashboard } from './hooks/useDashboard';
import type { Filters } from './types';
import { Header } from './components/Header';
import { ControlPanel } from './components/ControlPanel';
import { PaymentChart } from './components/PaymentChart';
import { OffersPreviewTable } from './components/OffersPreviewTable';
import { OHLCChart } from './components/OHLCChart';
import { DepthChart } from './components/DepthChart';

const DEFAULT_FILTERS: Filters = {
  direction: '',
  exchange: '',
  payment: '',
  status: 'open',
  premiumMin: '',
  premiumMax: '',
  premiumOnly: true,
  hours: '24',
};

export default function App() {
  const { offers, stats, ohlcData, premiumOffers, lastUpdated, error, load } = useDashboard();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  useEffect(() => {
    load(filters.hours);
    const interval = setInterval(() => load(filters.hours), 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [filters.hours]);

  function handleFiltersChange(partial: Partial<Filters>) {
    setFilters(prev => ({ ...prev, ...partial }));
  }

  const paymentMethods = useMemo(() =>
    [...new Set(offers.map(o => o.payment_method).filter(Boolean))].sort() as string[],
    [offers]
  );

  const lastSeenMap = useMemo(() => {
    const map: Record<string, string> = {};
    offers.forEach(o => {
      if (!map[o.exchange] || o.last_seen! > map[o.exchange]) map[o.exchange] = o.last_seen!;
    });
    return map;
  }, [offers]);

  const filteredForPreview = useMemo(() => {
    let f = offers;
    if (filters.direction) f = f.filter(o => o.direction === filters.direction);
    if (filters.exchange) f = f.filter(o => o.exchange === filters.exchange);
    if (filters.payment) f = f.filter(o => o.payment_method === filters.payment);
    if (filters.status === 'open') f = f.filter(o => o.last_seen === lastSeenMap[o.exchange]);
    if (filters.status === 'closed') f = f.filter(o => o.last_seen !== lastSeenMap[o.exchange]);
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (o.price_diff_percent || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (o.price_diff_percent || 0) <= pMax);
    if (filters.premiumOnly) f = f.filter(o =>
      (o.direction === 'sell' && o.price < (o.ref_price || Infinity)) ||
      (o.direction === 'buy' && o.price > (o.ref_price || 0))
    );
    return f.sort((a, b) => (a.price_diff_percent || 0) - (b.price_diff_percent || 0));
  }, [offers, filters, lastSeenMap]);

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-bg text-text p-3 gap-3">
      <Header stats={stats} offers={offers} lastUpdated={lastUpdated} />

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
            <ControlPanel
              filters={filters}
              paymentMethods={paymentMethods}
              onFiltersChange={handleFiltersChange}
              onRefresh={() => load(filters.hours)}
              lastUpdated={lastUpdated}
            />
          </div>

          <div className="bg-surface border border-border rounded-lg p-3 flex flex-col">
            <h3 className="text-[0.85rem] text-muted mb-2 shrink-0">Offers by Payment Method</h3>
            <PaymentChart offers={offers} />
          </div>

          <div className="bg-surface border border-border rounded-lg p-3 flex flex-col">
            <h3 className="text-[0.85rem] text-muted mb-2 shrink-0">Offers Preview</h3>
            <div className="relative flex-1 min-h-35">
              <OffersPreviewTable offers={filteredForPreview} />
            </div>
          </div>
        </div>

        {/* Bottom row: fills all remaining height */}
        <div className="flex-1 min-h-0 grid gap-3" style={{ gridTemplateColumns: '2fr 1fr' }}>
          <div className="bg-surface border border-border rounded-lg p-3 flex flex-col min-h-0">
            <h3 className="text-[0.85rem] text-muted mb-2 shrink-0">Kraken BTC/EUR — DEX Premium Offer Overlay</h3>
            <div className="flex-1 min-h-0 relative">
              <OHLCChart data={ohlcData} premiumOffers={premiumOffers} hours={filters.hours} />
            </div>
          </div>
          <div className="bg-surface border border-border rounded-lg p-3 flex flex-col min-h-0">
            <DepthChart offers={offers} />
          </div>
        </div>
      </div>
    </div>
  );
}
