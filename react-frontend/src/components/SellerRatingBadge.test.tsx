import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CounterpartyStakeBadge, SellerRatingBadge } from './SellerRatingBadge';
import { formatBondChip, sellerRatingScoreClass, shouldShowBondChip } from './sellerRating';

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
