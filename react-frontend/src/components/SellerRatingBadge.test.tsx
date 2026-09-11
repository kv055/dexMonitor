import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CounterpartyStakeBadge, SellerRatingBadge } from './SellerRatingBadge';
import { formatBisq2ReputationDetail, formatBondChip, formatFiveSystemStars, readBisq2ReputationRaw, sellerRatingScoreClass, shouldShowBondChip } from './sellerRating';

afterEach(() => {
  cleanup();
});

describe('sellerRatingScoreClass', () => {
  it('never paints feedback_new green', () => {
    expect(sellerRatingScoreClass(90, 'feedback_new')).toContain('text-accent');
    expect(sellerRatingScoreClass(90, 'feedback_new')).not.toContain('text-green');
    expect(sellerRatingScoreClass(20, 'feedback_new')).toContain('text-red');
  });

  it('uses verified, signing, and reputation bands', () => {
    expect(sellerRatingScoreClass(80, 'feedback_verified')).toContain('text-green');
    expect(sellerRatingScoreClass(60, 'feedback_verified')).toContain('text-accent');
    expect(sellerRatingScoreClass(0, 'account_signing')).toContain('text-red');
    expect(sellerRatingScoreClass(20, 'account_signing')).toContain('text-accent');
    expect(sellerRatingScoreClass(80, 'account_signing')).toContain('text-green');
    expect(sellerRatingScoreClass(72, 'reputation_bonded')).toContain('text-green');
    expect(sellerRatingScoreClass(50, 'reputation_bonded')).toContain('text-accent');
  });
});

describe('formatBondChip', () => {
  it('formats a 3% fraction as counterparty stake', () => {
    expect(formatBondChip(0.03)).toBe('3% stake');
  });
});

describe('shouldShowBondChip', () => {
  it('shows a stake chip whenever a positive maker lock is present', () => {
    expect(shouldShowBondChip(0.03)).toBe(true);
    expect(shouldShowBondChip(0.15)).toBe(true);
    expect(shouldShowBondChip(null)).toBe(false);
    expect(shouldShowBondChip(0)).toBe(false);
  });
});

describe('SellerRatingBadge', () => {
  it('always shows the methodology tag next to a numeric score', () => {
    render(<SellerRatingBadge score={52} confidence="feedback_new" compact />);
    expect(screen.getByText('52')).toBeTruthy();
    expect(screen.getByText('new')).toBeTruthy();
  });

  it('renders a stake chip instead of a fake 0–100 for RoboSats', () => {
    render(<SellerRatingBadge score={null} confidence="unavailable" compact bondPct={0.03} />);
    expect(screen.getByText('3% stake')).toBeTruthy();
  });

  it('renders an em dash when there is no score and no stake', () => {
    render(<SellerRatingBadge score={null} confidence="unavailable" compact />);
    expect(screen.getByTitle('No rating available').textContent).toContain('—');
  });

  it('renders Bisq 2 unstaked makers from the offerbook raw blob', () => {
    render(
      <SellerRatingBadge
        score={null}
        confidence="unavailable"
        compact
        raw={{ total_score: 0, five_system_score: 0, ranking: 0 }}
      />,
    );
    expect(screen.getByText('0★')).toBeTruthy();
    expect(screen.getByText('unstaked')).toBeTruthy();
  });

  it('keeps the 0–100 badge for staked Bisq 2 makers', () => {
    render(
      <SellerRatingBadge
        score={82}
        confidence="reputation_bonded"
        compact
        raw={{ total_score: 70969, five_system_score: 4.5, ranking: 11 }}
      />,
    );
    expect(screen.getByText('82')).toBeTruthy();
    expect(screen.getByText('reputation')).toBeTruthy();
    expect(screen.queryByText('unstaked')).toBeNull();
  });
});

describe('readBisq2ReputationRaw', () => {
  it('reads the snapshot raw blob and ignores other venues', () => {
    expect(readBisq2ReputationRaw({ total_score: 70969, five_system_score: 4.5, ranking: 11 })).toEqual({
      totalScore: 70969,
      fiveSystemScore: 4.5,
      ranking: 11,
    });
    expect(readBisq2ReputationRaw({ rating: 0.9, trades_count: 40 })).toBeNull();
    expect(formatFiveSystemStars(4.5)).toBe('4.5★');
    expect(formatBisq2ReputationDetail({ totalScore: 0, fiveSystemScore: 0, ranking: 0 })).toBe('0★ · unstaked');
    expect(formatBisq2ReputationDetail({ totalScore: 70969, fiveSystemScore: 4.5, ranking: 11 })).toBe(
      '4.5★ · 70,969 total · rank #11',
    );
  });
});

describe('CounterpartyStakeBadge', () => {
  it('renders the maker lock percentage', () => {
    render(<CounterpartyStakeBadge pct={0.05} />);
    expect(screen.getByText('5% stake')).toBeTruthy();
  });

  it('renders an em dash when the venue has no lock', () => {
    render(<CounterpartyStakeBadge pct={null} />);
    expect(screen.getByTitle('No counterparty stake').textContent).toContain('—');
  });
});
