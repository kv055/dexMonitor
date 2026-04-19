import { useState, useMemo } from 'react';
import type { Offer, Filters, PaymentMethodGroup } from '../types';
import { ExchangeTag } from './ExchangeTag';
import { useTimezone } from '../context/TimezoneContext';
import { formatNum, formatBtc, formatTime, formatDuration, durationMinutes, premiumClass } from '../utils/formatters';
import { getBtcMax, getBtcMin, getFirstSeen, getLastSeen, getOfferPrice, getPremiumMetricValue, getRawPremiumPercent } from '../utils/offerAccess';

interface Props {
  offers: Offer[];
  filters: Filters;
  groups?: PaymentMethodGroup[];
}

type SortCol = 'exchange' | 'direction' | 'price' | 'price_diff_percent' | 'btc_min' | 'btc_max' | 'payment_method' | 'first_seen' | 'last_seen' | 'duration';

export function OffersTable({ offers, filters, groups = [] }: Props) {
  const groupLabel = (method: string | null) => {
    if (!method) return '—';
    return groups.find(g => g.methods.includes(method))?.display_name ?? method;
  };
  const [sortCol, setSortCol] = useState<SortCol>('price_diff_percent');
  const [sortAsc, setSortAsc] = useState(true);
  const { timezone } = useTimezone();

  const lastSeen = useMemo(() => {
    const map: Record<string, string> = {};
    offers.forEach(o => {
      const last = getLastSeen(o);
      if (last && (!map[o.exchange] || last > map[o.exchange])) map[o.exchange] = last;
    });
    return map;
  }, [offers]);

  const filtered = useMemo(() => {
    let f = offers;
    if (filters.direction) f = f.filter(o => o.direction === filters.direction);
    if (filters.exchange) f = f.filter(o => o.exchange === filters.exchange);
    if (filters.payment) f = f.filter(o => o.payment_method === filters.payment);
    if (filters.status === 'open') f = f.filter(o => getLastSeen(o) === lastSeen[o.exchange]);
    if (filters.status === 'closed') f = f.filter(o => getLastSeen(o) !== lastSeen[o.exchange]);
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) || 0) <= pMax);
    f = f.filter(o => (getPremiumMetricValue(o, filters.premiumMode) ?? 0) > 0);
    return [...f].sort((a, b) => {
      let va: string | number | null | undefined;
      let vb: string | number | null | undefined;
      if (sortCol === 'duration') {
        va = durationMinutes(getFirstSeen(a), getLastSeen(a));
        vb = durationMinutes(getFirstSeen(b), getLastSeen(b));
      } else {
        const resolveSortValue = (offer: Offer, col: SortCol): string | number | null | undefined => {
          switch (col) {
            case 'price':
              return getOfferPrice(offer);
            case 'price_diff_percent':
              return getRawPremiumPercent(offer);
            case 'btc_min':
              return getBtcMin(offer);
            case 'btc_max':
              return getBtcMax(offer);
            case 'first_seen':
              return getFirstSeen(offer);
            case 'last_seen':
              return getLastSeen(offer);
            default:
              return (offer as unknown as Record<string, unknown>)[col] as string | number | null | undefined;
          }
        };
        va = resolveSortValue(a, sortCol);
        vb = resolveSortValue(b, sortCol);
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
              <td className="px-2.5 py-1.5 border-b border-border">€{formatNum(getOfferPrice(o))}</td>
              <td className={`px-2.5 py-1.5 border-b border-border ${premiumClass(getRawPremiumPercent(o))}`}>
                {getRawPremiumPercent(o) != null ? getRawPremiumPercent(o)!.toFixed(1) + '%' : '—'}
              </td>
              <td className="hidden md:table-cell px-2.5 py-1.5 border-b border-border">{formatBtc(getBtcMin(o))}</td>
              <td className="hidden md:table-cell px-2.5 py-1.5 border-b border-border">{formatBtc(getBtcMax(o))}</td>
              <td className="px-2.5 py-1.5 border-b border-border">{groupLabel(o.payment_method)}</td>
              <td className="hidden md:table-cell px-2.5 py-1.5 border-b border-border whitespace-nowrap">{formatTime(getFirstSeen(o), timezone)}</td>
              <td className="hidden sm:table-cell px-2.5 py-1.5 border-b border-border whitespace-nowrap">{formatTime(getLastSeen(o), timezone)}</td>
              <td className="hidden md:table-cell px-2.5 py-1.5 border-b border-border whitespace-nowrap">{formatDuration(getFirstSeen(o), getLastSeen(o))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
