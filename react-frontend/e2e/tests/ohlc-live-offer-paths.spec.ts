import { test, expect, gotoAndWaitForData, waitForChartReady, ohlcPanel, offersPanel, controlPanel, openSettings, closeSettings, jsClick, jsFill } from '../fixtures/base-fixture';
import { MOCK_LIVE_OFFER_LIFECYCLES } from '../fixtures/mock-data';
import type { Page } from '@playwright/test';

/**
 * Live offers must be plotted with their FULL price history from the
 * order_lifecycle table (via /api/live_offers/{id}/lifecycle), not just a
 * stub at their latest price. The chart exposes a per-offer render summary
 * in the container's data-offer-paths attribute precisely so these tests can
 * verify what was drawn — the lightweight-charts canvas itself is opaque.
 */

type OfferPath = {
  id: number;
  live: boolean;
  mode: 'lifecycle' | 'fallback' | 'none';
  points: number;
  segments: number;
};

async function getOfferPaths(page: Page): Promise<OfferPath[]> {
  const attr = await ohlcPanel(page)
    .locator('[data-offer-paths]')
    .getAttribute('data-offer-paths');
  return attr ? (JSON.parse(attr) as OfferPath[]) : [];
}

async function pathForOffer(page: Page, id: number): Promise<OfferPath | undefined> {
  return (await getOfferPaths(page)).find(p => p.id === id);
}

test.describe('OHLC live offer price paths', () => {
  test('fetches lifecycle history for live offers on load', async ({ page }) => {
    const lifecycleRequest = page.waitForRequest(req =>
      /\/api\/live_offers\/\d+\/lifecycle$/.test(new URL(req.url()).pathname),
    );
    await gotoAndWaitForData(page);
    await lifecycleRequest;
  });

  test('plots the full price history of live offers, not just the latest price', async ({ page }) => {
    await gotoAndWaitForData(page);
    await waitForChartReady(ohlcPanel(page), page);

    // The first render happens before the lifecycle fetch resolves, so poll
    // until the offer flips from fallback to lifecycle mode.
    await expect
      .poll(async () => (await pathForOffer(page, 1))?.mode, { timeout: 10_000 })
      .toBe('lifecycle');

    const offer1 = (await pathForOffer(page, 1))!;
    expect(offer1.live).toBe(true);
    // All mocked history points plus the "now" tip at the current offer price.
    expect(offer1.points).toBe(MOCK_LIVE_OFFER_LIFECYCLES[1].length + 1);
    // The mocked net premium flips sign once → exactly two color segments.
    expect(offer1.segments).toBe(2);

    const offer6 = (await pathForOffer(page, 6))!;
    expect(offer6.mode).toBe('lifecycle');
    expect(offer6.points).toBe(MOCK_LIVE_OFFER_LIFECYCLES[6].length + 1);
    expect(offer6.segments).toBe(1);

    // A live offer whose lifecycle is empty must still render as a stub.
    const offer2 = (await pathForOffer(page, 2))!;
    expect(offer2.mode).toBe('fallback');
    expect(offer2.points).toBe(2);
  });

  test('visual regression: live offer paths trace history on the chart', async ({ page }) => {
    await gotoAndWaitForData(page);

    const panel = ohlcPanel(page);
    await waitForChartReady(panel, page);
    await expect
      .poll(async () => (await pathForOffer(page, 1))?.mode, { timeout: 10_000 })
      .toBe('lifecycle');
    await page.waitForTimeout(500);

    await expect(panel).toHaveScreenshot('ohlc-chart-live-offer-paths.png', {
      maxDiffPixelRatio: 0.12,
    });
  });

  test('discards non-premium offers even when the filter includes them', async ({ page }) => {
    await gotoAndWaitForData(page);
    await waitForChartReady(ohlcPanel(page), page);

    // Let non-premium offers through the filters: include them and widen the
    // premium range so negative premiums pass.
    await openSettings(page);
    const cp = controlPanel(page);
    await jsClick(cp.locator('button').filter({ hasText: 'Net Premium Full' }));
    await page.locator('.absolute button').filter({ hasText: 'Incl. non premium offers' }).click();
    await jsFill(cp.locator('input[placeholder="Min"]'), '-10');
    await closeSettings(page);

    // The table must now show ALL live offers, including non-premium ones
    // (mock offers 8, 9 and 13 have a negative net premium).
    await expect
      .poll(async () => offersPanel(page).locator('table tbody tr').count())
      .toBe(13);

    // …but the chart must only plot the ones with a positive premium.
    await expect
      .poll(async () => (await getOfferPaths(page)).map(p => p.id).sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 10, 11, 12]);
  });

  test('falls back to price stubs when the live lifecycle endpoint fails', async ({ page }) => {
    await page.route('**/api/live_offers/*/lifecycle*', route =>
      route.fulfill({ status: 500, json: { error: 'lifecycle unavailable' } }),
    );

    await gotoAndWaitForData(page);
    const panel = ohlcPanel(page);
    await waitForChartReady(panel, page);

    await expect
      .poll(async () => (await getOfferPaths(page)).length, { timeout: 10_000 })
      .toBeGreaterThan(0);

    const livePaths = (await getOfferPaths(page)).filter(p => p.live);
    expect(livePaths.length).toBeGreaterThan(0);
    for (const path of livePaths) {
      expect(path.mode).toBe('fallback');
      expect(path.points).toBe(2);
    }

    // The chart itself must survive the failure.
    const box = await panel.locator('canvas').first().boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(50);
    expect(box!.height).toBeGreaterThan(50);
  });
});
