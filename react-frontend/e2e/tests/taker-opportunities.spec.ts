import { test, expect, gotoAndWaitForData } from '../fixtures/base-fixture';

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

    // Expanded panel renders the DepthChart with its own heading.
    const depthHeading = page.locator('h3').filter({ hasText: 'Orderbook Depth' });
    await expect(depthHeading).toBeVisible();

    await page.getByRole('button', { name: 'Hide orderbook depth chart' }).click();
    await expect(depthHeading).toHaveCount(0);

    const showDepth = page.getByRole('button', { name: 'Show orderbook depth chart' });
    await expect(showDepth).toBeVisible();
    await expect(showDepth).toHaveAttribute('aria-expanded', 'false');

    await showDepth.click();
    await expect(depthHeading).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hide orderbook depth chart' })).toHaveAttribute('aria-expanded', 'true');
  });

  test('selecting a live offer swaps the depth chart for the Trade Tracing panel', async ({ page }) => {
    await gotoAndWaitForData(page);
    await page.getByRole('button', { name: 'dex Monitor' }).click();

    const depthHeading = page.locator('h3').filter({ hasText: 'Orderbook Depth' });
    const tracingHeading = page.locator('h3').filter({ hasText: 'Trade Tracing' });
    await expect(depthHeading).toBeVisible();

    // Select a live offer row in the Live Offers table.
    const firstRow = page.locator('table tbody tr').first();
    await firstRow.click();
    await expect(tracingHeading).toBeVisible();
    await expect(depthHeading).toHaveCount(0);

    // Deselecting restores the depth chart.
    await firstRow.click({ force: true });
    await expect(tracingHeading).toHaveCount(0);
    await expect(depthHeading).toBeVisible();
  });
});
