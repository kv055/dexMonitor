import { describe, expect, it } from 'vitest';
import {
  buildAnalyticsBody,
  buildLiveOffersSearch,
  buildPastOffersSearch,
  buildStatisticsBody,
  marketRequestKey,
  type MarketRequestParams,
} from './marketParams';

const params: MarketRequestParams = {
  hours: '48', cex: 'coinbase', fiat: 'USD',
  capabilityRevision: 0,
  maxFiatLimit: 5_000,
};

describe('market request parameters', () => {
  it('uses stable keys for the same request parameters', () => {
    expect(marketRequestKey(params)).toBe(marketRequestKey({ ...params }));
  });

  it('refreshes market requests when central capability policy changes', () => {
    expect(marketRequestKey(params)).not.toBe(marketRequestKey({ ...params, capabilityRevision: 1 }));
  });

  it('does not serialize browser routing preferences into live requests', () => {
    const live = new URLSearchParams(buildLiveOffersSearch(params));
    const past = new URLSearchParams(buildPastOffersSearch(params));
    for (const search of [live, past]) {
      expect(search.get('cex')).toBe('coinbase');
      expect(search.get('fiat')).toBe('USD');
    }
	 expect(live.has('coupled_hedge')).toBe(false);
	 expect(live.has('fee_tier')).toBe(false);
	 expect(live.has('max_fiat_limit')).toBe(false);
	 expect(past.get('max_fiat_limit')).toBe('5000');
    expect(past.has('exclude_payment_methods')).toBe(false);
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

  it('sends Insights offer filters only on the statistics body', () => {
    expect(buildStatisticsBody(params, {
      direction: 'ask',
      excludedExchanges: ['hodlhodl'],
      includePaymentMethods: ['SEPA Instant'],
      paymentScope: 'linked',
      premiumMode: 'net_full',
      premiumOnly: true,
      rangeMetric: 'profit',
      profitMin: 0.01,
      profitMax: 10.26,
    })).toMatchObject({
      fiat: 'USD',
      hours: 48,
      cex: 'coinbase',
      direction: 'ask',
      excluded_exchanges: ['hodlhodl'],
      include_payment_methods: ['SEPA Instant'],
      payment_scope: 'linked',
      premium_mode: 'net_full',
      premium_only: true,
      range_metric: 'profit',
      profit_min: 0.01,
      profit_max: 10.26,
    });
    expect(buildStatisticsBody(params, {
      pastRange: { startDate: '2026-01-01', endDate: '2026-01-31', timezone: 'UTC' },
    })).toMatchObject({
      past_start_date: '2026-01-01',
      past_end_date: '2026-01-31',
      timezone: 'UTC',
    });
    expect(buildAnalyticsBody(params)).not.toHaveProperty('direction');
  });
});
