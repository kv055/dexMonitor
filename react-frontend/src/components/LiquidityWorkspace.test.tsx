import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/api', () => ({
  fetchTradingAccounts: vi.fn().mockResolvedValue([
    {
      id: 7,
      provider: 'Kraken',
      category: 'CEX',
      is_active: true,
      is_healthy: true,
      api_keys: [{ is_active: true }],
    },
  ]),
  fetchLNDWalletStatus: vi.fn().mockResolvedValue({
    addresses: [{ address: 'bc1qlndwalletdestination000000000000000000', kind: 'onchain', label: 'Liquidity pool', balance_sat: 1250000 }],
    channels: [{ remote_pubkey: '03remote', remote_alias: 'Hub', capacity_sat: 1000000, local_balance_sat: 600000, remote_balance_sat: 400000, active: true, private: false, channel_point: 'txid:0' }],
  }),
  fetchCexBalances: vi.fn().mockResolvedValue({ bitcoin: { asset: 'BTC', available: 0.25, total: 0.3 }, fiat: [{ asset: 'EUR', available: 1000, total: 1000 }], source: 'Kraken' }),
  fetchCexHedgePositions: vi.fn().mockResolvedValue({ active: [{ size_btc: -0.1 }, { size_btc: 0.05 }], past: [] }),
  fetchCexDepositAddresses: vi.fn().mockResolvedValue([
    { asset: 'BTC', network: 'Bitcoin', address: 'bc1qkrakendeposit000000000000000000', label: 'Treasury' },
  ]),
  openLNDChannel: vi.fn(),
  closeLNDChannel: vi.fn(),
}));

import { LiquidityWorkspace } from './LiquidityWorkspace';
import { fetchCexBalances, fetchCexHedgePositions, fetchLNDWalletStatus } from '../utils/api';

afterEach(cleanup);

describe('LiquidityWorkspace', () => {
  it('shows every collateral location with current and target states', () => {
    render(<LiquidityWorkspace />);

    expect(screen.getByText('CEX Spot & Hedge')).toBeTruthy();
    expect(screen.getByText('LND Liquidity')).toBeTruthy();
    expect(screen.getByText('Lightning Channel Liquidity')).toBeTruthy();
    expect(screen.getByText('DEX Wallet / Pending Contracts')).toBeTruthy();
    expect(screen.getAllByText('Current')).toHaveLength(4);
    expect(screen.getAllByText('Target')).toHaveLength(4);
    expect(screen.getAllByText('Not configured')).toHaveLength(4);
    expect(screen.getAllByText('Not connected')).toHaveLength(1);
  });

  it('aggregates healthy CEX balances and live LND on-chain and channel liquidity', async () => {
    render(<LiquidityWorkspace />);

    expect(await screen.findByText('0.25 BTC spot')).toBeTruthy();
    expect(screen.getByText('2 hedges · 0.15 BTC exposure')).toBeTruthy();
    expect(screen.getByText('EUR 1,000')).toBeTruthy();
    expect(screen.getByText('0.0125 BTC')).toBeTruthy();
    expect(screen.getByText('0.006 BTC outbound')).toBeTruthy();
    expect(screen.getByText('0.004 BTC inbound')).toBeTruthy();
  });

  it('refreshes all live liquidity sources on demand', async () => {
    const user = userEvent.setup();
    render(<LiquidityWorkspace />);
    await screen.findByText('0.25 BTC spot');
    const before = vi.mocked(fetchCexBalances).mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(vi.mocked(fetchCexBalances).mock.calls.length).toBeGreaterThan(before));
    expect(vi.mocked(fetchCexHedgePositions)).toHaveBeenCalled();
    expect(vi.mocked(fetchLNDWalletStatus)).toHaveBeenCalled();
  });

  it('builds the fill route from a connected CEX BTC wallet to the LND wallet', async () => {
    const user = userEvent.setup();
    render(<LiquidityWorkspace />);

    await screen.findByRole('option', { name: 'Kraken' });
    expect(await screen.findByText('Kraken BTC wallet')).toBeTruthy();
    expect(screen.getByText('LND on-chain wallet')).toBeTruthy();
    await user.type(screen.getByPlaceholderText('0.00000000'), '0.025');
    await user.click(screen.getByRole('button', { name: 'Create transfer request' }));

    expect(screen.getByRole('status').textContent).toContain('wallet-transfer API is not connected');
  });

  it('reverses the wallet route and loads the CEX BTC deposit address when draining', async () => {
    const user = userEvent.setup();
    render(<LiquidityWorkspace />);

    await screen.findByRole('option', { name: 'Kraken' });
    await user.click(screen.getByRole('tab', { name: /drain lnd pool/i }));

    await screen.findByRole('option', { name: /CEX BTC deposit address.*Bitcoin.*bc1qkraken/ });
    expect(screen.getByText('LND on-chain wallet')).toBeTruthy();
    expect(screen.getByText('Kraken BTC wallet')).toBeTruthy();
  });

  it('allows a manual BTC address as the drain destination', async () => {
    const user = userEvent.setup();
    render(<LiquidityWorkspace />);

    await user.click(screen.getByRole('tab', { name: /drain lnd pool/i }));
    await user.click(screen.getByRole('button', { name: 'Manual address' }));
    await user.type(screen.getByPlaceholderText('Paste a Bitcoin address'), 'bc1qexternaldestination0000000000000000');
    await user.type(screen.getByPlaceholderText('0.00000000'), '0.01');

    expect(screen.getByText('External BTC address')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create transfer request' }));
    expect(screen.getByRole('status').textContent).toContain('wallet-transfer API is not connected');
  });

  it('exposes channel opening validation and the live channel list', async () => {
    const user = userEvent.setup();
    render(<LiquidityWorkspace />);

    await user.click(screen.getByRole('tab', { name: /lightning channels/i }));
    expect(screen.getByText('Hub')).toBeTruthy();
    await user.click(screen.getByText('Open a new channel'));
    await user.click(screen.getByRole('button', { name: 'Open channel' }));

    expect(screen.getByRole('alert').textContent).toContain('Enter a node pubkey');
  });
});
