import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  fetchLNDChannelPresets: vi.fn().mockResolvedValue({
    presets: [{ id: 'kraken', name: 'Kraken', node_pubkey: '02f1', peer_host: '52.13.118.208:9735', min_funding_amount_sat: 1000000, source_url: 'https://example.test/kraken', verified_at: '2026-08-11', enabled: true }],
  }),
  fetchLSPChannel: vi.fn().mockResolvedValue({ channel_point: '', remote_pubkey: '', provider_label: '', enabled: false, headroom_sat: 0, max_swap_fee_sat: 0, max_swap_fee_ppm: 0 }),
  fetchLSPChannelStatus: vi.fn().mockResolvedValue({ channel_point: '', remote_pubkey: '', provider_label: '', enabled: false, configured: false, lsp_healthy: false, reason: 'No LSP channel configured', headroom_sat: 0, max_swap_fee_sat: 0, max_swap_fee_ppm: 0, lsp_inbound_sat: 0, lsp_outbound_sat: 0, usable_inbound_sat: 0, usable_outbound_sat: 0 }),
  fetchSubmarineSwaps: vi.fn().mockResolvedValue([]),
  fetchDexPendingLiquidity: vi.fn().mockResolvedValue({ btc_value: 0.0375, transaction_count: 2, statuses: ['DexPositionTaken', 'DexFiatHasArrived'] }),
  fetchCexBalances: vi.fn().mockResolvedValue({ bitcoin: { asset: 'BTC', available: 0.25, total: 0.3 }, fiat: [{ asset: 'EUR', available: 1000, total: 1000 }], source: 'Kraken' }),
  fetchCexHedgePositions: vi.fn().mockResolvedValue({ active: [{ size_btc: -0.1 }, { size_btc: 0.05 }], past: [] }),
  fetchCexDepositAddresses: vi.fn().mockResolvedValue([
    { asset: 'BTC', network: 'Bitcoin', address: 'bc1qkrakendeposit000000000000000000', label: 'Treasury' },
  ]),
  openLNDChannel: vi.fn(),
  closeLNDChannel: vi.fn(),
  updateLSPChannel: vi.fn().mockImplementation(payload => Promise.resolve(payload)),
  fetchTransactionalLiquiditySettings: vi.fn().mockRejectedValue(new Error('settings unavailable in test')),
  updateTransactionalLiquiditySettings: vi.fn(),
}));

import { LiquidityWorkspace } from './LiquidityWorkspace';
import { fetchDexPendingLiquidity, fetchLSPChannelStatus, fetchTransactionalLiquiditySettings, updateLSPChannel, updateTransactionalLiquiditySettings } from '../utils/api';
import { FiltersProvider } from '../context/FiltersContext';
import { PreferencesProvider } from '../context/PreferencesContext';
import { CEXPermissionsContext, type CEXPermissionsContextValue } from '../hooks/useCEXPermissions';
import type { Offer } from '../types';

function renderWorkspace(offers: Offer[] = []) {
  const cexPermissions: CEXPermissionsContextValue = {
    exchanges: [{
      account_id: 7, provider: 'Kraken', exchange: 'kraken', cost_supported: true, execution_supported: true, active_key_count: 1, permissions_checked_at: null,
      policy: { spot_enabled: true, hedge_enabled: true },
      spot: { supported: true, policy_enabled: true, available: true, effective_enabled: true, blocking_permissions: [], blockers: [] },
      hedge: { supported: true, policy_enabled: true, available: true, effective_enabled: true, blocking_permissions: [], blockers: [] },
    }],
    loading: false, ready: true, error: null, revision: 0, updating: null,
    updatePolicy: vi.fn(), reload: vi.fn(),
  };
  return render(
    <CEXPermissionsContext.Provider value={cexPermissions}>
      <PreferencesProvider>
        <FiltersProvider offers={offers} loading={false} groups={[]} excludedMethods={[]} hideZeroTrustScore={false}>
          <LiquidityWorkspace />
        </FiltersProvider>
      </PreferencesProvider>
    </CEXPermissionsContext.Provider>,
  );
}

beforeEach(() => {
  window.localStorage.removeItem('dex-max-fiat-limit');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.removeItem('dex-max-fiat-limit');
});

