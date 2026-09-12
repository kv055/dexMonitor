import type { Filters } from '../types';

const BASE_FILTERS: Filters = {
  direction: '',
  exchange: '',
  excludedExchanges: [],
  payment: '',
	// The initial monitor remains a complete market view. Linked methods are
	// an opt-in trading filter; defaulting to them hides valid offers before
	// the account catalogue has loaded.
	paymentScope: 'all',
  selectedLinkedPaymentMethods: [],
  status: 'open',
  premiumOnly: true,
  premiumMin: '',
  premiumMax: '',
  profitMin: '',
  profitMax: '',
  rangeMetric: 'profit',
  premiumMode: 'net_full',
  hours: '24',
  cex: 'kraken',
  fiat: 'EUR',
};

/** Used by resetFilters — premium range cleared */
export const RESET_FILTERS: Filters = { ...BASE_FILTERS };

/** Used on first mount only. Live range defaults to net profit. */
export const INITIAL_FILTERS: Filters = { ...BASE_FILTERS };

type Action =
  | { type: 'SET'; payload: Partial<Filters> }
  | { type: 'RESET' };

export function filtersReducer(state: Filters, action: Action): Filters {
  switch (action.type) {
    case 'SET':
      return { ...state, ...action.payload };
    case 'RESET':
      return RESET_FILTERS;
  }
}
