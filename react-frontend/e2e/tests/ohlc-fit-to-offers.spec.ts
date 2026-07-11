import { test, expect, gotoAndWaitForData, openControlPanel, jsClick } from '../fixtures/base-fixture';
import type { Page } from '@playwright/test';

/**
 * The Insights chart auto-fits its x-axis to the plotted offers whenever the
 * Live/Past toggle flips: oldest offer start → latest closure (or "now" for
 * live offers), with the candle size re-picked for that span. The chart
 * exposes its visible range on the container as data-visible-range.
 */

async function visibleRangeSpanHours(page: Page): Promise<number> {
  const attr = await page.locator('[data-visible-range]').getAttribute('data-visible-range');
  if (!attr) return 0;
  const range = JSON.parse(attr) as { from: number; to: number };
  return (range.to - range.from) / 3600;
}

test.describe('Insights chart fit-to-offers', () => {
  test('fits the x-axis to the live offers and re-picks the candle size', async ({ page }) => {
    await gotoAndWaitForData(page);
    await openControlPanel(page); // dex Insights, Live mode

    // Oldest premium live mock offer started 12h before the frozen "now"; with
    // padding the fitted window is ~13h — far narrower than the 24h default.
    await expect
      .poll(() => visibleRangeSpanHours(page), { timeout: 10_000 })
      .toBeGreaterThan(10);
    expect(await visibleRangeSpanHours(page)).toBeLessThan(17);

    // ~13h at the 120-candle budget lands on 15m candles.
    await expect(page.getByRole('button', { name: '15m', exact: true })).toHaveClass(/bg-accent/);
  });

  test('re-fits when switching between Live and Past offers', async ({ page }) => {
    await gotoAndWaitForData(page);
    await openControlPanel(page);

    await expect
      .poll(() => visibleRangeSpanHours(page), { timeout: 10_000 })
      .toBeGreaterThan(10);
    const liveSpan = await visibleRangeSpanHours(page);

    // The mocked past-profitable-orders payload is empty, so Past mode falls
    // back to the default window — still a range change driven by the switch.
    await jsClick(page.getByRole('button', { name: 'Past Offers', exact: true }));
    await expect
      .poll(() => visibleRangeSpanHours(page), { timeout: 10_000 })
      .toBeGreaterThan(20);

    // Switching back to Live re-fits to the live offers again.
    await jsClick(page.getByRole('button', { name: 'Live Offers', exact: true }));
    await expect
      .poll(async () => Math.abs(await visibleRangeSpanHours(page) - liveSpan), { timeout: 10_000 })
      .toBeLessThan(2);
  });
});
