import React, { useEffect, useRef } from 'react';
import { ExchangeTag } from './ExchangeTag';
import { formatNum, premiumClass } from '../utils/formatters';
import { useFilters } from '../context/FiltersContext';

const thCls = "sticky top-0 bg-surface px-1.5 py-1 border-b border-border text-muted text-[0.65rem] uppercase text-left whitespace-nowrap";

export function OffersPreviewTable() {
  const { offers: allOffers, filteredOffers: offers, selectedOfferId, setSelectedOfferId } = useFilters();
  const selectedRowRef = useRef<HTMLTableRowElement>(null);

  // Determine the latest last_seen per exchange to identify live (open) offers
  const lastSeenMap: Record<string, string> = {};
  allOffers.forEach(o => {
    if (o.last_seen && (!lastSeenMap[o.exchange] || o.last_seen > lastSeenMap[o.exchange]))
      lastSeenMap[o.exchange] = o.last_seen;
  });

  // Scroll selected row into view when selection comes from OHLC chart
  useEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedOfferId]);

  return (
    <div className="absolute inset-0 overflow-y-auto">
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
            <tr><td colSpan={7} className="p-4 text-center text-muted">Loading...</td></tr>
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
                  <td className="px-1.5 py-1 text-right whitespace-nowrap">{o.btc_min ?? '—'}</td>
                  <td className="px-1.5 py-1 text-right whitespace-nowrap">{o.btc_max ?? '—'}</td>
                  <td className="px-1.5 py-1 whitespace-nowrap overflow-hidden text-ellipsis max-w-22.5">{o.payment_method || '—'}</td>
                </tr>
                {isSelected && (
                  <tr key={`${o.id}-detail`} className="bg-white/8">
                    <td colSpan={7} className="px-3 py-2 border-b border-border text-[0.65rem]">
                      <span className="text-muted">ID:</span>{' '}
                      <span className="text-text">{o.id ?? 'noID'}</span>
                      <span className="mx-2 text-border">|</span>
                      <span className="text-muted">First seen:</span>{' '}
                      <span className="text-text">{o.first_seen ?? '—'}</span>
                      <span className="mx-2 text-border">|</span>
                      <span className="text-muted">Last seen:</span>{' '}
                      {o.last_seen === lastSeenMap[o.exchange]
                        ? <span className="text-green font-medium">live</span>
                        : <span className="text-text">{o.last_seen ?? '—'}</span>
                      }
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
