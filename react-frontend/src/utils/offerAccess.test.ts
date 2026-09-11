import { describe, expect, it } from 'vitest';

import type { Offer, PastProfitableOrder } from '../types';
import { asJsonObject, getCounterpartyStakePct, getSellerRatingScore, hasZeroTrustScore, pastProfitableOrderAsOffer } from './offerAccess';

function baseOffer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 1,
    exchange: 'hodlhodl',
    direction: 'ask',
    payment_methods: ['SEPA'],
    offer_id: 'o1',
    ...overrides,
  };
}

describe('hasZeroTrustScore', () => {
  it('hides banned Bisq 1 and wrecked feedback at score 0', () => {
    expect(hasZeroTrustScore(baseOffer({
      seller_rating_score: 0,
      seller_rating_confidence: 'account_signing',
    }))).toBe(true);
    expect(hasZeroTrustScore(baseOffer({
      seller_rating_score: 0,
      seller_rating_confidence: 'feedback_verified',
    }))).toBe(true);
    expect(hasZeroTrustScore(baseOffer({
      seller_rating_score: 0,
      seller_rating_confidence: 'feedback_new',
    }))).toBe(true);
  });

  it('does not hide unrated, unstaked, or RoboSats bond-only offers', () => {
    expect(hasZeroTrustScore(baseOffer({
      seller_rating_score: null,
      seller_rating_confidence: 'unavailable',
    }))).toBe(false);
    expect(hasZeroTrustScore(baseOffer({
      seller_rating_score: 0,
      seller_rating_confidence: 'reputation_bonded',
    }))).toBe(false);
    expect(hasZeroTrustScore(baseOffer({
      exchange: 'robosats',
      seller_rating_score: 0,
      seller_rating_confidence: 'stake_bonded',
    }))).toBe(false);
    expect(hasZeroTrustScore(baseOffer({ seller_rating_score: 20, seller_rating_confidence: 'account_signing' }))).toBe(false);
  });
});

describe('getCounterpartyStakePct', () => {
  it('returns the maker lock for RoboSats and Bisq 1', () => {
    expect(getCounterpartyStakePct(baseOffer({ exchange: 'robosats', counterparty_stake_pct: 0.03 }))).toBe(0.03);
    expect(getCounterpartyStakePct(baseOffer({ exchange: 'bisq', counterparty_stake_pct: 0.05 }))).toBe(0.05);
  });

  it('ignores taker security deposits and missing axes', () => {
    expect(getCounterpartyStakePct(baseOffer({
      exchange: 'bisq',
      analysis: {
        full_volume: {
          trade_size_btc: 0.01,
          trade_size_fiat: 600,
          route: { cex: 'kraken', settlement: 'onchain' },
          premium: {},
          profit: {},
          costs: {} as never,
          capital: {
            btc_amount: 0.01,
            btc_price: 60000,
            spot_notional: 600,
            hedge_collateral: 0,
            security_deposit_pct: 0.15,
            security_deposit_side: 'buyer',
            security_deposit_btc: 0.0015,
            security_deposit_fiat: 90,
            total_fiat: 690,
            deposit_estimated: false,
          },
        },
      } as NonNullable<Offer['analysis']>,
    }))).toBeNull();
    expect(getCounterpartyStakePct(baseOffer({ exchange: 'hodlhodl' }))).toBeNull();
  });
});

describe('getSellerRatingScore', () => {
  it('preserves a genuine 0', () => {
    expect(getSellerRatingScore(baseOffer({ seller_rating_score: 0 }))).toBe(0);
  });
});

describe('asJsonObject', () => {
  it('parses objects and JSON strings', () => {
    expect(asJsonObject({ rating: 0.98 })).toEqual({ rating: 0.98 });
    expect(asJsonObject('{"source":"hodlhodl"}')).toEqual({ source: 'hodlhodl' });
    expect(asJsonObject('')).toBeNull();
    expect(asJsonObject(null)).toBeNull();
  });
});

describe('pastProfitableOrderAsOffer', () => {
  it('copies counterparty rating and stake fields from the stored payload', () => {
    const offer = pastProfitableOrderAsOffer({
      id: 9,
      exchange: 'hodlhodl',
      direction: 'bid',
      status: { first_seen: '2026-01-01', last_seen: '2026-01-02', is_live: false },
      pricing: { price_type: 'fixed', fiat_currency: 'EUR' },
      summary: { net_profit_btc: 0, net_profit_fiat: 0, trade_size_btc: 0.01, trade_size_fiat: 600, net_percent: 1 },
      analysis: {
        full_volume: {
          trade_size_btc: 0.01,
          trade_size_fiat: 600,
          route: { cex: 'kraken', settlement: 'onchain' },
          premium: {},
          profit: {},
          costs: {} as PastProfitableOrder['analysis']['full_volume']['costs'],
        },
      },
      offer: {
        seller_rating_score: 73,
        seller_rating_confidence: 'feedback_verified',
        seller_rating_raw: { rating: 0.98, trades_count: 42 },
        seller_rating_signals: '{"source":"hodlhodl","online_status":"online"}',
        counterparty_stake_pct: 0.03,
        counterparty_stake_btc: 0.0003,
      },
    });
    expect(offer.seller_rating_score).toBe(73);
    expect(offer.seller_rating_confidence).toBe('feedback_verified');
    expect(offer.seller_rating_raw).toEqual({ rating: 0.98, trades_count: 42 });
    expect(offer.seller_rating_signals).toEqual({ source: 'hodlhodl', online_status: 'online' });
    expect(offer.counterparty_stake_pct).toBe(0.03);
    expect(offer.counterparty_stake_btc).toBe(0.0003);
  });
});
