import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/api', () => ({
  fetchPaymentMethods: vi.fn().mockResolvedValue({ payment_methods: [] }),
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
  fetchMagmaLSPInfo: vi.fn().mockResolvedValue({
    pool: 'recommended',
    public_key: '03local',
    synced_to_chain: true,
    synced_to_graph: true,
    block_height: 963039,
    chain_ready: true,
    confirmed_balance_sat: 1250000,
    unconfirmed_balance_sat: 0,
    outbound_sat: 600000,
    wallet_ready: true,
    info: {
      min_required_channel_confirmations: 6,
      min_funding_confirms_within_blocks: 6,
      max_channel_expiry_blocks: 12960,
      min_initial_lsp_balance_sat: '500000',
      max_initial_lsp_balance_sat: '100000000',
      uris: ['03lsp@lsp.example.com:9735'],
    },
  }),
  createMagmaLSPOrder: vi.fn().mockResolvedValue({
    id: 'local-1',
    pool: 'recommended',
    order_id: 'magma-order-1',
    public_key: '03local',
    lsp_balance_sat: 500000,
    announce_channel: false,
    channel_expiry_blocks: 4320,
    order_state: 'CREATED',
    payment_state: 'EXPECT_PAYMENT',
    bolt11_invoice: 'lnbc500000n1p...',
    order_total_sat: 512500,
    fee_total_sat: 12500,
    funding_outpoint: '',
    remote_pubkey: '',
    payment_hash: '',
    auto_registered: false,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
  }),
  payMagmaLSPOrder: vi.fn().mockResolvedValue({
    id: 'local-1',
    pool: 'recommended',
    order_id: 'magma-order-1',
    public_key: '03local',
    lsp_balance_sat: 500000,
    announce_channel: false,
    channel_expiry_blocks: 4320,
    order_state: 'CREATED',
    payment_state: 'HOLD',
    bolt11_invoice: 'lnbc500000n1p...',
    order_total_sat: 512500,
    fee_total_sat: 12500,
    funding_outpoint: '',
    remote_pubkey: '',
    payment_hash: 'hash',
    auto_registered: false,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
  }),
  fetchMagmaOffers: vi.fn().mockResolvedValue([
    {
      id: 'offer-1',
      side: 'SELL',
      status: 'ENABLED',
      base_fee: 1000,
      fee_rate: 2000,
      base_fee_cap: null,
      fee_rate_cap: null,
      min_size_sat: 300000,
      max_size_sat: 5000000,
      total_size_sat: 5000000,
      min_block_length: 4320,
      seller_score: '42.5',
      seller_pubkey: '03seller00000000000000000000000000000000000000000000000000000000',
    },
  ]),
  fetchMagmaLSPOrder: vi.fn().mockImplementation(async (id: string) => ({
    id,
    pool: 'recommended',
    order_id: 'magma-order-1',
    public_key: '03local',
    lsp_balance_sat: 500000,
    announce_channel: false,
    channel_expiry_blocks: 4320,
    order_state: 'CREATED',
    payment_state: 'EXPECT_PAYMENT',
    bolt11_invoice: 'lnbc500000n1p...',
    order_total_sat: 512500,
    fee_total_sat: 12500,
    funding_outpoint: '',
    remote_pubkey: '',
    payment_hash: '',
    auto_registered: false,
    created_at: '2026-08-18T00:00:00Z',
    updated_at: '2026-08-18T00:00:00Z',
  })),
}));

import { LiquidityWorkspace } from './LiquidityWorkspace';
import { fetchCexBalances, fetchCexHedgePositions, fetchDexPendingLiquidity, fetchLNDWalletStatus, fetchLSPChannelStatus, fetchMagmaLSPInfo, createMagmaLSPOrder, payMagmaLSPOrder, fetchTradingAccounts, fetchTransactionalLiquiditySettings, updateLSPChannel, updateTransactionalLiquiditySettings } from '../utils/api';
import { FiltersProvider } from '../context/FiltersContext';
import { PreferencesProvider } from '../context/PreferencesContext';
import { CEXPermissionsContext, type CEXPermissionsContextValue } from '../hooks/useCEXPermissions';
import type { Offer, TransactionalLiquiditySettings } from '../types';

const ALL_ROUTING_PROFILES = ['Direct_main2main', 'Hub_main2main', 'Swap_main2lightning'] as const;

