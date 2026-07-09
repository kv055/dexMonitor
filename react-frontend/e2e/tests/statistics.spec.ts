import { test, expect, gotoAndWaitForData } from '../fixtures/base-fixture';

test.describe('Statistics', () => {
  // Regression: the Statistics tab used to hang on its loading spinner forever
  // in dev — StrictMode's double-mount aborted the first /api/statistics fetch
  // and the reload deduped onto the aborted (never-dispatching) promise.
  test('switches between live, past, and shared views', async ({ page }) => {
    await gotoAndWaitForData(page);
    await page.getByRole('button', { name: 'Statistics', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Live Offers', exact: true })).toBeVisible();
    await expect(page.locator('text=Loading statistics')).toHaveCount(0);
    await expect(page.getByText('10 active · 3 exchanges')).toBeVisible();

    await page.getByRole('button', { name: 'Past Offers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Past Offers', exact: true })).toBeVisible();
    await expect(page.getByText('34 closed summary in window')).toBeVisible();

    await page.getByRole('button', { name: 'All Offers', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'All Offers', exact: true })).toBeVisible();
    await expect(page.getByText('46 in last 168h (live + past)')).toBeVisible();
  });
});
