import { describe, expect, it } from 'vitest';
import { INITIAL_FILTERS } from '../../context/filtersState';
import type { Offer } from '../../types';
import { applyOfferFilters, countOffersByPaymentMethod } from './filterOffers';

function offer(id: number, premium: number, methods: string[], estimatedProfitFiat = 0): Offer {
  return {
    id, exchange: 'bisq', direction: 'bid', payment_methods: methods,
    offer_id: String(id), net_premium_percent: premium, estimated_profit_fiat: estimatedProfitFiat,
  };
}

describe('offer filtering', () => {
  it('sorts a copy and leaves the source feed order unchanged', () => {
    const offers = [offer(1, 4, ['SEPA']), offer(2, 2, ['Revolut'])];
    const filtered = applyOfferFilters(offers, {
      ...INITIAL_FILTERS,
      status: '', premiumOnly: false, premiumMin: '', premiumMax: '',
    }, null);
    expect(filtered.map(item => item.id)).toEqual([2, 1]);
    expect(offers.map(item => item.id)).toEqual([1, 2]);
  });

  it('counts each payment method represented by an offer', () => {
    expect(countOffersByPaymentMethod([
      offer(1, 1, ['SEPA', 'Revolut']), offer(2, 2, ['SEPA']),
    ])).toEqual({ SEPA: 2, Revolut: 1 });
  });

  it('applies only the range currently selected by the live range control', () => {
    const offers = [offer(1, -3, ['SEPA'], -25), offer(2, 0, ['Revolut'], 0)];
    const common = {
      ...INITIAL_FILTERS,
      status: '', premiumOnly: false,
      premiumMin: '0', premiumMax: '30', profitMin: '-100', profitMax: '100',
    };

    expect(applyOfferFilters(offers, { ...common, rangeMetric: 'profit' }, null).map(item => item.id)).toEqual([1, 2]);
    expect(applyOfferFilters(offers, { ...common, rangeMetric: 'premium' }, null).map(item => item.id)).toEqual([2]);
  });
});
