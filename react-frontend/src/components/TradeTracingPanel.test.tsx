import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/execution', () => ({
  cexPreTradeCheck: vi.fn().mockResolvedValue({ ok: true, checks: [] }),
  cexTradeflow: vi.fn().mockResolvedValue({ trade_mode: 'hedgefull_single_collateral' }),
  acceptBisqExecution: vi.fn(),
  fetchMMTransaction: vi.fn(),
  createExecutionQuote: vi.fn(),
  quoteBisqExecution: vi.fn().mockRejectedValue(new Error('quote unavailable in test')),
}));

import { acceptBisqExecution, cexPreTradeCheck, cexTradeflow, createExecutionQuote, fetchMMTransaction, quoteBisqExecution } from '../api/execution';
import { FiltersProvider } from '../context/FiltersContext';
import type { Offer } from '../types';
import { TradeTracingPanel } from './TradeTracingPanel';

const snapshotRoute = {
  config_version: 1,
  snapshot_revision: 2,
  resolved_at: '2026-08-13T12:00:00Z',
  trade_mode: 'hedgefull_single_collateral' as const,
  target_direction: 'bid' as const,
  market_side: 'bid' as const,
  provider: 'binance',
  hedge_venue: 'binance_futures',
  hedge_side: 'short' as const,
  hedge_notional_btc: 0.01,
  leverage: 2,
  settlement: 'onchain_hub' as const,
  fiat_currency: 'EUR',
  fiat_amount: 500,
  btc_amount: 0.01,
  required_capital: 600,
  required_btc_liquidity: 0,
  security_deposit_btc: 0,
  routing_fee_allowance_sat: 42,
  needs_hub: true,
  needs_lightning: false,
  cex_withdrawal_fee_btc: 0,
  swap_safety_headroom_btc: 0,
  total_cost_btc: 0,
  total_cost_percent: 0,
  net_premium_percent: 1,
  cost_inputs: {
    reference_price: 50000,
    fee_tier: 'economic' as const,
    coupled_hedge: false,
    spot_taker_fee_btc: 0,
    withdrawal_fee_btc: 0,
    hedge_open_fee_btc: 0,
    hedge_close_fee_btc: 0,
    projected_funding_fee_btc: 0,
    funding_cost_available: false,
    dex_fee_btc: 0,
    miner_fee_btc: 0,
    conversion_fee_btc: 0,
  },
};

function quoteFor(amountBtc: number, extras: Record<string, unknown> = {}) {
  return {
    quote_id: `q-${amountBtc}`,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    offer_id: 'offer-1',
    payment_method: 'Revolut',
    fiat_amount: amountBtc * 50000,
    btc_amount: amountBtc,
    max_bond_sat: 0,
    max_escrow_sat: Math.ceil(amountBtc * 1e8),
    bond_fee_sat: 0,
    escrow_fee_sat: 0,
    executable: true,
    resolved_route: { ...snapshotRoute, btc_amount: amountBtc, fiat_amount: amountBtc * 50000, hedge_notional_btc: amountBtc },
    ...extras,
  };
}

function offer(resolvedRoute?: NonNullable<Offer['metadata']>['resolved_route'], extras: Partial<Offer> = {}): Offer {
  return {
    id: 1,
    exchange: 'Bisq',
    direction: 'bid',
    price: 50000,
    ref_price: 50000,
    btc_min: 0.001,
    btc_max: 0.02,
    payment_methods: ['Revolut'],
    offer_id: 'offer-1',
    metadata: resolvedRoute ? { resolved_route: resolvedRoute } : null,
    cost_breakdown: {
      btc_amount: 0.01,
      route_cex: 'binance',
      route_dex: 'Bisq',
      route_method: 'onchain_hub',
      trade_direction: 'bid',
      num_network_txs: 1,
      estimated_profit_pct: 1,
      estimated_profit_btc: 0.0001,
      cex_taker_fee_pct: 0,
      cex_taker_fee_btc: 0,
      withdrawal_fee_pct: 0,
      withdrawal_fee_btc: 0,
      network_fee_pct: 0,
      network_fee_btc: 0,
      network_fee_method: 'onchain_hub',
      network_fee_tier: 'standard',
      network_fee_confidence: 1,
      network_fee_detail: null,
      conversion: { strategy: '', service_fee_pct: 0, service_fee_btc: 0, provider_miner_btc: 0, lockup_fee_btc: 0, routing_fee_pct: 0, routing_fee_btc: 0, channel_open_btc: 0, fee_sum_pct: 0, fee_sum_btc: 0, crossover_amount_btc: 0 },
      hedge: { open_fee_pct: 0, open_fee_btc: 0, close_fee_pct: 0, close_fee_btc: 0, funding_fee_pct: 0, funding_fee_btc: 0, fee_sum_pct: 0, fee_sum_btc: 0, side: 'short', venue: 'binance_futures', instrument: 'BTCUSDT', transfer_minutes: 0, position: { recommended_collateral: 100, leverage_used: 2, hedge_ratio: 1 } },
      dex_fee_pct: 0,
      dex_fee_btc: 0,
      total_cost_pct: 0,
      total_cost_btc: 0,
      capital: { btc_amount: 0.01, btc_price: 50000, spot_notional: 500, hedge_collateral: 100, security_deposit_btc: 0, security_deposit_fiat: 0, total_fiat: 600, trade_mode: 'hedgefull_single_collateral' },
    },
    ...extras,
  } as Offer;
}

