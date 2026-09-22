import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyOfferIdButton } from './CopyOfferIdButton';
import { copyableOfferId } from '../features/trading/providerRegistry';

afterEach(() => {
  cleanup();
});

describe('copyableOfferId', () => {
  it('returns the id for Bisq 1 and Bisq 2 offers', () => {
    expect(copyableOfferId('bisq', 'offer-1')).toBe('offer-1');
    expect(copyableOfferId('bisq2', 'offer-2')).toBe('offer-2');
    expect(copyableOfferId('Bisq', '  offer-3  ')).toBe('offer-3');
  });

  it('returns null without an id or for web-based venues', () => {
    expect(copyableOfferId('bisq', null)).toBeNull();
    expect(copyableOfferId('bisq2', '   ')).toBeNull();
    expect(copyableOfferId('hodlhodl', 'hh-1')).toBeNull();
    expect(copyableOfferId('robosats', '123')).toBeNull();
    expect(copyableOfferId('mostro', 'm-1')).toBeNull();
  });
});

describe('CopyOfferIdButton', () => {
  it('copies the offer id and confirms', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyOfferIdButton offerId="bisq-offer-1" />);
    fireEvent.click(screen.getByTestId('copy-offer-id'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('bisq-offer-1'));
    expect(screen.getByRole('button', { name: 'Offer ID copied' })).toBeTruthy();
    expect(screen.getByText('✓ Copied')).toBeTruthy();
  });
});
