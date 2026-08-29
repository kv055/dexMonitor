import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/client', () => ({
  apiFetch: vi.fn().mockResolvedValue({
    transactions: [
      {
        id: 17,
        direction: 'bid',
        fiat_amount: 1000,
        fiat_currency: 'EUR',
        cex: 'kraken',
        dex: 'hodlhodl',
        status: 'LiquidityPreparationNeedsReview',
        status_reason: 'swap settlement outcome is unknown',
        total_transaction_pnl: 0,
        premium_over_cex_price_to_break_even_prediction: 1.25,
        created_at: '2026-08-29T12:00:00Z',
        updated_at: '2026-08-29T12:01:00Z',
      },
      {
        id: 18,
        direction: 'bid',
        fiat_amount: 500,
        fiat_currency: 'EUR',
        cex: 'kraken',
        dex: 'bisq',
        status: 'CexTradeSuccessful',
        status_reason: null,
        total_transaction_pnl: 0,
        premium_over_cex_price_to_break_even_prediction: 0,
        created_at: '2026-08-29T12:00:00Z',
        updated_at: '2026-08-29T12:01:00Z',
      },
    ],
    total: 2,
    limit: 20,
    offset: 0,
  }),
}));

vi.mock('../hooks/useTimezone', () => ({
  useTimezone: () => ({ timezone: 'UTC' }),
}));

import { MmTransactionsLog } from './MmTransactionsLog';
import { PreferencesProvider } from '../context/PreferencesContext';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MmTransactionsLog', () => {
  it('renders canonical statuses and exposes the review reason', async () => {
    const user = userEvent.setup();
    render(
      <PreferencesProvider>
        <MmTransactionsLog />
      </PreferencesProvider>,
    );

    expect(await screen.findByText('Liquidity review')).toBeTruthy();
    expect(screen.getByText('CEX trade')).toBeTruthy();
    expect(screen.queryByText('CexTradeSucessfull')).toBeNull();

    await user.click(screen.getByText('Liquidity review'));
    expect(screen.getByText('Status reason')).toBeTruthy();
    expect(screen.getByText('swap settlement outcome is unknown')).toBeTruthy();
  });
});
