import { test, expect, gotoAndWaitForData, waitForChartReady, ohlcPanel, controlPanel } from '../fixtures/base-fixture';
import { MOCK_OHLC_DATA_1H } from '../fixtures/mock-data';

test.describe('OHLCChart', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWaitForData(page);
  });

  test('renders chart canvas', async ({ page }) => {
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
    const panel = ohlcPanel(page);
    await expect(panel.getByText('BTC/EUR — Kraken', { exact: true })).toBeVisible();
  });

  test('visual regression: OHLC chart renders correctly', async ({ page }) => {
    const panel = ohlcPanel(page);
    await waitForChartReady(panel, page);
    // Extra settling for lightweight-charts internal animations
    await page.waitForTimeout(500);

    await expect(panel).toHaveScreenshot('ohlc-chart-default.png', {
      maxDiffPixelRatio: 0.12,
    });
  });

  test('visual regression: chart updates on timeframe change', async ({ page }) => {
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
