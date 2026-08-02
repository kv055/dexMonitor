import { test, expect, gotoAndWaitForData, waitForChartReady, ohlcPanel, controlPanel, openControlPanel } from '../fixtures/base-fixture';
import {
  MOCK_OHLC_DATA_1D_WINDOW,
  MOCK_OHLC_DATA_4H_WINDOW,
} from '../fixtures/mock-data';
import type { Page } from '@playwright/test';

test.describe('OHLCChart', () => {
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
    await waitForChartReady(panel, page);

    // lightweight-charts creates multiple canvas elements
    const canvas = panel.locator('canvas').first();
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(50);
    expect(box!.height).toBeGreaterThan(50);
  });

  test('shows the BTC/EUR reference price in the Insights sidebar', async ({ page }) => {
    await gotoAndWaitForData(page);
    await openControlPanel(page);

    // The CEX reference price moved from the (removed) Monitor chart header to
    // the Insights filter sidebar.
    await expect(controlPanel(page).getByText(/BTC\/EUR — Kraken/)).toBeVisible();
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

  test('visual regression: chart updates on candle-size change', async ({ page }) => {
    await gotoAndWaitForData(page);

    const panel = ohlcPanel(page);
    await panel.getByRole('button', { name: '15m' }).click();
    await waitForChartReady(panel, page);
    await page.waitForTimeout(500);

    await expect(panel).toHaveScreenshot('ohlc-chart-15m.png', {
      maxDiffPixelRatio: 0.12,
    });
  });
});
