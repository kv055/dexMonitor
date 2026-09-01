import { describe, expect, it } from 'vitest';

import type { Offer } from '../types';
import { getReputationBondPct, getSellerRatingScore, hasZeroTrustScore } from './offerAccess';

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

describe('getReputationBondPct', () => {
  const withDeposit = (exchange: string, pct: number, confidence: Offer['seller_rating_confidence'] = 'unavailable'): Offer =>
    baseOffer({
      exchange,
      seller_rating_confidence: confidence,
      analysis: {
        full_volume: {
          trade_size_btc: 0.01,
          trade_size_fiat: 600,
          route: { cex: 'kraken', settlement: 'onchain' },
          premium: {},
          profit: {},
          costs: {} as Offer['analysis'] extends { full_volume: { costs: infer C } } ? C : never,
          capital: {
            btc_amount: 0.01,
            btc_price: 60000,
            spot_notional: 600,
            hedge_collateral: 0,
            security_deposit_pct: pct,
            security_deposit_side: 'taker',
            security_deposit_btc: 0.0003,
            security_deposit_fiat: 18,
            total_fiat: 618,
            deposit_estimated: false,
          },
        },
      } as NonNullable<Offer['analysis']>,
    });

  it('returns the RoboSats deposit fraction', () => {
    expect(getReputationBondPct(withDeposit('robosats', 0.03))).toBe(0.03);
  });

  it('returns leftover stake_bonded deposits on any venue', () => {
    expect(getReputationBondPct(withDeposit('hodlhodl', 0.03, 'stake_bonded'))).toBe(0.03);
  });

  it('does not surface Bisq deposits as a reputation bond', () => {
    expect(getReputationBondPct(withDeposit('bisq', 0.15, 'unavailable'))).toBeNull();
  });
});

describe('getSellerRatingScore', () => {
  it('preserves a genuine 0', () => {
    expect(getSellerRatingScore(baseOffer({ seller_rating_score: 0 }))).toBe(0);
  });
});
