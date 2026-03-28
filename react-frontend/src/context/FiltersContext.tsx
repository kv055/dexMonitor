import { createContext, useContext, useReducer, useState, useMemo, type ReactNode } from 'react';
import type { Filters, Offer } from '../types';

// ── State ──────────────────────────────────────────────────────────────────

export const DEFAULT_FILTERS: Filters = {
  direction: '',
  exchange: '',
  payment: '',
  status: 'open',
  premiumMin: '',
  premiumMax: '',
  premiumOnly: true,
  hours: '24',
};

// ── Reducer ────────────────────────────────────────────────────────────────

type Action =
  | { type: 'SET'; payload: Partial<Filters> }
  | { type: 'RESET' };

function filtersReducer(state: Filters, action: Action): Filters {
  switch (action.type) {
    case 'SET':   return { ...state, ...action.payload };
    case 'RESET': return DEFAULT_FILTERS;
  }
}

// ── Context ────────────────────────────────────────────────────────────────

interface FiltersContextValue {
  filters: Filters;
  setFilters: (partial: Partial<Filters>) => void;
  resetFilters: () => void;
  offers: Offer[];                // raw, unfiltered
  filteredOffers: Offer[];        // all filters applied
  depthOffers: Offer[];           // all filters except direction (orderbook always shows both sides)
  paymentMethods: string[];
  selectedOfferId: number | null;
  setSelectedOfferId: (id: number | null) => void;
}

const FiltersContext = createContext<FiltersContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────

interface Props {
  offers: Offer[];
  children: ReactNode;
}

export function FiltersProvider({ offers, children }: Props) {
  const [filters, dispatch] = useReducer(filtersReducer, DEFAULT_FILTERS);
  const [selectedOfferId, setSelectedOfferId] = useState<number | null>(null);

  const setFilters = (partial: Partial<Filters>) => dispatch({ type: 'SET', payload: partial });
  const resetFilters = () => dispatch({ type: 'RESET' });

  const paymentMethods = useMemo(
    () => [...new Set(offers.map(o => o.payment_method).filter(Boolean))].sort() as string[],
    [offers]
  );

  const lastSeenMap = useMemo(() => {
    const map: Record<string, string> = {};
    offers.forEach(o => {
      if (!map[o.exchange] || o.last_seen! > map[o.exchange]) map[o.exchange] = o.last_seen!;
    });
    return map;
  }, [offers]);

  const filteredOffers = useMemo(() => {
    let f = offers;
    if (filters.direction) f = f.filter(o => o.direction === filters.direction);
    if (filters.exchange)  f = f.filter(o => o.exchange === filters.exchange);
    if (filters.payment)   f = f.filter(o => o.payment_method === filters.payment);
    if (filters.status === 'open')   f = f.filter(o => o.last_seen === lastSeenMap[o.exchange]);
    if (filters.status === 'closed') f = f.filter(o => o.last_seen !== lastSeenMap[o.exchange]);
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (o.price_diff_percent || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (o.price_diff_percent || 0) <= pMax);
    if (filters.premiumOnly) f = f.filter(o => o.price > (o.ref_price || 0));
    return f.sort((a, b) => (a.price_diff_percent || 0) - (b.price_diff_percent || 0));
  }, [offers, filters, lastSeenMap]);

  // Depth chart: all filters except direction — orderbook always shows both sides
  const depthOffers = useMemo(() => {
    let f = offers;
    if (filters.exchange)  f = f.filter(o => o.exchange === filters.exchange);
    if (filters.payment)   f = f.filter(o => o.payment_method === filters.payment);
    if (filters.status === 'open')   f = f.filter(o => o.last_seen === lastSeenMap[o.exchange]);
    if (filters.status === 'closed') f = f.filter(o => o.last_seen !== lastSeenMap[o.exchange]);
    return f;
  }, [offers, filters, lastSeenMap]);

  return (
    <FiltersContext.Provider value={{ filters, setFilters, resetFilters, offers, filteredOffers, depthOffers, paymentMethods, selectedOfferId, setSelectedOfferId }}>
      {children}
    </FiltersContext.Provider>
  );
}

// ── Hook ───────────────────────────────────────────────────────────────────

export function useFilters(): FiltersContextValue {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error('useFilters must be used inside <FiltersProvider>');
  return ctx;
}
