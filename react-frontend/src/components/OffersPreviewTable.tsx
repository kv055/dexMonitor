import React, { useEffect, useRef } from 'react';
import { ExchangeTag } from './ExchangeTag';
import { formatNum, formatBtc, premiumClass } from '../utils/formatters';
import { useFilters } from '../context/FiltersContext';
import { LoadingSpinner } from './LoadingSpinner';
import type { CostBreakdown } from '../types';

const thCls = "sticky top-0 bg-surface px-1.5 py-1 border-b border-border text-muted text-[0.65rem] uppercase text-left whitespace-nowrap";
const thClsCompact = "sticky top-0 bg-surface px-1 py-1 border-b border-border text-muted text-[0.65rem] uppercase text-left whitespace-nowrap";

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

  const selectedOffer = offers.find(o => o.id === selectedOfferId) ?? null;
  const hasSelection = selectedOffer !== null;

  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedOfferId]);

  return (
    <div className="absolute inset-0 flex overflow-hidden">

      {/* ── Left: offers table ── */}
      <div
        className="overflow-y-auto shrink-0 transition-all duration-300 ease-in-out"
        style={{ width: hasSelection ? '54%' : '100%' }}
      >
        {loading && offers.length === 0 && <LoadingSpinner label="Loading offers" />}
        <table className={`w-full border-collapse ${hasSelection ? 'text-[0.68rem]' : 'text-[0.72rem]'}`}>
          <thead>
            <tr>
              <th className={hasSelection ? thClsCompact : thCls}>Exch</th>
              <th className={hasSelection ? thClsCompact : thCls}>Side</th>
              <th className={`${hasSelection ? thClsCompact : thCls} text-right`}>Prem.</th>
              <th className={`${hasSelection ? thClsCompact : thCls} text-right`}>Price</th>
              <th className={`${hasSelection ? thClsCompact : thCls} text-right`}>Min BTC</th>
              <th className={`${hasSelection ? thClsCompact : thCls} text-right`}>Max BTC</th>
              {!hasSelection && <th className={`${thCls} text-right`}>Fiat Min</th>}
              {!hasSelection && <th className={`${thCls} text-right`}>Fiat Max</th>}
              <th className={hasSelection ? thClsCompact : thCls}>Payment</th>
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
                  <>
                    <td className={`${hasSelection ? 'px-1' : 'px-1.5'} py-1 whitespace-nowrap overflow-hidden`}>
                      <ExchangeTag exchange={o.exchange} />
                    </td>
                    <td className={`${hasSelection ? 'px-1' : 'px-1.5'} py-1 ${o.direction === 'buy' ? 'text-green' : 'text-red'}`}>
                      {o.direction === 'buy' ? 'Bid' : 'Ask'}
                    </td>
                    <td className={`${hasSelection ? 'px-1' : 'px-1.5'} py-1 text-right whitespace-nowrap ${premiumClass(o.price_diff_percent)}`}>
                      {o.price_diff_percent != null ? o.price_diff_percent.toFixed(1) + '%' : '—'}
                    </td>
                    <td className={`${hasSelection ? 'px-1' : 'px-1.5'} py-1 text-right whitespace-nowrap`}>€{formatNum(o.price)}</td>
                    <td className={`${hasSelection ? 'px-1' : 'px-1.5'} py-1 text-right whitespace-nowrap`}>{formatBtc(o.btc_min)}</td>
                    <td className={`${hasSelection ? 'px-1' : 'px-1.5'} py-1 text-right whitespace-nowrap`}>{formatBtc(o.btc_max)}</td>
                    {!hasSelection && (
                      <td className="px-1.5 py-1 text-right whitespace-nowrap">
                        {o.btc_min != null ? `€${formatNum(o.btc_min * o.price)}` : '—'}
                      </td>
                    )}
                    {!hasSelection && (
                      <td className="px-1.5 py-1 text-right whitespace-nowrap">
                        {o.btc_max != null ? `€${formatNum(o.btc_max * o.price)}` : '—'}
                      </td>
                    )}
                    <td className={`${hasSelection ? 'px-1' : 'px-1.5'} py-1 whitespace-nowrap overflow-hidden`}>
                      <span className="block overflow-hidden text-ellipsis whitespace-nowrap">
                        {o.payment_method || '—'}
                      </span>
                    </td>
                  </>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Right: cost breakdown panel ── */}
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
            {/* X button */}
            <button
              onClick={() => setSelectedOfferId(null)}
              className="absolute top-2.5 right-3 w-6 h-6 flex items-center justify-center text-muted hover:text-text bg-transparent border-none cursor-pointer text-lg leading-none rounded hover:bg-white/10 transition-colors"
              title="Close"
            >
              ×
            </button>

            {/* Offer header */}
            <div className="flex items-center gap-2 mb-4 pr-8">
              <ExchangeTag exchange={selectedOffer.exchange} />
              <span className={selectedOffer.direction === 'buy' ? 'text-green text-[0.8rem] font-medium' : 'text-red text-[0.8rem] font-medium'}>
                {selectedOffer.direction === 'buy' ? 'Bid' : 'Ask'}
              </span>
              <span className="text-text text-[0.8rem]">€{formatNum(selectedOffer.price)}</span>
              <span className={`text-[0.8rem] font-medium ${premiumClass(selectedOffer.price_diff_percent)}`}>
                {selectedOffer.price_diff_percent != null ? selectedOffer.price_diff_percent.toFixed(2) + '%' : '—'}
              </span>
              <span className="text-muted text-[0.72rem] ml-auto">{selectedOffer.payment_method || '—'}</span>
            </div>

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
