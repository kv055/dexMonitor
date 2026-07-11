import { test, expect, gotoAndWaitForData, openControlPanel, jsClick } from '../fixtures/base-fixture';
import type { Page } from '@playwright/test';

/**
 * The Insights chart draws no offer overlays until they are explicitly
 * ticked (per-row or via the header "all" checkbox), and every Live/Past
 * switch hides everything again. Ticking re-fits the x-axis to the plotted
 * offers — oldest start → latest closure (or "now" for live offers) — with
 * the candle size re-picked for that span. The chart exposes its state on
 * the container as data-visible-range / data-offer-paths.
 */

async function visibleRangeSpanHours(page: Page): Promise<number> {
  const attr = await page.locator('[data-visible-range]').getAttribute('data-visible-range');
  if (!attr) return 0;
  const range = JSON.parse(attr) as { from: number; to: number };
  return (range.to - range.from) / 3600;
}

async function plottedOfferCount(page: Page): Promise<number> {
  const attr = await page.locator('[data-offer-paths]').getAttribute('data-offer-paths');
  return attr ? (JSON.parse(attr) as unknown[]).length : 0;
}

function headerTickAll(page: Page) {
  return page.getByTitle('Show/hide all offers on the OHLC chart');
}

test.describe('Insights chart offer visibility and fit-to-offers', () => {
  test('offers start hidden; ticking all renders them and fits the x-axis', async ({ page }) => {
    await gotoAndWaitForData(page);
    await openControlPanel(page); // dex Monitor, Live mode

    // Nothing is plotted until offers are ticked.
    await expect.poll(() => plottedOfferCount(page), { timeout: 10_000 }).toBe(0);

    await jsClick(headerTickAll(page));
    await expect.poll(() => plottedOfferCount(page), { timeout: 10_000 }).toBeGreaterThan(0);

    // Oldest premium live mock offer started 12h before the frozen "now"; with
    // padding the fitted window is ~13h — far narrower than the 24h default.
    await expect.poll(() => visibleRangeSpanHours(page), { timeout: 10_000 }).toBeGreaterThan(10);
    expect(await visibleRangeSpanHours(page)).toBeLessThan(17);

    // ~13h at the 120-candle budget lands on 15m candles.
    await expect(page.getByRole('button', { name: '15m', exact: true })).toHaveClass(/bg-accent/);
  });

  test('switching Live/Past hides all offers again and re-ticking re-fits', async ({ page }) => {
    await gotoAndWaitForData(page);
    await openControlPanel(page);

    await jsClick(headerTickAll(page));
    await expect.poll(() => plottedOfferCount(page), { timeout: 10_000 }).toBeGreaterThan(0);
    await expect.poll(() => visibleRangeSpanHours(page), { timeout: 10_000 }).toBeGreaterThan(10);
    const liveSpan = await visibleRangeSpanHours(page);

    // Switching to Past hides everything; with nothing plotted the chart
    // falls back to the default window.
    await jsClick(page.getByRole('button', { name: 'Past Offers', exact: true }));
    await expect.poll(() => plottedOfferCount(page), { timeout: 10_000 }).toBe(0);
    await expect.poll(() => visibleRangeSpanHours(page), { timeout: 10_000 }).toBeGreaterThan(20);

    // Back to Live: still hidden until ticked; ticking re-fits to the offers.
    await jsClick(page.getByRole('button', { name: 'Live Offers', exact: true }));
    await expect.poll(() => plottedOfferCount(page), { timeout: 10_000 }).toBe(0);
    await jsClick(headerTickAll(page));
    await expect
      .poll(async () => Math.abs(await visibleRangeSpanHours(page) - liveSpan), { timeout: 10_000 })
      .toBeLessThan(2);
  });
});