describe('LiquidityWorkspace', () => {
  it('shows every collateral location with current and target states', async () => {
    renderWorkspace();

    expect(screen.getByText('CEX Spot & Hedge')).toBeTruthy();
    expect(screen.getByText('Mainnet Hub Liquidity')).toBeTruthy();
    expect(screen.getByText('Lightning Channel Liquidity')).toBeTruthy();
    expect(screen.getByText('DEX Wallet / Pending Contracts')).toBeTruthy();
    expect(screen.getAllByText('Current')).toHaveLength(1);
    expect(screen.getByText('Current inventory')).toBeTruthy();
    expect(screen.getByText('Current balance')).toBeTruthy();
    expect(screen.getByText('Current channel balance')).toBeTruthy();
    expect(screen.getAllByText('Target')).toHaveLength(4);
    expect(screen.getAllByText('Not configured')).toHaveLength(3);
    expect(screen.getAllByText('0 BTC')).toHaveLength(1);
    expect(await screen.findByText('0.0375 BTC')).toBeTruthy();
    expect(screen.getByText('2 pending contracts')).toBeTruthy();
  });

  it('uses zero BTC targets for LND and Lightning liquidity in hedgefull mode', async () => {
    vi.mocked(fetchTransactionalLiquiditySettings).mockResolvedValueOnce({
      fiat_currency: 'EUR',
      amount_source: 'custom',
      amount_fiat: 100,
      fee_tier: 'economic', coupled_hedge: false,
      trade_mode: 'hedgefull_single_collateral',
      target_direction: 'bid',
      lightning_liquidity_source: 'own_channels',
      config_version: 1,
      updated_at: '2026-08-10T00:00:00Z',
    });

    renderWorkspace([{ id: 1, exchange: 'Bisq', direction: 'bid', payment_methods: [], offer_id: 'offer-1', is_live: true, ref_price: 50000 }]);

    expect(await screen.findByText('EUR 100')).toBeTruthy();
    expect(screen.getAllByText('0 BTC')).toHaveLength(3);
    expect(screen.getAllByText('no LND pool required')).toHaveLength(2);
    expect(screen.getAllByText('0 BTC')).toHaveLength(3);
  });

  it('switches to hedgeless mode and uses the fiat target converted to BTC for LND and Lightning', async () => {
    const hedgelessSettings = {
      fiat_currency: 'EUR', amount_source: 'custom' as const, amount_fiat: 100, fee_tier: 'economic' as const, coupled_hedge: false,
      trade_mode: 'hedgeless_double_collateral' as const, target_direction: 'bid' as const, lightning_liquidity_source: 'own_channels' as const, config_version: 2, updated_at: '2026-08-10T00:00:00Z',
    };
    vi.mocked(fetchTransactionalLiquiditySettings).mockResolvedValueOnce({ ...hedgelessSettings, trade_mode: 'hedgefull_single_collateral', config_version: 1 });
    vi.mocked(updateTransactionalLiquiditySettings).mockResolvedValueOnce(hedgelessSettings);

    const user = userEvent.setup();
    renderWorkspace([{ id: 1, exchange: 'Bisq', direction: 'bid', payment_methods: [], offer_id: 'offer-1', is_live: true, ref_price: 50000 }]);

    await screen.findByText('EUR 100');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.selectOptions(screen.getByLabelText('Trade mode'), 'hedgeless_double_collateral');
    await user.click(screen.getByRole('button', { name: 'Save target' }));
    expect(await screen.findAllByText('0.002 BTC')).toHaveLength(2);
    expect(screen.getAllByText('fiat target in BTC')).toHaveLength(2);
  });

  it('persists the selected target direction', async () => {
    const settings = {
      fiat_currency: 'EUR', amount_source: 'custom' as const, amount_fiat: 100, fee_tier: 'economic' as const, coupled_hedge: false,
      trade_mode: 'hedgefull_single_collateral' as const, target_direction: 'bid' as const, lightning_liquidity_source: 'own_channels' as const,
      config_version: 1, updated_at: '2026-08-10T00:00:00Z',
    };
    vi.mocked(fetchTransactionalLiquiditySettings).mockResolvedValueOnce(settings);
    vi.mocked(updateTransactionalLiquiditySettings).mockResolvedValueOnce({ ...settings, target_direction: 'ask', config_version: 2 });

    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('EUR 100');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByDisplayValue('Custom amount');
    await user.selectOptions(screen.getByLabelText('Target direction'), 'ask');
    await user.click(screen.getByRole('button', { name: 'Save target' }));

    expect(updateTransactionalLiquiditySettings).toHaveBeenCalledWith(expect.objectContaining({ target_direction: 'ask' }));
  });

  it('uses the Settings-overlay cap as the persisted capped-volume amount', async () => {
    window.localStorage.setItem('dex-max-fiat-limit', '500');
    const settings = {
      fiat_currency: 'EUR', amount_source: 'custom' as const, amount_fiat: 100, fee_tier: 'economic' as const, coupled_hedge: false,
      trade_mode: 'hedgefull_single_collateral' as const, target_direction: 'bid' as const, lightning_liquidity_source: 'own_channels' as const,
      config_version: 1, updated_at: '2026-08-10T00:00:00Z',
    };
    vi.mocked(fetchTransactionalLiquiditySettings).mockResolvedValueOnce(settings);
    vi.mocked(updateTransactionalLiquiditySettings).mockResolvedValueOnce({ ...settings, amount_source: 'capped_volume', amount_fiat: 500, config_version: 2 });

    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('EUR 100');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.selectOptions(screen.getByLabelText('Amount source'), 'capped_volume');

    const amountInput = screen.getByRole('spinbutton', { name: /Transactional liquidity/ });
    expect((amountInput as HTMLInputElement).value).toBe('500');
    expect(amountInput.hasAttribute('readonly')).toBe(true);
    expect(screen.getByText('Uses the Max Position Size (Fiat) from Settings.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Save target' }));
    expect(updateTransactionalLiquiditySettings).toHaveBeenCalledWith(expect.objectContaining({ amount_source: 'capped_volume', amount_fiat: 500 }));
  });

  it('requires a positive Settings-overlay cap before saving capped volume', async () => {
    const settings = {
      fiat_currency: 'EUR', amount_source: 'custom' as const, amount_fiat: 100, fee_tier: 'economic' as const, coupled_hedge: false,
      trade_mode: 'hedgefull_single_collateral' as const, target_direction: 'bid' as const, lightning_liquidity_source: 'own_channels' as const,
      config_version: 1, updated_at: '2026-08-10T00:00:00Z',
    };
    vi.mocked(fetchTransactionalLiquiditySettings).mockResolvedValueOnce(settings);

    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('EUR 100');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.selectOptions(screen.getByLabelText('Amount source'), 'capped_volume');
    await user.click(screen.getByRole('button', { name: 'Save target' }));

    expect(await screen.findByText('Set a positive Max Position Size (Fiat) in Settings before saving capped volume.')).toBeTruthy();
    expect(updateTransactionalLiquiditySettings).not.toHaveBeenCalled();
  });

  it('requires and persists the selected Lightning liquidity source', async () => {
    const settings = {
      fiat_currency: 'EUR', amount_source: 'custom' as const, amount_fiat: 100, fee_tier: 'economic' as const, coupled_hedge: false,
      trade_mode: 'hedgefull_single_collateral' as const, target_direction: 'bid' as const, lightning_liquidity_source: 'own_channels' as const,
      config_version: 1, updated_at: '2026-08-10T00:00:00Z',
    };
    vi.mocked(fetchTransactionalLiquiditySettings).mockResolvedValueOnce(settings);
    vi.mocked(updateTransactionalLiquiditySettings).mockResolvedValueOnce({ ...settings, lightning_liquidity_source: 'lsp_channel' });

    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('EUR 100');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const source = screen.getByLabelText('Lightning liquidity source');
    expect(source.getAttribute('required')).not.toBeNull();
    await user.selectOptions(source, 'lsp_channel');
    await user.click(screen.getByRole('button', { name: 'Save target' }));

    expect(updateTransactionalLiquiditySettings).toHaveBeenCalledWith(expect.objectContaining({ lightning_liquidity_source: 'lsp_channel' }));
    expect(await screen.findByText('LSP channel')).toBeTruthy();
  });

  it('aggregates healthy CEX balances and live LND on-chain and channel liquidity', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    expect(await screen.findByText('1,000 EUR')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /current inventory/i }));
    expect(screen.getByText('0.25 available')).toBeTruthy();
    expect(screen.getByText('0.3 total')).toBeTruthy();
    expect(screen.getByText('2 active hedges')).toBeTruthy();
    expect(screen.getByText('0.1 BTC')).toBeTruthy();
    expect(screen.getByText('0.05 BTC')).toBeTruthy();
    expect(screen.getAllByText('0.0125 BTC')).not.toHaveLength(0);
    expect(screen.getByText('0.01 BTC')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /current channel balance/i }));
    expect(screen.getByText('Own liquidity')).toBeTruthy();
    expect(screen.getByText('600,000 sats')).toBeTruthy();
    expect(screen.getByText('400,000 sats')).toBeTruthy();
  });

  it('shows DEX pending liquidity errors as unavailable and keeps the zero target', async () => {
    vi.mocked(fetchDexPendingLiquidity).mockRejectedValueOnce(new Error('pending liquidity unavailable'));
    renderWorkspace();

    expect(await screen.findByText('Unavailable')).toBeTruthy();
    expect(screen.getAllByText('0 BTC')).toHaveLength(1);
  });

  it('builds the fill route from a connected CEX BTC wallet to the LND wallet', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole('button', { name: 'Manage wallet pool' }));
    await screen.findByRole('option', { name: 'Kraken' });
    expect(await screen.findByText('Kraken BTC wallet')).toBeTruthy();
    expect(screen.getByText('LND on-chain wallet')).toBeTruthy();
    await user.type(screen.getByPlaceholderText('0.00000000'), '0.025');
    await user.click(screen.getByRole('button', { name: 'Create transfer request' }));

    expect(screen.getByRole('status').textContent).toContain('wallet-transfer API is not connected');
  });

  it('shows only the LND address and QR code for a manual deposit', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole('button', { name: 'Manage wallet pool' }));
    await user.click(screen.getByRole('button', { name: /fill lnd pool/i }));
    await user.click(screen.getByRole('button', { name: 'Manual address' }));

    expect(screen.getByRole('button', { name: 'Connected exchange' })).toBeTruthy();
    expect(await screen.findByText(/LND deposit address/)).toBeTruthy();
    expect(screen.getByText('Send Bitcoin to this address')).toBeTruthy();
    expect(screen.getByText('bc1qlndwalletdestination000000000000000000')).toBeTruthy();
    expect(screen.queryByText('Source BTC address')).toBeNull();
    expect(screen.queryByText('Amount to move')).toBeNull();
    expect(screen.queryByPlaceholderText('0.00000000')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create transfer request' })).toBeNull();
    expect(await screen.findByRole('img', { name: 'QR code for the LND Bitcoin deposit address' })).toBeTruthy();
  });

  it('reverses the wallet route and loads the CEX BTC deposit address when draining', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole('button', { name: 'Manage wallet pool' }));
    await screen.findByRole('option', { name: 'Kraken' });
    await user.click(screen.getByRole('button', { name: /drain lnd pool/i }));

    await screen.findByRole('option', { name: /CEX BTC deposit address.*Bitcoin.*bc1qkraken/ });
    expect(screen.getByText('LND on-chain wallet')).toBeTruthy();
    expect(screen.getByText('Kraken BTC wallet')).toBeTruthy();
  });

  it('allows a manual BTC address as the drain destination', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole('button', { name: 'Manage wallet pool' }));
    await user.click(screen.getByRole('button', { name: /drain lnd pool/i }));
    await user.click(screen.getByRole('button', { name: 'Manual address' }));
    await user.type(screen.getByPlaceholderText('Paste a Bitcoin address'), 'bc1qexternaldestination0000000000000000');
    await user.type(screen.getByPlaceholderText('0.00000000'), '0.01');

    expect(screen.getByText('External BTC address')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create transfer request' }));
    expect(screen.getByRole('status').textContent).toContain('wallet-transfer API is not connected');
  });

  it('exposes channel opening validation and the live channel list', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole('button', { name: 'Manage channels' }));
    expect(screen.getByText('Hub')).toBeTruthy();
    await user.click(screen.getByText('Open a new channel'));
    await user.click(screen.getByRole('button', { name: 'Open channel' }));

    expect(screen.getByRole('alert').textContent).toContain('Enter a node pubkey');
  });

  it('shows and saves the LSP channel controls in liquidity management', async () => {
    vi.mocked(fetchLSPChannelStatus).mockResolvedValueOnce({
      channel_point: 'txid:0', remote_pubkey: '03remote', provider_label: 'Hub', enabled: true,
      configured: true, lsp_healthy: true, headroom_sat: 10000, max_swap_fee_sat: 5000, max_swap_fee_ppm: 10000,
      lsp_inbound_sat: 400000, lsp_outbound_sat: 600000, usable_inbound_sat: 390000, usable_outbound_sat: 590000,
    });
    const user = userEvent.setup();
    renderWorkspace();

    expect(await screen.findByText('LSP channel active')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Manage channels' }));
    expect(screen.getByRole('heading', { name: 'Long-lived LSP channel' })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('LND channel'), 'txid:0');
    await user.clear(screen.getByLabelText('Headroom (sats)'));
    await user.type(screen.getByLabelText('Headroom (sats)'), '10000');
    await user.click(screen.getByRole('button', { name: 'Save LSP selection' }));

    expect(updateLSPChannel).toHaveBeenCalledWith(expect.objectContaining({
      channel_point: 'txid:0', remote_pubkey: '03remote', provider_label: 'Hub', enabled: true, headroom_sat: 10000,
    }));
    expect(await screen.findByText('LSP channel monitoring configuration saved.')).toBeTruthy();
  });
});
