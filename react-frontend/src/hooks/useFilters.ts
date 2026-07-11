import { createContext, useContext } from 'react';
import type { Filters, Offer, PaymentMethodGroup } from '../types';

/**
 * Chart-overlay visibility is tracked per view: the Monitor chart shows all
 * offers unless unticked, while the Insights chart starts with everything
 * hidden and only draws explicitly ticked offers.
 */
export type ChartScope = 'monitor' | 'insights';

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
  /** Whether the offer (by stable key, see buildStableOfferKey) is drawn on the scope's OHLC chart. */
  isChartOfferVisible: (scope: ChartScope, key: string) => boolean;
  toggleChartOfferKey: (scope: ChartScope, key: string) => void;
  /** Shows/hides all of `keys` on the chart (used by the table's header "select all" checkbox). */
  setChartOfferKeysVisible: (scope: ChartScope, keys: string[], visible: boolean) => void;
  /**
   * Hides every offer from the Insights chart, including ones that arrive
   * later — offers there render only when explicitly ticked. Used by the
   * Insights Live/Past switch to avoid drawing dozens of overlays at once.
   */
  hideAllChartOffers: () => void;
}

export const FiltersContext = createContext<FiltersContextValue | null>(null);

export function useFilters(): FiltersContextValue {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error('useFilters must be used inside <FiltersProvider>');
  return ctx;
}
