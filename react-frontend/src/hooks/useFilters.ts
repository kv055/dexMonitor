import { createContext, useContext } from 'react';
import type { Filters, Offer, PaymentMethodGroup } from '../types';

export interface FiltersContextValue {
  filters: Filters;
  setFilters: (partial: Partial<Filters>) => void;
  resetFilters: () => void;
  offers: Offer[];
  filteredOffers: Offer[];
  depthOffers: Offer[];
  paymentMethods: string[];
  /** Offer counts per payment method in the current monitor view (payment filter excluded). */
  paymentMethodCounts: Record<string, number>;
  groups: PaymentMethodGroup[];
  selectedOfferKey: string | null;
  setSelectedOfferKey: (key: string | null) => void;
  hoveredOhlcTime: number | null;
  setHoveredOhlcTime: (t: number | null) => void;
  loading: boolean;
  refPrice: number | null;
  /** Score-0 offers in the current monitor filter view (premium, direction, etc.). */
  zeroTrustHiddenCount: number;
  /** Stable offer keys (see buildStableOfferKey) excluded from the OHLC chart overlay via the table's checkboxes. */
  hiddenChartOfferKeys: Set<string>;
  toggleChartOfferKey: (key: string) => void;
  /** Shows/hides all of `keys` on the chart (used by the table's header "select all" checkbox). */
  setChartOfferKeysVisible: (keys: string[], visible: boolean) => void;
}

export const FiltersContext = createContext<FiltersContextValue | null>(null);

export function useFilters(): FiltersContextValue {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error('useFilters must be used inside <FiltersProvider>');
  return ctx;
}
