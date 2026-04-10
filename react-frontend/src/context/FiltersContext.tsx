import { createContext, useContext, useReducer, useState, useMemo, type ReactNode } from 'react';
import type { Filters, Offer, PaymentMethodGroup } from '../types';

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
  cex: 'kraken',
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
  groups: PaymentMethodGroup[];
  selectedOfferId: number | null;
  setSelectedOfferId: (id: number | null) => void;
  hoveredOhlcTime: number | null;
  setHoveredOhlcTime: (t: number | null) => void;
  loading: boolean;
  refPrice: number | null;        // latest CEX ref price derived from live offers
}

const FiltersContext = createContext<FiltersContextValue | null>(null);

// ── Provider ───────────────────────────────────────────────────────────────

interface Props {
  offers: Offer[];
  loading: boolean;
  groups: PaymentMethodGroup[];
  excludedMethods: string[];
  children: ReactNode;
}

export function FiltersProvider({ offers, loading, groups, excludedMethods, children }: Props) {
  const [filters, dispatch] = useReducer(filtersReducer, DEFAULT_FILTERS);
  const [selectedOfferId, setSelectedOfferId] = useState<number | null>(null);
  const [hoveredOhlcTime, setHoveredOhlcTime] = useState<number | null>(null);

  const setFilters = (partial: Partial<Filters>) => dispatch({ type: 'SET', payload: partial });
  const resetFilters = () => dispatch({ type: 'RESET' });

  const refPrice = useMemo(
    () => offers.find(o => o.is_live && o.ref_price != null)?.ref_price ?? null,
    [offers]
  );

  // Pre-filter: remove offers whose payment method is excluded in settings.
  const activeOffers = useMemo(() => {
    if (excludedMethods.length === 0) return offers;
    const excluded = new Set(excludedMethods);
    return offers.filter(o => !o.payment_method || !excluded.has(o.payment_method));
  }, [offers, excludedMethods]);

  const paymentMethods = useMemo(
    () => [...new Set(activeOffers.map(o => o.payment_method).filter(Boolean))].sort() as string[],
    [activeOffers]
  );

  // Resolve payment filter: group name → set of methods, or exact string match.
  const paymentFilterFn = useMemo(() => {
    if (!filters.payment) return null;
    const group = groups.find(g => g.name === filters.payment);
    if (group) {
      const set = new Set(group.methods);
      return (o: Offer) => o.payment_method != null && set.has(o.payment_method);
    }
    return (o: Offer) => o.payment_method === filters.payment;
  }, [filters.payment, groups]);

  const filteredOffers = useMemo(() => {
    let f = activeOffers;
    if (filters.direction) f = f.filter(o => o.direction === filters.direction);
    if (filters.exchange)  f = f.filter(o => o.exchange === filters.exchange);
    if (paymentFilterFn)   f = f.filter(paymentFilterFn);
    if (filters.status === 'open')   f = f.filter(o => o.is_live);
    if (filters.status === 'closed') f = f.filter(o => !o.is_live);
    const pMin = parseFloat(filters.premiumMin);
    const pMax = parseFloat(filters.premiumMax);
    if (!isNaN(pMin)) f = f.filter(o => (o.price_diff_percent || 0) >= pMin);
    if (!isNaN(pMax)) f = f.filter(o => (o.price_diff_percent || 0) <= pMax);
    if (filters.premiumOnly) f = f.filter(o => (o.price_diff_percent ?? 0) > 0);
    return f.sort((a, b) => (a.price_diff_percent || 0) - (b.price_diff_percent || 0));
  }, [activeOffers, filters, paymentFilterFn]);

  // Depth chart: all filters except direction — orderbook always shows both sides
  const depthOffers = useMemo(() => {
    let f = activeOffers;
    if (filters.exchange)  f = f.filter(o => o.exchange === filters.exchange);
    if (paymentFilterFn)   f = f.filter(paymentFilterFn);
    if (filters.status === 'open')   f = f.filter(o => o.is_live);
    if (filters.status === 'closed') f = f.filter(o => !o.is_live);
    return f;
  }, [activeOffers, filters, paymentFilterFn]);

  return (
    <FiltersContext.Provider value={{ filters, setFilters, resetFilters, offers, filteredOffers, depthOffers, paymentMethods, groups, selectedOfferId, setSelectedOfferId, hoveredOhlcTime, setHoveredOhlcTime, loading, refPrice }}>
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
