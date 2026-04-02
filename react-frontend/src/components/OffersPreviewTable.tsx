import React, { useEffect, useRef } from 'react';
import { ExchangeTag } from './ExchangeTag';
import { formatNum, formatBtc, premiumClass, formatTime } from '../utils/formatters';
import { useFilters } from '../context/FiltersContext';
import { LoadingSpinner } from './LoadingSpinner';
import type { CostBreakdown } from '../types';

const thCls = "sticky top-0 bg-surface px-1.5 py-1 border-b border-border text-muted text-[0.65rem] uppercase text-left whitespace-nowrap";

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
    <div className="mt-2 pt-2 border-t border-border">
      <div className="text-muted uppercase text-[0.6rem] mb-1 tracking-wide">
        Trade cost breakdown — {fmt8(bd.btc_amount)} BTC
      </div>
      <table className="w-full text-[0.65rem]">
        <thead>
          <tr>
            <th className="text-left text-muted font-normal pb-0.5 pr-3">Component</th>
            <th className="text-right text-muted font-normal pb-0.5 pr-3">BTC</th>
            <th className="text-right text-muted font-normal pb-0.5">% of trade</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label}>
              <td className="pr-3 py-px text-muted">{r.label}</td>
              <td className="pr-3 py-px text-right text-text">{fmt8(r.btc)}</td>
              <td className="py-px text-right text-text">{fmtPct(r.pct)}</td>
            </tr>
          ))}
          <tr className="border-t border-border">
            <td className="pr-3 pt-1 font-medium text-text">Total cost</td>
            <td className="pr-3 pt-1 text-right font-medium text-text">{fmt8(bd.total_cost_btc)}</td>
            <td className="pt-1 text-right font-medium text-red">{fmtPct(bd.total_cost_pct)}</td>
          </tr>
          <tr>
            <td className="pr-3 py-px text-muted">DEX premium</td>
            <td className="pr-3 py-px text-right text-muted">—</td>
            <td className={`py-px text-right font-medium ${premiumClass(priceDiffPct)}`}>
              {priceDiffPct != null ? fmtPct(priceDiffPct) : '—'}
            </td>
          </tr>
          <tr className="border-t border-border">
            <td className="pr-3 pt-1 font-medium text-text">Net premium</td>
            <td className="pr-3 pt-1 text-right text-muted">—</td>
            <td className={`pt-1 text-right font-bold ${netCls}`}>
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

  // Scroll selected row into view when selection comes from OHLC chart
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedOfferId]);

  return (
    <div className="absolute inset-0 overflow-y-auto">
      {loading && offers.length === 0 && <LoadingSpinner label="Loading offers" />}
      <table className="w-full border-collapse text-[0.72rem]">
        <thead>
          <tr>
            <th className={thCls}>Exch</th>
            <th className={thCls}>Side</th>
            <th className={`${thCls} text-right`}>Price</th>
            <th className={`${thCls} text-right`}>Prem.</th>
            <th className={`${thCls} text-right`}>Min BTC</th>
            <th className={`${thCls} text-right`}>Max BTC</th>
            <th className={thCls}>Payment</th>
          </tr>
        </thead>
        <tbody>
          {offers.length === 0 ? (
            !loading && <tr><td colSpan={7} className="p-4 text-center text-muted">No offers</td></tr>
          ) : offers.map((o) => {
            const isSelected = o.id === selectedOfferId;
            return (
              <React.Fragment key={o.id}>
                <tr
                  ref={isSelected ? selectedRowRef : null}
                  onClick={() => setSelectedOfferId(isSelected ? null : o.id)}
                  className={`cursor-pointer transition-colors ${isSelected ? 'bg-white/12' : 'hover:bg-white/3'}`}
                >
                  <td className="px-1.5 py-1 whitespace-nowrap"><ExchangeTag exchange={o.exchange} /></td>
                  <td className={`px-1.5 py-1 ${o.direction === 'buy' ? 'text-green' : 'text-red'}`}>
                    {o.direction === 'buy' ? 'Bid' : 'Ask'}
                  </td>
                  <td className="px-1.5 py-1 text-right whitespace-nowrap">€{formatNum(o.price)}</td>
                  <td className={`px-1.5 py-1 text-right whitespace-nowrap ${premiumClass(o.price_diff_percent)}`}>
                    {o.price_diff_percent != null ? o.price_diff_percent.toFixed(1) + '%' : '—'}
                  </td>
                  <td className="px-1.5 py-1 text-right whitespace-nowrap">{formatBtc(o.btc_min)}</td>
                  <td className="px-1.5 py-1 text-right whitespace-nowrap">{formatBtc(o.btc_max)}</td>
                  <td className="px-1.5 py-1 whitespace-nowrap overflow-hidden text-ellipsis max-w-22.5">{o.payment_method || '—'}</td>
                </tr>
                {isSelected && (
                  <tr key={`${o.id}-detail`} className="bg-white/8">
                    <td colSpan={7} className="px-3 py-2 border-b border-border text-[0.65rem]">
                      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                        <span><span className="text-muted">ID:</span>{' '}<span className="text-text">{o.offer_id ?? '—'}</span></span>
                        <span><span className="text-muted">First seen:</span>{' '}<span className="text-text">{formatTime(o.first_seen)}</span></span>
                        <span>
                          <span className="text-muted">Last seen:</span>{' '}
                          {o.is_live
                            ? <span className="text-green font-medium">live</span>
                            : <span className="text-text">{formatTime(o.last_seen)}</span>
                          }
                        </span>
                      </div>
                      {o.cost_breakdown && (
                        <CostBreakdownPanel
                          bd={o.cost_breakdown}
                          priceDiffPct={o.price_diff_percent}
                          netPremiumPct={o.net_premium_percent}
                        />
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
