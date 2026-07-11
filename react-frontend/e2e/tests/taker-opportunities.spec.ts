import { test, expect, gotoAndWaitForData } from '../fixtures/base-fixture';

test.describe('Taker opportunities', () => {
  test('collapses the Insights filters into a side rail and restores them', async ({ page }) => {
    await gotoAndWaitForData(page);
    await page.getByRole('button', { name: 'dex Insights' }).click();

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
});
