import { test, expect, gotoAndWaitForData, waitForChartReady, ohlcPanel, controlPanel, jsClick } from '../fixtures/base-fixture';
import {
  MOCK_OHLC_DATA_1D_WINDOW,
  MOCK_OHLC_DATA_1H,
  MOCK_OHLC_DATA_4H_WINDOW,
  MOCK_STALE_PAST_OFFER_LIFECYCLE,
} from '../fixtures/mock-data';
import type { Page } from '@playwright/test';

test.describe('OHLCChart', () => {
  async function showClosedOrders(page: Page) {
    const cp = controlPanel(page);
    await jsClick(cp.locator('button').filter({ hasText: 'Open' }));
    await jsClick(page.locator('button').filter({ hasText: 'Closed' }));
  }

  function waitForOhlcRequest(page: Page, minHours: number, intervalMin: number) {
    return page.waitForRequest(req => {
      const url = new URL(req.url());
      return url.pathname === '/api/ohlc' &&
        Number(url.searchParams.get('hours')) >= minHours &&
        Number(url.searchParams.get('interval_min')) === intervalMin;
    });
  }

  test('renders chart canvas', async ({ page }) => {
    await gotoAndWaitForData(page);

    const panel = ohlcPanel(page);
    await expect(panel.locator('text=DEX Premium Offer Overlay')).toBeVisible();
    await waitForChartReady(panel, page);

    // lightweight-charts creates multiple canvas elements
    const canvas = panel.locator('canvas').first();
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(50);
    expect(box!.height).toBeGreaterThan(50);
  });

  test('shows BTC/EUR label', async ({ page }) => {
    await gotoAndWaitForData(page);

    const panel = ohlcPanel(page);
    await expect(panel.getByText('BTC/EUR — Kraken', { exact: true })).toBeVisible();
  });

  test('requests and renders past offer lifecycle overlays', async ({ page }) => {
    await gotoAndWaitForData(page);

    const lifecycleRequest = page.waitForRequest(req =>
      /\/api\/past_offers\/\d+\/lifecycle$/.test(new URL(req.url()).pathname),
    );
    await showClosedOrders(page);
    await lifecycleRequest;

    const panel = ohlcPanel(page);
    await waitForChartReady(panel, page);
    await page.waitForTimeout(500);

    await expect(panel).toHaveScreenshot('ohlc-chart-lifecycle-overlay.png', {
      maxDiffPixelRatio: 0.12,
    });
  });

  test('shows fallback marker when lifecycle points are stale', async ({ page }) => {
    await page.route('**/api/past_offers/*/lifecycle', route =>
      route.fulfill({ json: MOCK_STALE_PAST_OFFER_LIFECYCLE }),
    );

    await gotoAndWaitForData(page);
    await showClosedOrders(page);

    const panel = ohlcPanel(page);
    await waitForChartReady(panel, page);
    await page.waitForTimeout(500);

    await expect(panel).toHaveScreenshot('ohlc-chart-stale-lifecycle-fallback.png', {
      maxDiffPixelRatio: 0.12,
    });
  });

  test('expands loaded OHLC window when switching to 4h candles', async ({ page }) => {
    await gotoAndWaitForData(page);
    await page.route('**/api/ohlc*hours=*', route =>
      route.fulfill({ json: MOCK_OHLC_DATA_4H_WINDOW }),
    );

    const ohlcRequest = waitForOhlcRequest(page, 480, 240);
    const panel = ohlcPanel(page);
    await panel.getByRole('button', { name: '4h' }).click();
    await ohlcRequest;
    await waitForChartReady(panel, page);
  });

  test('expands loaded OHLC window when switching to 1d candles', async ({ page }) => {
    await gotoAndWaitForData(page);
    await page.route('**/api/ohlc*hours=*', route =>
      route.fulfill({ json: MOCK_OHLC_DATA_1D_WINDOW }),
    );

    const ohlcRequest = waitForOhlcRequest(page, 2880, 1440);
    const panel = ohlcPanel(page);
    await panel.getByRole('button', { name: '1d' }).click();
    await ohlcRequest;
    await waitForChartReady(panel, page);
  });

  test('visual regression: OHLC chart renders correctly', async ({ page }) => {
    await gotoAndWaitForData(page);

    const panel = ohlcPanel(page);
    await waitForChartReady(panel, page);
    // Extra settling for lightweight-charts internal animations
    await page.waitForTimeout(500);

    await expect(panel).toHaveScreenshot('ohlc-chart-default.png', {
      maxDiffPixelRatio: 0.12,
    });
  });

  test('visual regression: chart updates on timeframe change', async ({ page }) => {
    await gotoAndWaitForData(page);

    // Override OHLC mock for hours=6
    await page.route('**/api/ohlc*hours=6*', route =>
      route.fulfill({ json: MOCK_OHLC_DATA_1H }),
    );

    // Change timeframe to 6h
    const cp = controlPanel(page);
    await cp.locator('button').filter({ hasText: 'Last 24h' }).click();
    await page.locator('button').filter({ hasText: 'Last 6h' }).click();

    const panel = ohlcPanel(page);
    await waitForChartReady(panel, page);
    await page.waitForTimeout(500);

    await expect(panel).toHaveScreenshot('ohlc-chart-6h.png', {
      maxDiffPixelRatio: 0.12,
    });
  });
});
