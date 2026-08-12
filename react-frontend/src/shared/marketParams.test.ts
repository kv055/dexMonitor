import { describe, expect, it } from 'vitest';
import {
  buildAnalyticsBody,
  buildLiveOffersSearch,
  buildPastOffersSearch,
  marketRequestKey,
  type MarketRequestParams,
} from './marketParams';

const params: MarketRequestParams = {
  hours: '48', cex: 'coinbase', fiat: 'USD',
  capabilityRevision: 0,
  excludedPaymentMethods: ['Cash App', 'SEPA'],
  feeTier: 'high', coupledHedge: false, maxFiatLimit: 5_000,
};

describe('market request parameters', () => {
  it('uses stable keys when exclusion order changes', () => {
    expect(marketRequestKey(params)).toBe(marketRequestKey({
      ...params,
      excludedPaymentMethods: [...params.excludedPaymentMethods].reverse(),
    }));
  });

  it('refreshes market requests when central capability policy changes', () => {
    expect(marketRequestKey(params)).not.toBe(marketRequestKey({ ...params, capabilityRevision: 1 }));
  });

  it('serializes the shared trade-cost contract consistently', () => {
    const live = new URLSearchParams(buildLiveOffersSearch(params));
    const past = new URLSearchParams(buildPastOffersSearch(params));
    for (const search of [live, past]) {
      expect(search.get('cex')).toBe('coinbase');
      expect(search.get('fiat')).toBe('USD');
      expect(search.get('coupled_hedge')).toBe('false');
      expect(search.get('max_fiat_limit')).toBe('5000');
    }
    expect(past.get('exclude_payment_methods')).toBe('Cash App,SEPA');
  });

  it('propagates the selected fiat into analytics and statistics bodies', () => {
    expect(buildAnalyticsBody(params)).toMatchObject({ fiat: 'USD', hours: 48, cex: 'coinbase' });
  });

  it('adds only an explicitly selected custom range to analytics requests', () => {
    expect(buildAnalyticsBody(params, ['taker_orders_full'], {
      startDate: '2026-01-01', endDate: '2026-01-31', timezone: 'Europe/Berlin',
    })).toMatchObject({
      past_start_date: '2026-01-01',
      past_end_date: '2026-01-31',
      timezone: 'Europe/Berlin',
    });
    expect(buildAnalyticsBody(params)).not.toHaveProperty('past_start_date');
  });
});
