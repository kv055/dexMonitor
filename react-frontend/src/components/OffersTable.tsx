import { useState, useMemo } from 'react';
import type { Offer, Filters } from '../types';
import { ExchangeTag } from './ExchangeTag';
import { formatNum, formatBtc, formatTime, formatDuration, durationMinutes, premiumClass } from '../utils/formatters';

interface Props {
  offers: Offer[];
  filters: Filters;
}

type SortCol = 'exchange' | 'direction' | 'price' | 'price_diff_percent' | 'btc_min' | 'btc_max' | 'payment_method' | 'first_seen' | 'last_seen' | 'duration';

export function OffersTable({ offers, filters }: Props) {
  const [sortCol, setSortCol] = useState<SortCol>('price_diff_percent');
  const [sortAsc, setSortAsc] = useState(true);

  const lastSeen = useMemo(() => {
    const map: Record<string, string> = {};
    offers.forEach(o => {
      if (!map[o.exchange] || o.last_seen! > map[o.exchange]) map[o.exchange] = o.last_seen!;
    });
    return map;
  }, [offers]);

  const filtered = useMemo(() => {
    let f = offers;
    if (filters.direction) f = f.filter(o => o.direction === filters.direction);
    if (filters.exchange) f = f.filter(o => o.exchange === filters.exchange);
    if (filters.payment) f = f.filter(o => o.payment_method === filters.payment);
    if (filters.status === 'open') f = f.filter(o => o.last_seen === lastSeen[o.exchange]);
    if (filters.status === 'closed') f = f.filter(o => o.last_seen !== lastSeen[o.exchange]);
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (o.price_diff_percent || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (o.price_diff_percent || 0) <= pMax);
    if (filters.premiumOnly) f = f.filter(o => (o.price_diff_percent ?? 0) > 0);
    return [...f].sort((a, b) => {
      let va: string | number | null | undefined;
      let vb: string | number | null | undefined;
      if (sortCol === 'duration') {
        va = durationMinutes(a.first_seen, a.last_seen);
        vb = durationMinutes(b.first_seen, b.last_seen);
      } else {
        va = (a as unknown as Record<string, unknown>)[sortCol] as string | number | null | undefined;
        vb = (b as unknown as Record<string, unknown>)[sortCol] as string | number | null | undefined;
      }
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va == null) return sortAsc ? 1 : -1;
      if (vb == null) return sortAsc ? -1 : 1;
      if (va < vb) return sortAsc ? -1 : 1;
      if (va > vb) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [offers, filters, sortCol, sortAsc, lastSeen]);

  function handleSort(col: SortCol) {
    if (sortCol === col) setSortAsc(a => !a);
    else { setSortCol(col); setSortAsc(true); }
  }

  const thCls = "text-left px-2.5 py-1.5 border-b border-border text-muted font-semibold text-[0.75rem] uppercase tracking-wide cursor-pointer select-none whitespace-nowrap hover:text-text";

  function SortArrow({ col }: { col: SortCol }) {
    if (col !== sortCol) return <span className="ml-1 text-[0.65rem] opacity-30">↕</span>;
    return <span className="ml-1 text-[0.65rem]">{sortAsc ? '▲' : '▼'}</span>;
  }

  return (
    <div className="bg-surface border border-border rounded-lg p-3 overflow-x-auto">
      <h3 className="text-[0.95rem] text-muted mb-2.5">All Offers</h3>
      <table className="w-full border-collapse text-[0.85rem]">
        <thead>
          <tr>
            <th className={thCls} onClick={() => handleSort('exchange')}>Exchange<SortArrow col="exchange" /></th>
            <th className={thCls} onClick={() => handleSort('direction')}>Side<SortArrow col="direction" /></th>
            <th className={thCls} onClick={() => handleSort('price')}>Price (EUR)<SortArrow col="price" /></th>
            <th className={thCls} onClick={() => handleSort('price_diff_percent')}>Premium<SortArrow col="price_diff_percent" /></th>
            <th className={`${thCls} hidden md:table-cell`} onClick={() => handleSort('btc_min')}>BTC Min<SortArrow col="btc_min" /></th>
            <th className={`${thCls} hidden md:table-cell`} onClick={() => handleSort('btc_max')}>BTC Max<SortArrow col="btc_max" /></th>
            <th className={thCls} onClick={() => handleSort('payment_method')}>Payment<SortArrow col="payment_method" /></th>
            <th className={`${thCls} hidden md:table-cell`} onClick={() => handleSort('first_seen')}>First Seen<SortArrow col="first_seen" /></th>
            <th className={`${thCls} hidden sm:table-cell`} onClick={() => handleSort('last_seen')}>Last Seen<SortArrow col="last_seen" /></th>
            <th className={`${thCls} hidden md:table-cell`} onClick={() => handleSort('duration')}>Duration<SortArrow col="duration" /></th>
          </tr>
        </thead>
        <tbody>
          {filtered.length === 0 ? (
            <tr><td colSpan={10} className="py-12 text-center text-muted">No offers found</td></tr>
          ) : filtered.map((o, i) => (
            <tr key={i} className="hover:bg-white/3">
              <td className="px-2.5 py-1.5 border-b border-border whitespace-nowrap"><ExchangeTag exchange={o.exchange} /></td>
              <td className={`px-2.5 py-1.5 border-b border-border ${o.direction === 'buy' ? 'text-green' : 'text-red'}`}>
                {o.direction === 'buy' ? 'Bid' : 'Ask'}
              </td>
              <td className="px-2.5 py-1.5 border-b border-border">€{formatNum(o.price)}</td>
              <td className={`px-2.5 py-1.5 border-b border-border ${premiumClass(o.price_diff_percent)}`}>
                {o.price_diff_percent != null ? o.price_diff_percent.toFixed(1) + '%' : '—'}
              </td>
              <td className="hidden md:table-cell px-2.5 py-1.5 border-b border-border">{formatBtc(o.btc_min)}</td>
              <td className="hidden md:table-cell px-2.5 py-1.5 border-b border-border">{formatBtc(o.btc_max)}</td>
              <td className="px-2.5 py-1.5 border-b border-border">{o.payment_method || '—'}</td>
              <td className="hidden md:table-cell px-2.5 py-1.5 border-b border-border whitespace-nowrap">{formatTime(o.first_seen)}</td>
              <td className="hidden sm:table-cell px-2.5 py-1.5 border-b border-border whitespace-nowrap">{formatTime(o.last_seen)}</td>
              <td className="hidden md:table-cell px-2.5 py-1.5 border-b border-border whitespace-nowrap">{formatDuration(o.first_seen, o.last_seen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