function renderPanel(currentOffer: Offer) {
  return render(
    <FiltersProvider offers={[currentOffer]} loading={false} groups={[]} hideZeroTrustScore={false}>
      <TradeTracingPanel offer={currentOffer} />
    </FiltersProvider>,
  );
}

beforeEach(() => {
  const saved = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
    clear: () => saved.clear(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.mocked(quoteBisqExecution).mockRejectedValue(new Error('quote unavailable in test'));
});

describe('TradeTracingPanel execution route snapshot', () => {
  it('keeps an offer without a Unified API route snapshot preview-only', () => {
    renderPanel(offer());

    expect(screen.getByRole('status').textContent).toContain('This offer has no resolved execution route. Refresh or recompute it in the Unified API before trading.');
    expect(screen.getByRole('button', { name: 'Start trade' })).toHaveProperty('disabled', true);
    expect(cexPreTradeCheck).not.toHaveBeenCalled();
  });

  it('uses the quoted settlement and fee allowance for pre-trade checks', async () => {
    vi.mocked(createExecutionQuote).mockResolvedValue(quoteFor(0.01));
    const user = userEvent.setup();
    renderPanel(offer(snapshotRoute));

    await user.click(screen.getByRole('button', { name: 'Start trade' }));

    await waitFor(() => expect(cexPreTradeCheck).toHaveBeenCalledWith(expect.objectContaining({
      resolved_route: expect.objectContaining({
        settlement: 'onchain_hub',
        routing_fee_allowance_sat: 42,
      }),
    })));
  });

  it('quotes the edited BTC amount and submits that quote id', async () => {
    const user = userEvent.setup();
    vi.mocked(quoteBisqExecution).mockResolvedValue({
      quote_id: 'quote-edited',
      expires_at: '2099-01-01T00:00:00Z',
      trade_mode: 'hedgefull_single_collateral',
      payment_account_id: 'acct-9',
      funding_address: 'bc1qdesignated',
      trade_amount_sats: 1_000_000,
      security_deposit_sats: 150_000,
      taker_fee_sats: 8_000,
      mining_fee_sats: 2_000,
      total_to_pay_sats: 1_160_000,
      fiat_amount: 550,
      limits: { max_cex_fiat_spend: 1200, max_wallet_debit_sats: 1_160_000, min_fiat_proceeds: 550 },
      is_btc_wallet_funded: false,
      missing_sats: 1_160_000,
    });
    vi.mocked(acceptBisqExecution).mockResolvedValue({
      accepted: true,
      transaction_id: 42,
      stage: 'accepted',
    });
    vi.mocked(fetchMMTransaction).mockResolvedValue({ id: 42, status: 'CexTradeflowStarted' });

    const current = offer({
      config_version: 1,
      snapshot_revision: 2,
      resolved_at: '2026-08-13T12:00:00Z',
      trade_mode: 'hedgefull_single_collateral',
      target_direction: 'bid',
      market_side: 'bid',
      provider: 'binance',
      hedge_venue: 'binance_futures',
      hedge_side: 'short',
      hedge_notional_btc: 0.02,
      leverage: 2,
      settlement: 'onchain_direct',
      fiat_currency: 'EUR',
      fiat_amount: 1000,
      btc_amount: 0.02,
      required_capital: 1200,
      required_btc_liquidity: 0,
      security_deposit_btc: 0,
      routing_fee_allowance_sat: 0,
      needs_hub: false,
      needs_lightning: false,
      cex_withdrawal_fee_btc: 0,
      swap_safety_headroom_btc: 0,
      total_cost_btc: 0,
      total_cost_percent: 0,
      net_premium_percent: 1,
      cost_inputs: {
        reference_price: 50000,
        fee_tier: 'economic',
        coupled_hedge: false,
        spot_taker_fee_btc: 0,
        withdrawal_fee_btc: 0,
        hedge_open_fee_btc: 0,
        hedge_close_fee_btc: 0,
        projected_funding_fee_btc: 0,
        funding_cost_available: false,
        dex_fee_btc: 0,
        miner_fee_btc: 0,
        conversion_fee_btc: 0,
      },
    });
    current.btc_min = 0.005;
    current.btc_max = 0.02;
    renderPanel(current);

    const amount = screen.getByRole('textbox');
    await user.clear(amount);
    await user.type(amount, '0.01');
    await user.click(screen.getByRole('button', { name: 'Start trade' }));

    await waitFor(() => expect(quoteBisqExecution).toHaveBeenCalledWith(expect.objectContaining({
      offer_id: 'offer-1',
      btc_amount: 0.01,
    })));

    const confirm = await screen.findByRole('button', { name: 'Confirm buy' });
    await waitFor(() => expect(confirm).toHaveProperty('disabled', false));
    await user.click(confirm);

    await waitFor(() => expect(acceptBisqExecution).toHaveBeenCalledWith(expect.objectContaining({
      quote_id: 'quote-edited',
      idempotency_key: expect.any(String),
    })));
    expect(quoteBisqExecution).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Closing this page does not cancel/)).toBeTruthy();
  });

  it('recovers a lost acceptance response with the persisted key after reload', async () => {
    const user = userEvent.setup();
    const pending = { quote_id: 'accepted-quote', idempotency_key: 'same-request' };
    window.localStorage.setItem('bisq-acceptance:offer-1', JSON.stringify(pending));
    vi.mocked(acceptBisqExecution).mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({ accepted: true, transaction_id: 42, stage: 'funding_initiated' });
    vi.mocked(fetchMMTransaction).mockResolvedValue({ id: 42, status: 'CexTradeflowStarted' });
    const first = renderPanel(offer());
    await user.click(screen.getByRole('button', { name: 'Recover saved request' }));
    await screen.findByText('response lost');
    first.unmount();
    renderPanel(offer());
    await user.click(screen.getByRole('button', { name: 'Recover saved request' }));
    await waitFor(() => expect(acceptBisqExecution).toHaveBeenCalledTimes(2));
    expect(acceptBisqExecution).toHaveBeenNthCalledWith(1, pending);
    expect(acceptBisqExecution).toHaveBeenNthCalledWith(2, pending);
    expect(quoteBisqExecution).not.toHaveBeenCalled();
    expect(await screen.findByText(/Closing this page does not cancel/)).toBeTruthy();
  });
});

