import type { Filters } from '../types';

export const DEFAULT_FILTERS: Filters = {
  direction: '',
  exchange: '',
  payment: '',
  status: 'open',
  premiumOnly: true,
  premiumMin: '0',
  premiumMax: '30',
  premiumMode: 'raw',
  hours: '24',
  cex: 'kraken',
};

type Action =
  | { type: 'SET'; payload: Partial<Filters> }
  | { type: 'RESET' };

export function filtersReducer(state: Filters, action: Action): Filters {
  switch (action.type) {
    case 'SET':
      return { ...state, ...action.payload };
    case 'RESET':
      return DEFAULT_FILTERS;
  }
}
