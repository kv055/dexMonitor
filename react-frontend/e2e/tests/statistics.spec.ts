import { test, expect, gotoAndWaitForData } from '../fixtures/base-fixture';

test.describe('Statistics', () => {
  // Regression: the Statistics tab used to hang on its loading spinner forever
  // in dev — StrictMode's double-mount aborted the first /api/statistics fetch
  // and the reload deduped onto the aborted (never-dispatching) promise.
  test('renders live, past, and shared sections', async ({ page }) => {
    await gotoAndWaitForData(page);
    await page.getByRole('button', { name: 'Statistics', exact: true }).click();

    await expect(page.getByText('Live Offers', { exact: true })).toBeVisible();
    await expect(page.locator('text=Loading statistics')).toHaveCount(0);

    await expect(page.getByText('Past Offers', { exact: true })).toBeVisible();
    await expect(page.getByText('All Offers', { exact: true })).toBeVisible();
    // Shared window card totals from MOCK_STATISTICS.
    await expect(page.getByText('34 closed summary in window')).toBeVisible();
    await expect(page.getByText('46 in last 168h (live + past)')).toBeVisible();
  });
});
