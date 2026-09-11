import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/api', () => ({
  fetchPaymentMethods: vi.fn().mockResolvedValue({ payment_methods: [] }),
}));

import { FiltersProvider } from '../context/FiltersContext';
import type { AbortCostBreakdown, CostBreakdown, Offer } from '../types';
import { CostBreakdownPanel } from './OfferBreakdownPanel';

const breakdown: CostBreakdown = {
  btc_amount: 0.01,
  route_cex: 'kraken',
  route_dex: 'robosats',
  route_method: 'onchain_direct',
  trade_direction: 'bid',
  num_network_txs: 2,
  estimated_profit_pct: 2.37,
  estimated_profit_btc: 0.000237,
  cex_taker_fee_pct: 0.8,
  cex_taker_fee_btc: 0.00008,
  withdrawal_fee_pct: 0.3452,
  withdrawal_fee_btc: 0.00003452,
  network_fee_pct: 0.2248,
  network_fee_btc: 0.00002248,
  network_fee_method: 'onchain_direct',
  network_fee_tier: 'standard',
  network_fee_confidence: 0.9,
  network_fee_detail: null,
  conversion: {
    strategy: '',
    service_fee_pct: 0, service_fee_btc: 0, provider_miner_btc: 0, lockup_fee_btc: 0,
    routing_fee_pct: 0, routing_fee_btc: 0, channel_open_btc: 0, fee_sum_pct: 0, fee_sum_btc: 0,
    crossover_amount_btc: 0,
  },
  hedge: {
    open_fee_pct: 0, open_fee_btc: 0, close_fee_pct: 0, close_fee_btc: 0,
    funding_fee_pct: 0, funding_fee_btc: 0, fee_sum_pct: 0.1, fee_sum_btc: 0.00001,
    side: 'short', venue: 'kraken futures', instrument: 'PI_XBTUSD', transfer_minutes: 0, position: null,
  },
  dex_fee_pct: 0.175,
  dex_fee_btc: 0.0000175,
  total_cost_pct: 1.6451,
  total_cost_btc: 0.00016451,
  capital: {
    btc_amount: 0.01,
    btc_price: 82000,
    spot_notional: 289.57,
    hedge_collateral: 90.06,
    security_deposit_pct: 0.03,
    security_deposit_side: 'seller',
    security_deposit_btc: 0.00013034,
    security_deposit_fiat: 8.69,
    total_fiat: 388.32,
    deposit_estimated: false,
    trade_mode: 'hedgefull_single_collateral',
  },
};

const abortCost: AbortCostBreakdown = {
  btc_amount: 0.01,
  trade_direction: 'bid',
  num_network_txs: 2,
  cex_buy_taker: { pct: 0, btc: 0 },
  cex_sell_taker: { pct: 0, btc: 0 },
  withdrawal: { pct: 0, btc: 0 },
  network: { pct: 0, btc: 0 },
  hedge: breakdown.hedge,
  total: { pct: 2.0703, btc: 0.00008995 },
};

const riskOffer: Offer = {
  id: 94765,
  exchange: 'robosats',
  direction: 'bid',
  payment_methods: ['Amazon IT GiftCard'],
  offer_id: '94765',
  seller_rating_score: 52,
  seller_rating_confidence: 'feedback_new',
  seller_rating_raw: { rating: 0.7, trades_count: 4 },
  seller_rating_signals: { source: 'hodlhodl', online_status: 'online' },
  counterparty_stake_pct: 0.03,
  counterparty_stake_btc: 0.0003,
};