function liquiditySettings(overrides: Partial<TransactionalLiquiditySettings> = {}): TransactionalLiquiditySettings {
  return {
    fiat_currency: 'EUR',
    amount_source: 'custom',
    amount_fiat: 100,
    fee_tier: 'economic',
    coupled_hedge: false,
    trade_mode: 'hedgefull_single_collateral',
    target_direction: 'bid',
    lightning_liquidity_source: 'own_channels',
    supported_routing_profiles: [...ALL_ROUTING_PROFILES],
    config_version: 1,
    updated_at: '2026-08-10T00:00:00Z',
    ...overrides,
  };
}

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
        <FiltersProvider offers={offers} loading={false} groups={[]} hideZeroTrustScore={false}>
          <LiquidityWorkspace />
        </FiltersProvider>
      </PreferencesProvider>
    </CEXPermissionsContext.Provider>,
  );
}

beforeEach(() => {
  window.localStorage.removeItem('dex-max-fiat-limit');
  window.localStorage.removeItem('dex-hub-balance-unit');
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.removeItem('dex-max-fiat-limit');
  window.localStorage.removeItem('dex-hub-balance-unit');
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
    expect(screen.getAllByText('Liquidity below target')).toHaveLength(3);
    expect(screen.getByText('Liquidity at or above target')).toBeTruthy();
  });

  it('shows full hub addresses with copy and block explorer actions', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderWorkspace();

    await user.click(screen.getByRole('button', { name: 'Expand Mainnet Hub liquidity' }));

    const fullAddress = 'bc1qlndwalletdestination000000000000000000';
    expect(await screen.findByText(fullAddress)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View address on mempool.space' })).toHaveProperty(
      'href',
      `https://mempool.space/address/${encodeURIComponent(fullAddress)}`,
    );

    await user.click(screen.getByRole('button', { name: 'Copy address' }));
    expect(writeText).toHaveBeenCalledWith(fullAddress);
    expect(await screen.findByRole('button', { name: 'Address copied' })).toBeTruthy();
  });

  it('toggles hub balance display between BTC and sats', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    expect(await screen.findByText('0.0125 BTC')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Expand Mainnet Hub liquidity' }));
    expect(screen.getAllByText('0.0125 BTC').length).toBeGreaterThanOrEqual(2);

    await user.click(screen.getByRole('button', { name: 'sats' }));
    expect(screen.getAllByText('1,250,000 sats').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('0.0125 BTC')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'BTC' }));
    expect(screen.getAllByText('0.0125 BTC').length).toBeGreaterThanOrEqual(2);
    expect(window.localStorage.getItem('dex-hub-balance-unit')).toBe('btc');
  });

  it('uses zero BTC targets for LND and Lightning liquidity in hedgefull mode', async () => {
    vi.mocked(fetchTransactionalLiquiditySettings).mockResolvedValueOnce(liquiditySettings());

    renderWorkspace([{ id: 1, exchange: 'Bisq', direction: 'bid', payment_methods: [], offer_id: 'offer-1', is_live: true, ref_price: 50000 }]);

    expect(await screen.findByText('EUR 100')).toBeTruthy();
    expect(screen.getAllByText('0 BTC')).toHaveLength(4);
    expect(screen.queryByText('no LND pool required')).toBeNull();
    expect(screen.getAllByText('0 BTC')).toHaveLength(4);
  });

  it('shows the routing matrix totals and only the enabled profiles', async () => {
    vi.mocked(fetchTransactionalLiquiditySettings).mockResolvedValueOnce(liquiditySettings({
      trade_mode: 'hedgeless_double_collateral',
      supported_routing_profiles: ['Direct_main2main', 'Swap_main2lightning'],
    }));

    renderWorkspace([{ id: 1, exchange: 'Bisq', direction: 'bid', payment_methods: [], offer_id: 'offer-1', is_live: true, ref_price: 50000 }]);

    expect(await screen.findByRole('heading', { name: 'Routing matrix' })).toBeTruthy();
    const requirements = screen.getByLabelText('Routing capital requirements');
    expect(within(requirements).getByText('Total required capital')).toBeTruthy();
    expect(within(requirements).getByText('Total required fiat')).toBeTruthy();
    expect(within(requirements).getByText('Total required bitcoin')).toBeTruthy();
    expect(within(requirements).getByText('300 EUR')).toBeTruthy();
    expect(within(requirements).getByText('100 EUR')).toBeTruthy();
    expect(within(requirements).getByText('0.004 BTC')).toBeTruthy();
    expect(screen.getByText('CEX → DEX wallet')).toBeTruthy();
    expect(screen.getByText('CEX → Lightning → DEX wallet')).toBeTruthy();
    expect(screen.queryByText('CEX → Mainnet Hub → DEX wallet')).toBeNull();
    expect(screen.getByRole('img', { name: 'Direct requirements met' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Swap requirements met' })).toBeTruthy();
  });

  it('marks routing profiles red when their required liquidity is unavailable', async () => {
    vi.mocked(fetchTransactionalLiquiditySettings).mockResolvedValueOnce(liquiditySettings({
      trade_mode: 'hedgeless_double_collateral',
    }));
    vi.mocked(fetchCexBalances).mockResolvedValueOnce({
      bitcoin: { asset: 'BTC', available: 0, total: 0 }, fiat: [{ asset: 'EUR', available: 0, total: 0 }], source: 'Kraken',
    });
    vi.mocked(fetchLNDWalletStatus).mockResolvedValueOnce({ addresses: [], channels: [] } as unknown as Awaited<ReturnType<typeof fetchLNDWalletStatus>>);

    renderWorkspace([{ id: 1, exchange: 'Bisq', direction: 'bid', payment_methods: [], offer_id: 'offer-1', is_live: true, ref_price: 50000 }]);

    for (const profile of ['Direct', 'Hub', 'Swap']) {
      const indicator = await screen.findByRole('img', { name: `${profile} requirements not met` });
      expect(indicator.closest('article')?.classList.contains('is-blocked')).toBe(true);
    }
  });

  it('switches to hedgeless mode and uses the fiat target converted to BTC for LND and Lightning', async () => {
    const hedgelessSettings = liquiditySettings({ trade_mode: 'hedgeless_double_collateral', config_version: 2 });
    vi.mocked(fetchTransactionalLiquiditySettings).mockResolvedValueOnce(liquiditySettings());
    vi.mocked(updateTransactionalLiquiditySettings).mockResolvedValueOnce(hedgelessSettings);

    const user = userEvent.setup();
    renderWorkspace([{ id: 1, exchange: 'Bisq', direction: 'bid', payment_methods: [], offer_id: 'offer-1', is_live: true, ref_price: 50000 }]);

    await screen.findByText('EUR 100');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.selectOptions(screen.getByLabelText('Trade mode'), 'hedgeless_double_collateral');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findAllByText('0.002 BTC')).toHaveLength(2);
    expect(screen.queryByText('fiat target in BTC')).toBeNull();
  });

  it('persists the selected target direction', async () => {
    const settings = liquiditySettings();
    vi.mocked(fetchTransactionalLiquiditySettings).mockResolvedValueOnce(settings);
    vi.mocked(updateTransactionalLiquiditySettings).mockResolvedValueOnce({ ...settings, target_direction: 'ask', config_version: 2 });

    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('EUR 100');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await screen.findByDisplayValue('Custom');
    await user.selectOptions(screen.getByLabelText('Target direction'), 'ask');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateTransactionalLiquiditySettings).toHaveBeenCalledWith(expect.objectContaining({ target_direction: 'ask' }));
  });

  it('uses the Settings-overlay cap as the persisted capped-volume amount', async () => {
    window.localStorage.setItem('dex-max-fiat-limit', '500');
    const settings = liquiditySettings();
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

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(updateTransactionalLiquiditySettings).toHaveBeenCalledWith(expect.objectContaining({ amount_source: 'capped_volume', amount_fiat: 500 }));
  });

  it('requires a positive Settings-overlay cap before saving capped volume', async () => {
    const settings = liquiditySettings();
    vi.mocked(fetchTransactionalLiquiditySettings).mockResolvedValueOnce(settings);

    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('EUR 100');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    await user.selectOptions(screen.getByLabelText('Amount source'), 'capped_volume');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Set a positive Max Position Size (Fiat) in Settings before saving capped volume.')).toBeTruthy();
    expect(updateTransactionalLiquiditySettings).not.toHaveBeenCalled();
  });

  it('requires and persists the selected Lightning liquidity source', async () => {
    const settings = liquiditySettings();
    vi.mocked(fetchTransactionalLiquiditySettings).mockResolvedValueOnce(settings);
    vi.mocked(updateTransactionalLiquiditySettings).mockResolvedValueOnce({ ...settings, lightning_liquidity_source: 'lsp_channel' });

    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('EUR 100');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const source = screen.getByLabelText('Lightning liquidity source');
    expect(source.getAttribute('required')).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Own Collateral' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'LSP Collateral' })).toBeTruthy();
    await user.selectOptions(source, 'lsp_channel');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateTransactionalLiquiditySettings).toHaveBeenCalledWith(expect.objectContaining({ lightning_liquidity_source: 'lsp_channel' }));
    expect(await screen.findByText('LSP Collateral')).toBeTruthy();
  });

  it('persists the selected routing profiles and hides Lightning when Swap is off', async () => {
    const settings = liquiditySettings();
    const withoutSwap = liquiditySettings({
      supported_routing_profiles: ['Direct_main2main', 'Hub_main2main'],
      config_version: 2,
    });
    vi.mocked(fetchTransactionalLiquiditySettings).mockResolvedValueOnce(settings);
    vi.mocked(updateTransactionalLiquiditySettings).mockResolvedValueOnce(withoutSwap);

    const user = userEvent.setup();
    renderWorkspace();

    await screen.findByText('EUR 100');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText('Lightning liquidity source')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Swap routing' }));
    expect(screen.queryByLabelText('Lightning liquidity source')).toBeNull();
    expect(screen.getByRole('button', { name: 'Direct routing' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Hub routing' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Swap routing' }).getAttribute('aria-pressed')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Direct routing' }));
    expect(screen.getByRole('button', { name: 'Direct routing' }).getAttribute('aria-pressed')).toBe('false');
    await user.click(screen.getByRole('button', { name: 'Hub routing' }));
    expect(screen.getByRole('button', { name: 'Hub routing' }).getAttribute('aria-pressed')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Direct routing' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(updateTransactionalLiquiditySettings).toHaveBeenCalledWith(expect.objectContaining({
      supported_routing_profiles: ['Direct_main2main', 'Hub_main2main'],
      lightning_liquidity_source: 'own_channels',
    }));
    expect(await screen.findByText('Direct · Hub')).toBeTruthy();
    expect(screen.queryByText('Own Collateral')).toBeNull();
    expect(screen.queryByText('LSP Collateral')).toBeNull();
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

  it('shows one CEX inventory panel at a time from the exchange dropdown', async () => {
    vi.mocked(fetchTradingAccounts).mockResolvedValueOnce([
      { id: 7, provider: 'Kraken', category: 'CEX', is_active: true, is_healthy: true, api_keys: [{ is_active: true }] },
      { id: 8, provider: 'Bitfinex', category: 'CEX', is_active: true, is_healthy: true, api_keys: [{ is_active: true }] },
    ] as never);
    vi.mocked(fetchCexBalances).mockImplementation(async (accountId: number) => (
      accountId === 8
        ? { bitcoin: { asset: 'BTC', available: 1.5, total: 1.6 }, fiat: [{ asset: 'EUR', available: 200, total: 200 }], source: 'Bitfinex' }
        : { bitcoin: { asset: 'BTC', available: 0.25, total: 0.3 }, fiat: [{ asset: 'EUR', available: 1000, total: 1000 }], source: 'Kraken' }
    ));
    vi.mocked(fetchCexHedgePositions).mockImplementation(async (accountId: number) => (
      accountId === 8
        ? { active: [{ size_btc: -0.4 }], past: [] } as never
        : { active: [{ size_btc: -0.1 }, { size_btc: 0.05 }], past: [] } as never
    ));

    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await screen.findByRole('button', { name: /current inventory/i }));

    const picker = await screen.findByLabelText('CEX inventory exchange');
    expect((picker as HTMLSelectElement).value).toBe('7');
    expect(screen.getByRole('option', { name: 'Kraken' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Bitfinex' })).toBeTruthy();
    expect(screen.getByText('0.25 available')).toBeTruthy();
    expect(screen.getByText('2 active hedges')).toBeTruthy();
    expect(screen.queryByText('1.5 available')).toBeNull();

    await user.selectOptions(picker, '8');
    expect(screen.getByText('1.5 available')).toBeTruthy();
    expect(screen.getByText('1 active hedge')).toBeTruthy();
    expect(screen.queryByText('0.25 available')).toBeNull();
    expect(screen.getAllByLabelText('CEX inventory exchange')).toHaveLength(1);
  });

  it('shows coming-soon placeholders for CEX positions, trades, and withdrawals', async () => {
    const user = userEvent.setup();
    renderWorkspace();
    await user.click(await screen.findByRole('button', { name: /current inventory/i }));

    expect(await screen.findByRole('tab', { name: 'Balances' })).toBeTruthy();
    expect(screen.getByText('0.25 available')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Open positions' }));
    expect(screen.getByText('Coming soon')).toBeTruthy();
    expect(screen.getByText('Open spot and futures positions for this exchange will appear here.')).toBeTruthy();
    expect(screen.queryByText('0.25 available')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Trade history' }));
    expect(screen.getByText('Spot and futures fills for this exchange will appear here.')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Withdraw history' }));
    expect(screen.getByText('Withdrawal history for this exchange will appear here.')).toBeTruthy();

    await user.click(screen.getByRole('tab', { name: 'Balances' }));
    expect(screen.getByText('0.25 available')).toBeTruthy();
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

    await user.click(screen.getByRole('button', { name: 'Expand Mainnet Hub liquidity' }));
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

    await user.click(screen.getByRole('button', { name: 'Expand Mainnet Hub liquidity' }));
    await user.click(screen.getByRole('button', { name: /fill lnd pool/i }));
    await user.click(screen.getByRole('button', { name: 'Manual address' }));

    expect(screen.getByRole('button', { name: 'Connected exchange' })).toBeTruthy();
    expect(await screen.findByText(/LND deposit address/)).toBeTruthy();
    expect(screen.getByText('Send Bitcoin to this address')).toBeTruthy();
    expect(screen.getAllByText('bc1qlndwalletdestination000000000000000000').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Source BTC address')).toBeNull();
    expect(screen.queryByText('Amount to move')).toBeNull();
    expect(screen.queryByPlaceholderText('0.00000000')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create transfer request' })).toBeNull();
    expect(await screen.findByRole('img', { name: 'QR code for the LND Bitcoin deposit address' })).toBeTruthy();
  });

  it('reverses the wallet route and loads the CEX BTC deposit address when draining', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole('button', { name: 'Expand Mainnet Hub liquidity' }));
    await screen.findByRole('option', { name: 'Kraken' });
    await user.click(screen.getByRole('button', { name: /drain lnd pool/i }));

    await screen.findByRole('option', { name: /CEX BTC deposit address.*Bitcoin.*bc1qkraken/ });
    expect(screen.getByText('LND on-chain wallet')).toBeTruthy();
    expect(screen.getByText('Kraken BTC wallet')).toBeTruthy();
  });

  it('allows a manual BTC address as the drain destination', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole('button', { name: 'Expand Mainnet Hub liquidity' }));
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

    await user.click(screen.getByRole('button', { name: /current channel balance/i }));
    expect(within(screen.getByLabelText('Lightning channel workspace')).getByText('Hub')).toBeTruthy();
    expect(screen.getByRole('tab', { name: /own liquidity/i })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Open a channel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Configure' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Open channel' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Registered LSP channel' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: /lsp channel/i }));
    expect(screen.getByRole('heading', { name: 'Registered LSP channel' })).toBeTruthy();
    expect(screen.queryByText('LSP channel is disabled')).toBeNull();
    expect(screen.queryByText('No LSP channel configured')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Open a channel' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: /own liquidity/i }));
    await user.click(screen.getByRole('button', { name: 'Configure' }));
    await user.click(screen.getByRole('button', { name: 'Open channel' }));

    expect(screen.getByRole('alert').textContent).toContain('Enter a node pubkey');
  });

  it('shows and saves the LSP channel controls in the LSP workspace', async () => {
    vi.mocked(fetchLSPChannelStatus).mockResolvedValueOnce({
      channel_point: 'txid:0', remote_pubkey: '03remote', provider_label: 'Hub', enabled: true,
      configured: true, lsp_healthy: true, headroom_sat: 10000, max_swap_fee_sat: 5000, max_swap_fee_ppm: 10000,
      lsp_inbound_sat: 400000, lsp_outbound_sat: 600000, usable_inbound_sat: 390000, usable_outbound_sat: 590000,
    });
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole('button', { name: /current channel balance/i }));
    await user.click(screen.getByRole('tab', { name: /lsp channel/i }));
    expect(await screen.findByText('LSP channel active')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Registered LSP channel' })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText('LND channel'), 'txid:0');
    await user.clear(screen.getByLabelText('Headroom (sats)'));
    await user.type(screen.getByLabelText('Headroom (sats)'), '10000');
    await user.click(screen.getByRole('button', { name: 'Save LSP selection' }));

    expect(updateLSPChannel).toHaveBeenCalledWith(expect.objectContaining({
      channel_point: 'txid:0', remote_pubkey: '03remote', provider_label: 'Hub', enabled: true, headroom_sat: 10000,
    }));
    expect(await screen.findByText('LSP channel monitoring configuration saved.')).toBeTruthy();
  });

  it('loads Magma quote info and creates plus pays an order from the LSP tab', async () => {
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole('button', { name: /current channel balance/i }));
    await user.click(screen.getByRole('tab', { name: /lsp channel/i }));

    expect(await screen.findByText(/Inbound range/)).toBeTruthy();
    expect(fetchMagmaLSPInfo).toHaveBeenCalledWith('recommended');
    expect((screen.getByLabelText('Inbound capacity (sats)') as HTMLInputElement).value).toBe('500000');
    await user.click(screen.getByRole('button', { name: 'Create Magma order' }));
    expect(createMagmaLSPOrder).toHaveBeenCalledWith(expect.objectContaining({
      pool: 'recommended',
      lsp_balance_sat: 500000,
      announce_channel: false,
      channel_expiry_blocks: 4320,
    }));
    expect(await screen.findByText(/Magma order created/)).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: 'Pay from LND' }));
    expect(payMagmaLSPOrder).toHaveBeenCalledWith('local-1');
    expect(await screen.findByText(/Invoice payment submitted from LND/)).toBeTruthy();
  });

  it('does not show an LSP-disabled banner when no channel is registered', async () => {
    vi.mocked(fetchLSPChannelStatus).mockResolvedValueOnce({
      channel_point: '', remote_pubkey: '', provider_label: '', enabled: false,
      configured: false, lsp_healthy: false, reason: 'LSP channel is disabled',
      headroom_sat: 0, max_swap_fee_sat: 0, max_swap_fee_ppm: 0,
      lsp_inbound_sat: 0, lsp_outbound_sat: 0, usable_inbound_sat: 0, usable_outbound_sat: 0,
    });
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole('button', { name: /current channel balance/i }));
    await user.click(screen.getByRole('tab', { name: /lsp channel/i }));

    expect(screen.getByRole('heading', { name: 'Open via Amboss Magma' })).toBeTruthy();
    expect(screen.queryByText('LSP channel is disabled')).toBeNull();
    expect(screen.queryByText('LSP channel active')).toBeNull();
  });

  it('blocks Magma orders when the LND wallet has no spendable Lightning balance', async () => {
    vi.mocked(fetchLNDWalletStatus).mockResolvedValue({
      addresses: [{ address: 'bc1qempty', kind: 'onchain', label: 'Liquidity pool', balance_sat: 0 }],
      channels: [],
    } as unknown as Awaited<ReturnType<typeof fetchLNDWalletStatus>>);
    vi.mocked(fetchMagmaLSPInfo).mockResolvedValue({
      pool: 'recommended',
      public_key: '03local',
      synced_to_chain: true,
      synced_to_graph: true,
      block_height: 963039,
      chain_ready: true,
      confirmed_balance_sat: 0,
      unconfirmed_balance_sat: 0,
      outbound_sat: 0,
      wallet_ready: false,
      info: {
        min_required_channel_confirmations: 6,
        min_funding_confirms_within_blocks: 6,
        max_channel_expiry_blocks: 12960,
        min_initial_lsp_balance_sat: '500000',
        max_initial_lsp_balance_sat: '100000000',
        uris: ['03lsp@lsp.example.com:9735'],
      },
    });
    const user = userEvent.setup();
    renderWorkspace();

    await user.click(screen.getByRole('button', { name: /current channel balance/i }));
    await user.click(screen.getByRole('tab', { name: /lsp channel/i }));

    expect(await screen.findByText(/no spendable Lightning balance/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create Magma order' })).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('button', { name: 'Create Magma order' }));
    expect(createMagmaLSPOrder).not.toHaveBeenCalled();
  });
});
