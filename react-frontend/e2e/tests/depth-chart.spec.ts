import { test, expect, gotoAndWaitForData, waitForChartReady, depthPanel, ohlcPanel } from '../fixtures/base-fixture';
import { MOCK_LIVE_OFFERS } from '../fixtures/mock-data';

test.describe('DepthChart', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWaitForData(page);
  });

  test('renders canvas without a title row', async ({ page }) => {
    const panel = depthPanel(page);
    await expect(panel.getByRole('heading', { name: 'Orderbook Depth' })).toHaveCount(0);

    const canvas = panel.locator('canvas');
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(50);
    expect(box!.height).toBeGreaterThan(50);
  });

  test('shows volume and mid-price info', async ({ page }) => {
    const panel = depthPanel(page);

    // Volume info: "Bids X.XXX · Asks X.XXX BTC"
    await expect(panel.locator('text=/Bids.*Asks.*BTC/')).toBeVisible();

    // Mid price info
    await expect(panel.locator('text=/Mid.*€/')).toBeVisible();
  });

  test('keeps current depth visible and includes live offers on the newest candles', async ({ page }) => {
    const staleLiveOffers = structuredClone(MOCK_LIVE_OFFERS).map(offer => ({
      ...offer,
      // A live offer's last_seen is only its latest snapshot time. Make the
      // snapshot older than the newest candle to cover the live/open-ended case.
      last_seen: '2026-04-01 10:00:00',
      status: {
        is_live: true,
        first_seen: offer.first_seen,
        last_seen: '2026-04-01 10:00:00',
      },
      // Opportunity filters must not remove liquidity from the market-depth view.
      analysis: offer.analysis ? {
        ...offer.analysis,
        full_volume: {
          ...offer.analysis.full_volume,
          premium: { ...offer.analysis.full_volume.premium, net_percent: -1 },
        },
      } : offer.analysis,
    }));
    await page.route('**/api/live_offers*', route => route.fulfill({ json: staleLiveOffers }));
    await page.reload();
    await gotoAndWaitForData(page);

    const depth = depthPanel(page);
    const summary = depth.locator('text=/Bids.*Asks.*BTC/');
    await expect(summary).toBeVisible();

    const ohlcCanvas = ohlcPanel(page).locator('canvas').first();
    const box = await ohlcCanvas.boundingBox();
    expect(box).not.toBeNull();
    // Hover the newest plotted candle (just left of the right-side price axis).
    await page.mouse.move(box!.x + box!.width - 75, box!.y + box!.height / 2);
    await expect(summary).toBeVisible();

    // Leaving OHLC returns to the current book instead of clearing the chart.
    const depthBox = await depth.boundingBox();
    expect(depthBox).not.toBeNull();
    await page.mouse.move(depthBox!.x + depthBox!.width / 2, depthBox!.y + 10);
    await expect(summary).toBeVisible();
  });

  test('visual regression: depth chart renders correctly', async ({ page }) => {
    const panel = depthPanel(page);
    await waitForChartReady(panel, page);

    await expect(panel).toHaveScreenshot('depth-chart-default.png', {
      maxDiffPixelRatio: 0.02,
    });
  });

  test('mouse wheel zoom changes chart', async ({ page }) => {
    const panel = depthPanel(page);
    await waitForChartReady(panel, page);

    // Take baseline screenshot
    const before = await panel.screenshot();

    // Zoom in via wheel event
    const canvas = panel.locator('canvas');
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, -300);
    }

    await page.waitForTimeout(400);

    // Take after screenshot — should differ due to zoom
    const after = await panel.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });

  test('dragging the volume axis zooms the x axis', async ({ page }) => {
    const panel = depthPanel(page);
    await waitForChartReady(panel, page);

    const canvas = panel.locator('canvas');
    const xAxis = panel.locator('[data-axis-zoom="x"]');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();

    // The full cumulative-volume label area is an explicit drag target.
    await expect(xAxis).toHaveCSS('cursor', 'ew-resize');
    const axisBox = await xAxis.boundingBox();
    expect(axisBox).not.toBeNull();
    const axisX = axisBox!.x + axisBox!.width / 2;
    const axisY = axisBox!.y + axisBox!.height / 2;

    const before = await canvas.screenshot();
    await page.mouse.move(axisX, axisY);
    await page.mouse.down();
    // Pointer capture keeps zooming after the pointer leaves the axis strip.
    await page.mouse.move(axisX - 100, axisY - 80);
    await page.mouse.up();

    await expect(panel.getByRole('button', { name: /Reset view/ })).toBeVisible();
    const after = await canvas.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });
});
