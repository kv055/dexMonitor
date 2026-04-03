import { test, expect, gotoAndWaitForData, waitForChartReady, depthPanel } from '../fixtures/base-fixture';

test.describe('DepthChart', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWaitForData(page);
  });

  test('renders canvas with heading', async ({ page }) => {
    const panel = depthPanel(page);
    await expect(panel.locator('text=Orderbook Depth')).toBeVisible();

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

  test('shows timestamp in header', async ({ page }) => {
    const panel = depthPanel(page);
    // With frozen time at 2026-04-01T12:00:00Z
    const timestampSpan = panel.locator('.text-accent');
    await expect(timestampSpan).toBeVisible();
    const text = await timestampSpan.textContent();
    expect(text).toMatch(/2026/);
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
});
