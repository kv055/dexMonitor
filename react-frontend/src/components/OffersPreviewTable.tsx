import { useEffect, useRef, useState } from 'react';
import { ExchangeTag } from './ExchangeTag';
import { formatNum, formatBtc, premiumClass } from '../utils/formatters';
import { useFilters } from '../context/FiltersContext';
import { LoadingSpinner } from './LoadingSpinner';
import type { CostBreakdown } from '../types';

const TH_BASE = "sticky top-0 z-10 bg-surface px-2 py-1 border-b border-border text-muted text-[0.65rem] uppercase text-left whitespace-nowrap";
const TD = "px-2 py-1 whitespace-nowrap";

function fmt8(n: number): string {
  return n.toFixed(8).replace(/\.?0+$/, '') || '0';
}

function fmtPct(n: number): string {
  return n.toFixed(4).replace(/\.?0+$/, '') + '%';
}

function CostBreakdownPanel({ bd, priceDiffPct, netPremiumPct }: {
  bd: CostBreakdown;
  priceDiffPct: number | null;
  netPremiumPct: number | null;
}) {
  const rows: { label: string; btc: number; pct: number }[] = [
    { label: 'CEX taker fee',    btc: bd.cex_taker_fee_btc,  pct: bd.cex_taker_fee_pct  },
    { label: 'CEX withdrawal',   btc: bd.withdrawal_fee_btc,  pct: bd.withdrawal_fee_pct  },
    { label: 'BTC network fee',  btc: bd.network_fee_btc,     pct: bd.network_fee_pct     },
    { label: 'DEX platform fee', btc: bd.dex_fee_btc,         pct: bd.dex_fee_pct         },
  ];
  const netCls = netPremiumPct != null
    ? netPremiumPct <= 0 ? 'text-red' : netPremiumPct <= 2 ? 'text-green' : 'text-accent'
    : 'text-muted';

  return (
    <div className="flex flex-col gap-3 text-[0.72rem]">
      <div className="text-muted uppercase text-[0.6rem] tracking-wide">
        Trade cost breakdown — {fmt8(bd.btc_amount)} BTC
      </div>
      <table className="w-full">
        <thead>
          <tr>
            <th className="text-left text-muted font-normal pb-1 pr-3">Component</th>
            <th className="text-right text-muted font-normal pb-1 pr-3">BTC</th>
            <th className="text-right text-muted font-normal pb-1">% of trade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label}>
              <td className="pr-3 py-0.5 text-muted">{r.label}</td>
              <td className="pr-3 py-0.5 text-right text-text">{fmt8(r.btc)}</td>
              <td className="py-0.5 text-right text-text">{fmtPct(r.pct)}</td>
            </tr>
          ))}
          <tr className="border-t border-border">
            <td className="pr-3 pt-2 font-medium text-text">Total cost</td>
            <td className="pr-3 pt-2 text-right font-medium text-text">{fmt8(bd.total_cost_btc)}</td>
            <td className="pt-2 text-right font-medium text-red">{fmtPct(bd.total_cost_pct)}</td>
          </tr>
          <tr>
            <td className="pr-3 py-0.5 text-muted">DEX premium</td>
            <td className="pr-3 py-0.5 text-right text-muted">—</td>
            <td className={`py-0.5 text-right font-medium ${premiumClass(priceDiffPct)}`}>
              {priceDiffPct != null ? fmtPct(priceDiffPct) : '—'}
            </td>
          </tr>
          <tr className="border-t border-border">
            <td className="pr-3 pt-2 font-semibold text-text">Net premium</td>
            <td className="pr-3 pt-2 text-right text-muted">—</td>
            <td className={`pt-2 text-right font-bold text-[0.85rem] ${netCls}`}>
              {netPremiumPct != null ? fmtPct(netPremiumPct) : '—'}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function OffersPreviewTable() {
  const { filteredOffers: offers, selectedOfferId, setSelectedOfferId, loading } = useFilters();
  const selectedRowRef = useRef<HTMLTableRowElement>(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const selectedOffer = offers.find(o => o.id === selectedOfferId) ?? null;
  const hasSelection = selectedOffer !== null;

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedOfferId]);

  // ── Mobile layout: vertical stack ─────────────────────────────────────────
  if (isMobile) {
    return (
      <div className="absolute inset-0 flex flex-col overflow-hidden">

        {/* Table — fills remaining height, scrolls vertically */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading && offers.length === 0 && <LoadingSpinner label="Loading offers" />}
          <table className="w-full border-collapse text-[0.72rem]">
            <thead>
              <tr>
                <th className={TH_BASE}>Exch</th>
                <th className={TH_BASE}>Side</th>
                <th className={`${TH_BASE} text-right`}>Prem.</th>
                <th className={`${TH_BASE} text-right`}>Price</th>
                <th className={TH_BASE}>Payment</th>
              </tr>
            </thead>
            <tbody>
              {offers.length === 0 ? (
                !loading && <tr><td colSpan={5} className="p-4 text-center text-muted">No offers</td></tr>
              ) : offers.map((o) => {
                const isSelected = o.id === selectedOfferId;
                return (
                  <tr
                    key={o.id}
                    ref={isSelected ? selectedRowRef : null}
                    onClick={() => setSelectedOfferId(isSelected ? null : o.id)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'offer-row-selected' : 'offer-row-hover'
                    }`}
                  >
                    <td className={`${TD} overflow-hidden`}>
                      <ExchangeTag exchange={o.exchange} />
                    </td>
                    <td className={`${TD} ${o.direction === 'buy' ? 'text-green' : 'text-red'}`}>
                      {o.direction === 'buy' ? 'Bid' : 'Ask'}
                    </td>
                    <td className={`${TD} text-right ${premiumClass(o.price_diff_percent)}`}>
                      {o.price_diff_percent != null ? o.price_diff_percent.toFixed(1) + '%' : '—'}
                    </td>
                    <td className={`${TD} text-right`}>€{formatNum(o.price)}</td>
                    <td className={`${TD} overflow-hidden max-w-32`}>
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                        {o.payment_method || '—'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Breakdown panel — slides up from bottom when offer is selected */}
        <div
          className="shrink-0 border-t border-border overflow-y-auto transition-all duration-300 ease-in-out"
          style={{
            maxHeight: hasSelection ? '55%' : '0%',
            opacity: hasSelection ? 1 : 0,
          }}
        >
          {selectedOffer && (
            <div className="relative p-4">
              <button
                onClick={() => setSelectedOfferId(null)}
                className="absolute top-2.5 right-3 w-6 h-6 flex items-center justify-center text-muted hover:text-text bg-transparent border-none cursor-pointer text-lg leading-none rounded hover:bg-white/10 transition-colors"
                title="Close"
              >
                ×
              </button>
              {selectedOffer.cost_breakdown ? (
                <CostBreakdownPanel
                  bd={selectedOffer.cost_breakdown}
                  priceDiffPct={selectedOffer.price_diff_percent}
                  netPremiumPct={selectedOffer.net_premium_percent}
                />
              ) : (
                <div className="text-muted text-[0.75rem]">No cost breakdown available for this offer.</div>
              )}
            </div>
          )}
        </div>

      </div>
    );
  }

  // ── Desktop layout: horizontal split ──────────────────────────────────────
  return (
    <div className="absolute inset-0 flex overflow-hidden">

      {/* Left: offers table */}
      <div
        className="overflow-y-auto shrink-0 transition-all duration-300 ease-in-out"
        style={{ width: hasSelection ? '54%' : '100%' }}
      >
        {loading && offers.length === 0 && <LoadingSpinner label="Loading offers" />}
        <table className={`w-full border-collapse ${hasSelection ? 'text-[0.68rem]' : 'text-[0.72rem]'}`}>
          <thead>
            <tr>
              <th className={`${TH_BASE} ${hasSelection ? 'w-[1%]' : ''}`}>Exch</th>
              <th className={`${TH_BASE} ${hasSelection ? 'w-[1%]' : ''}`}>Side</th>
              <th className={`${TH_BASE} text-right ${hasSelection ? 'w-[1%]' : ''}`}>Prem.</th>
              <th className={`${TH_BASE} text-right ${hasSelection ? 'w-[1%]' : ''}`}>Price</th>
              <th className={`${TH_BASE} text-right ${hasSelection ? 'w-[1%]' : ''}`}>Min BTC</th>
              <th className={`${TH_BASE} text-right ${hasSelection ? 'w-[1%]' : ''}`}>Max BTC</th>
              {!hasSelection && <th className={`${TH_BASE} text-right`}>Fiat Min</th>}
              {!hasSelection && <th className={`${TH_BASE} text-right`}>Fiat Max</th>}
              <th className={TH_BASE}>Payment</th>
            </tr>
          </thead>
          <tbody>
            {offers.length === 0 ? (
              !loading && <tr><td colSpan={hasSelection ? 7 : 9} className="p-4 text-center text-muted">No offers</td></tr>
            ) : offers.map((o) => {
              const isSelected = o.id === selectedOfferId;
              return (
                <tr
                  key={o.id}
                  ref={isSelected ? selectedRowRef : null}
                  onClick={() => setSelectedOfferId(isSelected ? null : o.id)}
                  className={`cursor-pointer transition-colors ${
                    isSelected ? 'offer-row-selected' : 'offer-row-hover'
                  }`}
                >
                  <td className={`${TD} overflow-hidden`}>
                    <ExchangeTag exchange={o.exchange} />
                  </td>
                  <td className={`${TD} ${o.direction === 'buy' ? 'text-green' : 'text-red'}`}>
                    {o.direction === 'buy' ? 'Bid' : 'Ask'}
                  </td>
                  <td className={`${TD} text-right ${premiumClass(o.price_diff_percent)}`}>
                    {o.price_diff_percent != null ? o.price_diff_percent.toFixed(1) + '%' : '—'}
                  </td>
                  <td className={`${TD} text-right`}>€{formatNum(o.price)}</td>
                  <td className={`${TD} text-right`}>{formatBtc(o.btc_min)}</td>
                  <td className={`${TD} text-right`}>{formatBtc(o.btc_max)}</td>
                  {!hasSelection && (
                    <td className={`${TD} text-right`}>
                      {o.btc_min != null ? `€${formatNum(o.btc_min * o.price)}` : '—'}
                    </td>
                  )}
                  {!hasSelection && (
                    <td className={`${TD} text-right`}>
                      {o.btc_max != null ? `€${formatNum(o.btc_max * o.price)}` : '—'}
                    </td>
                  )}
                  <td className={`${TD} overflow-hidden`}>
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                      {o.payment_method || '—'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Right: cost breakdown panel */}
      <div
        className="border-l border-border overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          width: hasSelection ? '46%' : '0%',
          opacity: hasSelection ? 1 : 0,
          transform: hasSelection ? 'translateX(0)' : 'translateX(16px)',
        }}
      >
        {selectedOffer && (
          <div className="relative p-4 h-full overflow-y-auto">
            <button
              onClick={() => setSelectedOfferId(null)}
              className="absolute top-2.5 right-3 w-6 h-6 flex items-center justify-center text-muted hover:text-text bg-transparent border-none cursor-pointer text-lg leading-none rounded hover:bg-white/10 transition-colors"
              title="Close"
            >
              ×
            </button>

            {selectedOffer.cost_breakdown ? (
              <CostBreakdownPanel
                bd={selectedOffer.cost_breakdown}
                priceDiffPct={selectedOffer.price_diff_percent}
                netPremiumPct={selectedOffer.net_premium_percent}
              />
            ) : (
              <div className="text-muted text-[0.75rem]">No cost breakdown available for this offer.</div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}
