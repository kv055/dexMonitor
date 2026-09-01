import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SellerRatingBadge } from './SellerRatingBadge';
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
  it('formats a 3% fraction', () => {
    expect(formatBondChip(0.03)).toBe('3% bond');
  });
});

describe('shouldShowBondChip', () => {
  it('shows leftover stake_bonded and nil-score deposits', () => {
    expect(shouldShowBondChip(50, 'stake_bonded', 0.03)).toBe(true);
    expect(shouldShowBondChip(null, 'unavailable', 0.03)).toBe(true);
    expect(shouldShowBondChip(80, 'feedback_verified', 0.03)).toBe(false);
    expect(shouldShowBondChip(null, 'unavailable', null)).toBe(false);
  });
});

describe('SellerRatingBadge', () => {
  it('always shows the methodology tag next to a numeric score', () => {
    render(<SellerRatingBadge score={52} confidence="feedback_new" compact />);
    expect(screen.getByText('52')).toBeTruthy();
    expect(screen.getByText('new')).toBeTruthy();
  });

  it('renders a bond chip instead of a fake 0–100 for RoboSats', () => {
    render(<SellerRatingBadge score={null} confidence="unavailable" compact bondPct={0.03} />);
    expect(screen.getByText('3% bond')).toBeTruthy();
  });

  it('renders an em dash when there is no score and no bond', () => {
    render(<SellerRatingBadge score={null} confidence="unavailable" compact />);
    expect(screen.getByTitle('No rating available').textContent).toContain('—');
  });
});
