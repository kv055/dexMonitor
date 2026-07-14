import { test, expect, gotoAndWaitForData } from '../fixtures/base-fixture';

test.describe('Statistics', () => {
  // Regression: the Statistics tab used to hang on its loading spinner forever
  // in dev — StrictMode's double-mount aborted the first /api/statistics fetch
  // and the reload deduped onto the aborted (never-dispatching) promise.
  test('switches between live, past, and shared views', async ({ page }) => {
    await gotoAndWaitForData(page);
    await page.getByRole('button', { name: 'Statistics', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Live Offers', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /offer lifecycle length by premium rate/i })).toBeVisible();
    await expect(page.getByText('1 offer', { exact: true })).toBeVisible();
    const lifecycleChart = page.getByRole('img', { name: /offer lifecycle length by premium rate/i });
    const chartBounds = await lifecycleChart.boundingBox();
    if (!chartBounds) throw new Error('lifecycle chart has no bounds');
    await page.mouse.move(chartBounds.x + chartBounds.width * 0.65, chartBounds.y + chartBounds.height - 8);
    await page.mouse.down();
    await page.mouse.move(chartBounds.x + chartBounds.width * 0.45, chartBounds.y + chartBounds.height - 8);
    await page.mouse.up();
    await expect(page.getByRole('button', { name: '⟲ Reset view' })).toBeVisible();
    await page.getByRole('button', { name: '⟲ Reset view' }).click();
    await page.mouse.move(chartBounds.x + 20, chartBounds.y + chartBounds.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(chartBounds.x + 20, chartBounds.y + chartBounds.height * 0.4);
    await page.mouse.up();
    await expect(page.getByRole('button', { name: '⟲ Reset view' })).toBeVisible();
    await expect(page.locator('text=Loading statistics')).toHaveCount(0);
    await expect(page.getByText('12 active · 2 exchanges')).toBeVisible();

    await page.getByRole('button', { name: 'Past Offers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Past Offers', exact: true })).toBeVisible();
    await expect(page.getByText('34 closed summary in window')).toBeVisible();

    await page.getByRole('button', { name: 'All Offers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'All Offers', exact: true })).toBeVisible();
    await expect(page.getByText('46 in last 168h (live + past)')).toBeVisible();
    await expect(page.getByText('3 offers', { exact: true })).toBeVisible();
  });
});