function renderPanel(routeControls?: ReactNode, offer: Offer | null = riskOffer) {
  return render(
    <FiltersProvider offers={[]} loading={false} groups={[]} hideZeroTrustScore={false}>
      <CostBreakdownPanel
        bd={breakdown}
        abortCost={abortCost}
        priceDiffPct={4.02}
        netPremiumPct={2.37}
        refPrice={82000}
        offerPrice={69328}
        overview={<div>Amazon IT GiftCard</div>}
        contextLabel="Live offer"
        contextId={94765}
        routeControls={routeControls}
        offer={offer}
      />
    </FiltersProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe('CostBreakdownPanel tabs', () => {
  it('shows only the Offer panel by default', () => {
    renderPanel();

    expect(screen.getByRole('tab', { name: 'Offer' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tabpanel', { name: 'Offer' })).toBeTruthy();
    expect(screen.getByText('Bid side')).toBeTruthy();
    expect(screen.getByText('Amazon IT GiftCard')).toBeTruthy();
    expect(screen.queryByText('Total costs')).toBeNull();
    expect(screen.queryByText('Spot notional (CEX buy)')).toBeNull();
  });

  it('switches one panel at a time, including optional route controls', async () => {
    const user = userEvent.setup();
    renderPanel(<div>Spot CEX + withdrawal</div>);

    await user.click(screen.getByRole('tab', { name: 'Trade economics' }));
    expect(screen.getByRole('tabpanel', { name: 'Trade economics' })).toBeTruthy();
    expect(screen.getByText('Total costs')).toBeTruthy();
    expect(screen.queryByText('Bid side')).toBeNull();
    expect(screen.queryByText('Spot notional (CEX buy)')).toBeNull();
    expect(screen.queryByText('Spot CEX + withdrawal')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Capital allocation' }));
    expect(screen.getByRole('tabpanel', { name: 'Capital allocation' })).toBeTruthy();
    expect(screen.getByText('Spot notional (CEX buy)')).toBeTruthy();
    expect(screen.queryByText('Total costs')).toBeNull();

    await user.click(screen.getByRole('tab', { name: 'Route analysis' }));
    expect(screen.getByRole('tabpanel', { name: 'Route analysis' })).toBeTruthy();
    expect(screen.getByText('Spot CEX + withdrawal')).toBeTruthy();
    expect(screen.queryByText('Total costs')).toBeNull();
    expect(screen.queryByText('Spot notional (CEX buy)')).toBeNull();
  });

  it('omits the Route tab when there are no route controls', () => {
    renderPanel();
    expect(screen.queryByRole('tab', { name: 'Route analysis' })).toBeNull();
  });

  it('always shows the Risk tab with reputation, stake, deposit, and JSON blobs', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByRole('tab', { name: 'Risk' })).toBeTruthy();
    await user.click(screen.getByRole('tab', { name: 'Risk' }));
    expect(screen.getByRole('tabpanel', { name: 'Risk' })).toBeTruthy();
    expect(screen.getByText('Reputation')).toBeTruthy();
    expect(screen.getByText('52')).toBeTruthy();
    expect(screen.getByText('Maker stake')).toBeTruthy();
    expect(screen.getByText('3% · 0.0003 BTC')).toBeTruthy();
    expect(screen.getByText('Security deposit')).toBeTruthy();
    expect(screen.getByText(/Seller · 3%/)).toBeTruthy();
    expect(screen.getByText('Rating inputs')).toBeTruthy();
    expect(screen.getByText(/"trades_count": 4/)).toBeTruthy();
    expect(screen.getByText('Venue signals')).toBeTruthy();
    expect(screen.getByText(/"online_status": "online"/)).toBeTruthy();
    expect(screen.queryByText('Total costs')).toBeNull();
  });

  it('shows Bisq 2 book reputation in the Risk tab', async () => {
    const user = userEvent.setup();
    renderPanel(undefined, {
      ...riskOffer,
      exchange: 'bisq2',
      seller_rating_score: 82,
      seller_rating_confidence: 'reputation_bonded',
      seller_rating_raw: { total_score: 70969, five_system_score: 4.5, ranking: 11 },
    });

    await user.click(screen.getByRole('tab', { name: 'Risk' }));
    expect(screen.getByText('82')).toBeTruthy();
    expect(screen.getByText('Bisq 2 book')).toBeTruthy();
    expect(screen.getByText('4.5★ · 70,969 total · rank #11')).toBeTruthy();
  });
});
