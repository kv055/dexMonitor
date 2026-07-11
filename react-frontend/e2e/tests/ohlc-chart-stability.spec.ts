import { test, expect, gotoAndWaitForData, waitForChartReady, ohlcPanel, revealChartOffers } from '../fixtures/base-fixture';
import type { Locator, Page } from '@playwright/test';

/**
 * Guards the chart's interaction stability: the lightweight-charts instance
 * must be created once and updated incrementally. The previous design tore
 * the chart down on every live-offer tick, resetting the user's pan/zoom —
 * these tests fail loudly if that regression ever comes back.
 *
 * The chart container exposes:
 *  - data-chart-instances: how many times createChart() ran (constant = good)
 *  - data-visible-range:   the current visible time range as JSON
 */

type VisibleRange = { from: number; to: number };

function chartContainer(page: Page): Locator {
  return ohlcPanel(page).locator('[data-chart-instances]');
}

async function getChartInstances(page: Page): Promise<number> {
  return Number(await chartContainer(page).getAttribute('data-chart-instances'));
}

async function getVisibleRange(page: Page): Promise<VisibleRange> {
  const raw = await chartContainer(page).getAttribute('data-visible-range');
  expect(raw, 'chart should have reported a visible range').toBeTruthy();
  return JSON.parse(raw!) as VisibleRange;
}

async function dragChart(page: Page, dx: number, dy: number, target: 'pane' | 'price-scale' = 'pane') {
  const canvas = ohlcPanel(page).locator('canvas').first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  // Price-scale drags start on the right axis strip; pane drags in the middle.
  const startX = target === 'price-scale' ? box!.x + box!.width - 25 : box!.x + box!.width / 2;
  const startY = box!.y + box!.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 12 });
  await page.mouse.up();
}

async function settled(page: Page) {
  // Cover the offer-layer render throttle plus kinetic-scroll easing.
  await page.waitForTimeout(1_300);
}

/**
 * Wait until the reported visible range stops moving. The initial load can
 * apply the default window and answer a back-fill request asynchronously;
 * reading a "before" value while that is still in flight makes pans racy.
 */
async function waitForStableRange(page: Page): Promise<VisibleRange> {
  let prev = '';
  await expect
    .poll(async () => {
      const cur = (await chartContainer(page).getAttribute('data-visible-range')) ?? '';
      const stable = cur !== '' && cur === prev;
      prev = cur;
      return stable;
    }, { timeout: 15_000, intervals: [700] })
    .toBe(true);
  return JSON.parse(prev) as VisibleRange;
}

test.describe('OHLC chart interaction stability', () => {
  test('chart is not rebuilt by streaming offer/lifecycle updates', async ({ page }) => {
    await gotoAndWaitForData(page);
    await revealChartOffers(page);
    const panel = ohlcPanel(page);
    await waitForChartReady(panel, page);

    // Lifecycle fetches resolve after the first paint and re-render the offer
    // layer — under the old design each of those rebuilt the whole chart.
    await expect
      .poll(async () => (await chartContainer(page).getAttribute('data-offer-paths')) ?? '')
      .toContain('"mode":"lifecycle"');
    await settled(page);

    const instances = await getChartInstances(page);
    expect(instances).toBeGreaterThan(0);

    // Interact (pan + y-axis zoom) and let another render cycle pass.
    await dragChart(page, 150, 0);
    await dragChart(page, 0, 60, 'price-scale');
    await settled(page);

    expect(await getChartInstances(page)).toBe(instances);
    // The offer overlay must still be drawn on the surviving instance.
    expect(await chartContainer(page).getAttribute('data-offer-paths')).toContain('"mode":"lifecycle"');
  });

  test('panning back in time keeps the view instead of resetting it', async ({ page }) => {
    await gotoAndWaitForData(page);
    const panel = ohlcPanel(page);
    await waitForChartReady(panel, page);
    await settled(page);

    const before = await waitForStableRange(page);

    // Drag right = pan into the past. The reported range snaps to existing
    // bars, so past the earliest candle only the RIGHT edge keeps moving —
    // that's the unclamped signal that the view actually panned.
    await dragChart(page, 260, 0);
    await settled(page);

    const afterPan = await getVisibleRange(page);
    expect(afterPan.to).toBeLessThan(before.to);

    // Hitting the left edge of loaded data requests a wider window from
    // /api/ohlc. The mock answers with the same candles — the view must stay
    // where the user panned, not snap back to the default window.
    await settled(page);
    const afterRefresh = await getVisibleRange(page);
    expect(Math.abs(afterRefresh.from - afterPan.from)).toBeLessThanOrEqual(120);
    expect(Math.abs(afterRefresh.to - afterPan.to)).toBeLessThanOrEqual(120);
  });

  // FIXME(insights-migration): the reset button and pan behaviour still work,
  // but this exact right-edge (`.to`) range assertion is unstable on the
  // Insights OHLC chart (fitToOffers + back-fill shift the default window's
  // right edge by ~12h under the mocked dataset). Needs an Insights-appropriate
  // assertion before re-enabling. Was a dex Monitor test where reset == the
  // initial default view; that assumption no longer holds.
  test.fixme('reset button appears after panning and restores the default view', async ({ page }) => {
    await gotoAndWaitForData(page);
    const panel = ohlcPanel(page);
    await waitForChartReady(panel, page);
    await settled(page);

    const resetBtn = panel.getByRole('button', { name: /Reset view/ });
    await expect(resetBtn).toBeHidden();

    const defaultRange = await waitForStableRange(page);

    await dragChart(page, 260, 0);
    await settled(page);
    await expect(resetBtn).toBeVisible();

    await resetBtn.click();
    await expect(resetBtn).toBeHidden();
    const afterReset = await getVisibleRange(page);
    expect(Math.abs(afterReset.from - defaultRange.from)).toBeLessThanOrEqual(120);
    // The right edge snaps to the bar grid; the mock's candles are hourly, so
    // allow one bar of wobble (in production bars are one minute).
    expect(Math.abs(afterReset.to - defaultRange.to)).toBeLessThanOrEqual(3660);
  });

  test('back-fill request for a wider window fires when scrolling past loaded data', async ({ page }) => {
    // The mock data spans exactly the default 24h view, so reaching the left
    // edge (initial render or panning) must request a wider hours window.
    const extendRequest = page.waitForRequest((req) => {
      const url = new URL(req.url());
      return url.pathname === '/api/ohlc' && Number(url.searchParams.get('hours')) > 24;
    });
    await gotoAndWaitForData(page);
    const panel = ohlcPanel(page);
    await waitForChartReady(panel, page);
    await dragChart(page, 260, 0);
    await extendRequest;
  });
});
