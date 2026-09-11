import { test, expect, gotoAndWaitForData, depthPanel } from '../fixtures/base-fixture';
import { MOCK_LIVE_OFFERS } from '../fixtures/mock-data';
import type { LiveOfferAnalysis } from '../../src/types';

test.describe('Taker opportunities', () => {
  test('collapses the Insights filters into a side rail and restores them', async ({ page }) => {
    await gotoAndWaitForData(page);
    await page.getByRole('button', { name: 'dex Monitor' }).click();

    const filters = page.getByRole('complementary', { name: 'Insights filters' });
    await expect(filters).toBeVisible();
    await expect(filters.getByText('Direction', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Hide Insights filters' }).click();
    await expect(filters).toHaveCount(0);

    const showFilters = page.getByRole('button', { name: 'Show Insights filters' });
    await expect(showFilters).toBeVisible();
    await expect(showFilters).toHaveAttribute('aria-expanded', 'false');

    await showFilters.click();
    await expect(filters).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide Insights filters' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('collapses the orderbook depth chart into a right side rail and restores it', async ({ page }) => {
    await gotoAndWaitForData(page);
    await page.getByRole('button', { name: 'dex Monitor' }).click();

    const depthCanvas = depthPanel(page).locator('canvas');
    await expect(depthCanvas).toBeVisible();

    await page.getByRole('button', { name: 'Hide orderbook depth chart' }).click();
    await expect(depthCanvas).toHaveCount(0);

    const showDepth = page.getByRole('button', { name: 'Show orderbook depth chart' });
    await expect(showDepth).toBeVisible();
    await expect(showDepth).toHaveAttribute('aria-expanded', 'false');

    await showDepth.click();
    await expect(depthCanvas).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide orderbook depth chart' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('selecting a live offer swaps the depth chart for the Trade Tracing panel', async ({ page }) => {
    await gotoAndWaitForData(page);
    await page.getByRole('button', { name: 'dex Monitor' }).click();

    const depthCanvas = depthPanel(page).locator('canvas');
    const tracingHeading = page.locator('h3').filter({ hasText: 'Trade Tracing' });
    await expect(depthCanvas).toBeVisible();

    // Select a live offer row in the Live Offers table.
    const firstRow = page.getByTestId('live-offers-row').first();
    await firstRow.click();
    await expect(tracingHeading).toBeVisible();
    await expect(depthCanvas).toHaveCount(0);

    // Closing the full-panel detail restores the depth chart.
    await page.getByRole('button', { name: 'Close live offer details' }).click();
    await expect(tracingHeading).toHaveCount(0);
    await expect(depthCanvas).toBeVisible();
  });

  test('trade tracing fills the space freed by a collapsed OHLC chart', async ({ page }) => {
    await gotoAndWaitForData(page);
    await page.getByRole('button', { name: 'dex Monitor' }).click();

    await page.getByRole('button', { name: 'Hide premium chart' }).click();
    await expect(page.getByRole('button', { name: 'Show premium chart' })).toBeVisible();

    await page.getByTestId('live-offers-row').first().click();
    const tracingPanel = page.getByRole('region', { name: 'Trade tracing' });
    await expect(tracingPanel).toBeVisible();
    await expect.poll(async () => (await tracingPanel.boundingBox())?.width ?? 0).toBeGreaterThan(600);
  });

  test('switches to hedgeless mode when the variant uses the legacy payload shape', async ({ page }) => {
    const legacyOffer = structuredClone(MOCK_LIVE_OFFERS[0]) as typeof MOCK_LIVE_OFFERS[number] & {
      analysis?: LiveOfferAnalysis;
    };
    const bd = legacyOffer.cost_breakdown;
    const costs = {
      cex_taker: { pct: bd.cex_taker_fee_pct, btc: bd.cex_taker_fee_btc },
      withdrawal: { pct: bd.withdrawal_fee_pct, btc: bd.withdrawal_fee_btc },
      dex_fee: { pct: bd.dex_fee_pct, btc: bd.dex_fee_btc },
      network: { pct: bd.network_fee_pct, btc: bd.network_fee_btc },
      conversion: bd.conversion,
      hedge: bd.hedge,
      total: { pct: bd.total_cost_pct, btc: bd.total_cost_btc },
    };
    legacyOffer.analysis = {
      full_volume: {
        trade_size_btc: bd.btc_amount,
        trade_size_fiat: bd.btc_amount * legacyOffer.ref_price,
        route: { cex: bd.route_cex, settlement: bd.route_method },
        premium: {
          trade_cost_percent: bd.total_cost_pct,
          net_percent: bd.estimated_profit_pct,
        },
        profit: {
          btc: bd.estimated_profit_btc,
          fiat: bd.estimated_profit_btc * legacyOffer.ref_price,
        },
        costs,
        capital: bd.capital,
        hedgeless_double_collateral: {
          // This is the payload shape emitted before route/network metadata
          // was added to hedgeless variants.
          premium: {
            trade_cost_percent: bd.total_cost_pct,
            net_percent: bd.estimated_profit_pct,
          },
          profit: {
            btc: bd.estimated_profit_btc,
            fiat: bd.estimated_profit_btc * legacyOffer.ref_price,
          },
          costs: {
            ...costs,
            hedge: { ...bd.hedge, fee_sum_btc: 0, fee_sum_pct: 0 },
          },
          capital: {
            ...bd.capital,
            trade_mode: 'hedgeless_double_collateral',
            hedge_collateral: 0,
          },
        },
      },
    };

    await page.route('**/api/live_offers*', route => route.fulfill({ json: [legacyOffer] }));
    const pageErrors: Error[] = [];
    page.on('pageerror', error => pageErrors.push(error));

    await gotoAndWaitForData(page);
    await page.getByRole('button', { name: 'dex Monitor' }).click();
    await page.getByRole('button', { name: /Bisq v1 Bid/ }).click();

    const detail = page.getByTestId('live-offer-detail');
    await expect(detail).toBeVisible();
    await detail.getByRole('tab', { name: 'Trade economics' }).click();

    const hedgeless = detail.getByRole('button', { name: 'Hedgeless' });
    await expect(hedgeless).toBeVisible();
    await hedgeless.click();

    await expect(hedgeless).toHaveAttribute('aria-pressed', 'true');
    await expect(detail).toBeVisible();
    expect(pageErrors).toEqual([]);
  });
});
