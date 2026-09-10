import { describe, expect, it } from 'vitest';

import { selectPremiumScatterPoints } from './OfferLifecyclePremiumChart';
import type { OfferLifecyclePremiumPoint } from '../types';

const points: OfferLifecyclePremiumPoint[] = [
  {
    lifecycle_hours: 1,
    premium_rate_pct: 2.5,
    volume_btc: 0.01,
    counterparty_stake_btc: 0.0045,
    counterparty_stake_pct: 0.03,
    exchange: 'robosats',
    direction: 'ask',
    is_live: true,
  },
  {
    lifecycle_hours: 4,
    premium_rate_pct: 1.8,
    volume_btc: 0.2,
    exchange: 'hodlhodl',
    direction: 'ask',
    is_live: false,
  },
  {
    lifecycle_hours: 2,
    premium_rate_pct: -0.5,
    volume_btc: 0.03,
    counterparty_stake_btc: 0.01,
    counterparty_stake_pct: 0.05,
    exchange: 'bisq',
    direction: 'bid',
    is_live: true,
  },
  {
    lifecycle_hours: 3,
    premium_rate_pct: 3.1,
    volume_btc: 0.05,
    counterparty_stake_btc: 0,
    counterparty_stake_pct: 0,
    exchange: 'bisq',
    direction: 'ask',
    is_live: false,
  },
];

describe('selectPremiumScatterPoints', () => {
  it('keeps every positive-premium offer on lifecycle and volume charts', () => {
    expect(selectPremiumScatterPoints(points, 'lifecycle').map(point => point.exchange)).toEqual([
      'robosats',
      'hodlhodl',
      'bisq',
    ]);
    expect(selectPremiumScatterPoints(points, 'volume')).toHaveLength(3);
  });

  it('omits null and non-positive counterparty deposits from both deposit charts', () => {
    expect(selectPremiumScatterPoints(points, 'depositBtc').map(point => point.exchange)).toEqual([
      'robosats',
    ]);
    expect(selectPremiumScatterPoints(points, 'depositPct').map(point => point.exchange)).toEqual([
      'robosats',
    ]);
  });
});
