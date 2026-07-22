import type { Filters } from '../types';

const BASE_FILTERS: Filters = {
  direction: '',
  exchange: '',
  excludedExchanges: [],
  payment: '',
  status: 'open',
  premiumOnly: true,
  premiumMin: '',
  premiumMax: '',
  premiumMode: 'net_full',
  hours: '24',
  cex: 'kraken',
  fiat: 'EUR',
};

/** Used by resetFilters — premium range cleared */
export const RESET_FILTERS: Filters = { ...BASE_FILTERS };

/** Used on first mount only — premium range pre-filled */
export const INITIAL_FILTERS: Filters = {
  ...BASE_FILTERS,
  premiumMin: '0',
  premiumMax: '30',
};

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
