import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/execution', () => ({
  cexPreTradeCheck: vi.fn().mockResolvedValue({ ok: true, checks: [] }),
  cexTradeflow: vi.fn(),
  fetchMMTransaction: vi.fn(),
}));

import { cexPreTradeCheck } from '../api/execution';
import { FiltersProvider } from '../context/FiltersContext';
import type { Offer } from '../types';
import { TradeTracingPanel } from './TradeTracingPanel';

function offer(resolvedRoute?: NonNullable<Offer['metadata']>['resolved_route']): Offer {
  return {
    id: 1,
    exchange: 'Bisq',
    direction: 'bid',
    price: 50000,
    ref_price: 50000,
    btc_min: 0.01,
    btc_max: 0.01,
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
  } as Offer;
}

function renderPanel(currentOffer: Offer) {
  return render(
    <FiltersProvider offers={[currentOffer]} loading={false} groups={[]} excludedMethods={[]} hideZeroTrustScore={false}>
      <TradeTracingPanel offer={currentOffer} />
    </FiltersProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TradeTracingPanel execution route snapshot', () => {
  it('keeps an offer without a Unified API route snapshot preview-only', () => {
    renderPanel(offer());

    expect(screen.getByRole('status').textContent).toContain('This offer has no resolved execution route. Refresh or recompute it in the Unified API before trading.');
    expect(screen.getByRole('button', { name: 'Start trade' })).toHaveProperty('disabled', true);
    expect(cexPreTradeCheck).not.toHaveBeenCalled();
  });

  it('uses the snapshot settlement and fee allowance for pre-trade checks', async () => {
    const user = userEvent.setup();
    renderPanel(offer({
      config_version: 1,
      snapshot_revision: 2,
      resolved_at: '2026-08-13T12:00:00Z',
      trade_mode: 'hedgefull_single_collateral',
      target_direction: 'bid',
      market_side: 'bid',
      provider: 'binance',
      hedge_venue: 'binance_futures',
      hedge_side: 'short',
      hedge_notional_btc: 0.01,
      leverage: 2,
      settlement: 'onchain_hub',
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
    }));

    await user.click(screen.getByRole('button', { name: 'Start trade' }));

    await waitFor(() => expect(cexPreTradeCheck).toHaveBeenCalledWith(expect.objectContaining({
      resolved_route: expect.objectContaining({
        settlement: 'onchain_hub',
        routing_fee_allowance_sat: 42,
      }),
    })));
  });
});
