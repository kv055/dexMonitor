import { test, expect, gotoAndWaitForData, controlPanel, jsClick, jsFill } from '../fixtures/base-fixture';

test.describe('ControlPanel', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWaitForData(page);
  });

  test('renders all filter section labels', async ({ page }) => {
    const cp = controlPanel(page);
    const label = (text: string) =>
      cp.locator('span.uppercase').filter({ hasText: new RegExp(`^${text}$`) });

    await expect(label('Currency')).toBeVisible();
    await expect(label('Ref Price')).toBeVisible();
    await expect(label('Timeframe')).toBeVisible();
    await expect(label('Side')).toBeVisible();
    await expect(label('Exchange')).toBeVisible();
    await expect(label('Payment')).toBeVisible();
    await expect(label('Status')).toBeVisible();
    await expect(label('Premium %')).toBeVisible();
  });

  test('currency and ref price selects are disabled', async ({ page }) => {
    const cp = controlPanel(page);
    await expect(cp.locator('select').first()).toBeDisabled();
    await expect(cp.locator('select').nth(1)).toBeDisabled();
  });

  test('timeframe dropdown shows options and selection works', async ({ page }) => {
    const cp = controlPanel(page);

    const timeframeBtn = cp.locator('button').filter({ hasText: 'Last 24h' });
    await expect(timeframeBtn).toBeVisible();
    await timeframeBtn.click();

    await expect(page.locator('button').filter({ hasText: 'Last 1h' })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: 'Last 6h' })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: 'Last 48h' })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: 'Last 7d' })).toBeVisible();

    await page.locator('button').filter({ hasText: 'Last 6h' }).click();
    await expect(cp.locator('button').filter({ hasText: 'Last 6h' })).toBeVisible();
  });

  test('direction dropdown shows All/Asks/Bids and selection works', async ({ page }) => {
    const cp = controlPanel(page);

    // Direction button has accessible name like "All [count] ▾"
    const sideBtn = cp.getByRole('button', { name: /^All \d/ });
    await jsClick(sideBtn);

    await expect(page.locator('button').filter({ hasText: 'Asks (Sell)' })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: 'Bids (Buy)' })).toBeVisible();

    await page.locator('button').filter({ hasText: 'Asks (Sell)' }).click();
    await expect(cp.locator('button').filter({ hasText: 'Asks (Sell)' })).toBeVisible();
  });

  test('exchange dropdown shows exchanges and selection works', async ({ page }) => {
    const cp = controlPanel(page);
    await jsClick(cp.locator('button').filter({ hasText: 'All Exchanges' }));

    await expect(page.locator('button').filter({ hasText: /BISQ/i })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: /HODLHODL/i })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: /ROBOSATS/i })).toBeVisible();

    await page.locator('button').filter({ hasText: /BISQ/i }).first().click();
    await expect(cp.locator('span').filter({ hasText: /^BISQ$/i })).toBeVisible();
  });

  test('payment dropdown shows options and selection works', async ({ page }) => {
    const cp = controlPanel(page);
    await jsClick(cp.locator('button').filter({ hasText: 'All Payments' }));

    // Wait for dropdown menu to render and choose the grouped payment option.
    const sepaOption = page.locator('.absolute button').filter({ hasText: 'SEPA Instant' }).first();
    await sepaOption.waitFor({ state: 'visible' });
    await expect(page.locator('.absolute button').filter({ hasText: 'Revolut' }).first()).toBeVisible();

    await sepaOption.click();
    await expect(cp.locator('button').filter({ hasText: 'SEPA Instant' })).toBeVisible();
  });

  test('status dropdown shows All Orders/Open/Closed', async ({ page }) => {
    const cp = controlPanel(page);

    // Status button has accessible name like "Open [count] ▾"
    const statusBtn = cp.getByRole('button', { name: /^Open \d/ });
    await jsClick(statusBtn);

    await expect(page.locator('button').filter({ hasText: 'All Orders' })).toBeVisible();
    await expect(page.locator('button').filter({ hasText: 'Closed' })).toBeVisible();

    await page.locator('button').filter({ hasText: 'All Orders' }).click();
  });

  test('premium range inputs accept values', async ({ page }) => {
    const cp = controlPanel(page);
    const minInput = cp.locator('input[placeholder="Min"]');
    const maxInput = cp.locator('input[placeholder="Max"]');

    // Use evaluate to focus since canvas may intercept
    await jsFill(minInput, '1.5');
    await jsFill(maxInput, '5.0');

    await expect(minInput).toHaveValue('1.5');
    await expect(maxInput).toHaveValue('5.0');
  });

  test('premium dropdown can include non premium offers', async ({ page }) => {
    const cp = controlPanel(page);
    const premiumDropdown = cp.locator('button').filter({ hasText: 'Raw Premium' });

    await expect(premiumDropdown).toBeVisible();

    await jsClick(premiumDropdown);
    await page.locator('.absolute button').filter({ hasText: 'Incl. non premium offers' }).click();
    await expect(cp.locator('button').filter({ hasText: 'Incl. non premium offers' })).toBeVisible();

    await jsClick(cp.locator('button').filter({ hasText: 'Incl. non premium offers' }));
    await page.locator('.absolute button').filter({ hasText: 'Net Premium Full' }).click();
    await expect(cp.locator('button').filter({ hasText: 'Net Premium Full' })).toBeVisible();
  });

  test('reset button restores default filters', async ({ page }) => {
    const cp = controlPanel(page);

    // Change exchange filter
    await jsClick(cp.locator('button').filter({ hasText: 'All Exchanges' }));
    await page.locator('button').filter({ hasText: /BISQ/i }).first().click();

    // Fill premium min
    await jsFill(cp.locator('input[placeholder="Min"]'), '2.0');

    // Click Reset (row 1 — no canvas overlap)
    await cp.locator('button').filter({ hasText: '↺ Reset' }).click();

    await expect(cp.locator('button').filter({ hasText: 'All Exchanges' })).toBeVisible();
    await expect(cp.locator('input[placeholder="Min"]')).toHaveValue('');
    await expect(cp.locator('button').filter({ hasText: 'Raw Premium' })).toBeVisible();
  });

  test('refresh button triggers API calls', async ({ page }) => {
    const cp = controlPanel(page);
    const statsRequest = page.waitForRequest(req => req.url().includes('/api/stats'));
    await cp.locator('button').filter({ hasText: '↻ Refresh' }).click();
    await statsRequest;
  });
});