describe('TradeTracingPanel custom quotes', () => {
  it('submits the reduced quoted amount instead of the snapshot size', async () => {
    vi.mocked(createExecutionQuote).mockImplementation(async payload => quoteFor(Number(payload.amount)));
    const user = userEvent.setup();
    renderPanel(offer(snapshotRoute));

    const amount = screen.getByDisplayValue('0.01');
    await user.clear(amount);
    await user.type(amount, '0.005');
    await waitFor(() => expect(createExecutionQuote).toHaveBeenCalledWith(expect.objectContaining({ amount: '0.005', unit: 'btc' })));

    await user.click(screen.getByRole('button', { name: 'Start trade' }));
    await waitFor(() => expect(screen.getByText('0.005 BTC')).toBeTruthy());
    await waitFor(() => expect(cexPreTradeCheck).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'Confirm buy' }));
    await waitFor(() => expect(cexTradeflow).toHaveBeenCalledWith(expect.objectContaining({
      btc_amount: 0.005,
      fiat_amount: 250,
      resolved_route: expect.objectContaining({ btc_amount: 0.005 }),
      selected_offer: expect.objectContaining({ quote_id: 'q-0.005' }),
    })));
  });

  it('discards a stale quote after the amount changes', async () => {
    let resolveStale: ((value: ReturnType<typeof quoteFor>) => void) | undefined;
    vi.mocked(createExecutionQuote)
      .mockImplementationOnce(() => new Promise(resolve => { resolveStale = resolve; }))
      .mockResolvedValue(quoteFor(0.005));
    const user = userEvent.setup();
    renderPanel(offer(snapshotRoute));

    await waitFor(() => expect(createExecutionQuote).toHaveBeenCalled());
    const amount = screen.getByDisplayValue('0.01');
    await user.clear(amount);
    await user.type(amount, '0.005');
    resolveStale?.(quoteFor(0.01, { quote_id: 'stale' }));

    await waitFor(() => expect(createExecutionQuote).toHaveBeenCalledWith(expect.objectContaining({ amount: '0.005' })));
    await user.click(screen.getByRole('button', { name: 'Start trade' }));
    await waitFor(() => expect(screen.getByText('0.005 BTC')).toBeTruthy());
    expect(screen.queryByText('0.01 BTC')).toBeNull();
  });

  it('disables confirmation when the quote has expired', async () => {
    vi.mocked(createExecutionQuote).mockResolvedValue(quoteFor(0.01, { expires_at: new Date(Date.now() - 1000).toISOString() }));
    const user = userEvent.setup();
    renderPanel(offer(snapshotRoute));
    await user.click(screen.getByRole('button', { name: 'Start trade' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm buy' })).toHaveProperty('disabled', true));
  });

  it('allows confirmation when LSP channel checks pass', async () => {
    vi.mocked(createExecutionQuote).mockResolvedValue(quoteFor(0.01, {
      resolved_route: { ...snapshotRoute, settlement: 'onchain_swap', needs_lightning: true, required_btc_liquidity: 0.01 },
    }));
    vi.mocked(cexPreTradeCheck).mockResolvedValue({
      ok: true,
      checks: [{ name: 'lsp_channel', label: 'LSP channel', passed: true, message: 'ready' }],
    });
    const user = userEvent.setup();
    renderPanel(offer({ ...snapshotRoute, settlement: 'onchain_swap', needs_lightning: true, required_btc_liquidity: 0.01 }));
    await user.click(screen.getByRole('button', { name: 'Start trade' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm buy' })).toHaveProperty('disabled', false));
  });

  it('labels a RoboSats bid as selling BTC', () => {
    renderPanel(offer(snapshotRoute, { exchange: 'robosats', venue_coordinator_id: 'expats' }));
    expect(screen.getByText('Sell BTC on RoboSats')).toBeTruthy();
  });

  it('shows an admitted RoboSats job without claiming a completed buy', async () => {
    vi.mocked(createExecutionQuote).mockResolvedValue(quoteFor(0.01));
    vi.mocked(cexTradeflow).mockResolvedValueOnce({ transaction_id: 42, status_url: '/api/transactions/42' });
    vi.mocked(fetchMMTransaction).mockResolvedValue({ id: 42, status: 'HedgelessTradeStarted' });
    const user = userEvent.setup();
    renderPanel(offer(snapshotRoute, { exchange: 'robosats', venue_coordinator_id: 'lake' }));
    await user.click(screen.getByRole('button', { name: 'Start trade' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sell BTC on RoboSats' })).toHaveProperty('disabled', false));
    await user.click(screen.getByRole('button', { name: 'Sell BTC on RoboSats' }));
    await waitFor(() => expect(fetchMMTransaction).toHaveBeenCalledWith(42));
    expect(screen.getByText(/Admission is not a fill or funding confirmation/)).toBeTruthy();
    expect(cexTradeflow).toHaveBeenCalledTimes(1);
    expect(cexPreTradeCheck).toHaveBeenCalledWith(expect.objectContaining({ quote_id: 'q-0.01' }));
  });

  it('does not restore a stale quote after the input is cleared', async () => {
    let resolve: ((value: ReturnType<typeof quoteFor>) => void) | undefined;
    vi.mocked(createExecutionQuote).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    const user = userEvent.setup();
    renderPanel(offer(snapshotRoute));
    await waitFor(() => expect(createExecutionQuote).toHaveBeenCalled());
    await user.clear(screen.getByDisplayValue('0.01'));
    await act(async () => { resolve?.(quoteFor(0.01)); });
    expect(cexPreTradeCheck).not.toHaveBeenCalled();
    expect(cexTradeflow).not.toHaveBeenCalled();
  });

  it('expires a previously valid confirmation without another user action', async () => {
    vi.mocked(createExecutionQuote).mockImplementation(async () => quoteFor(0.01, { expires_at: new Date(Date.now() + 1500).toISOString() }));
    const user = userEvent.setup();
    renderPanel(offer(snapshotRoute));
    await user.click(screen.getByRole('button', { name: 'Start trade' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm buy' })).toHaveProperty('disabled', false));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm buy' })).toHaveProperty('disabled', true), { timeout: 3500 });
    expect(cexTradeflow).not.toHaveBeenCalled();
  });
});
