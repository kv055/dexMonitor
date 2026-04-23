import { test, expect, gotoAndWaitForData, waitForChartReady, controlPanel, offersPanel, depthPanel, jsClick, jsFill } from '../fixtures/base-fixture';

/**
 * Open a dropdown via jsClick, wait for the popup menu to appear, and click an option.
 * The popup is an absolute-positioned div with button children.
 */
async function selectDropdownOption(
  page: import('@playwright/test').Page,
  trigger: import('@playwright/test').Locator,
  optionText: string | RegExp,
) {
  await jsClick(trigger);
  const option = page.locator('.absolute button').filter({ hasText: optionText }).first();
  await option.waitFor({ state: 'visible' });
  await option.click();
}

test.describe('Filter Flow — Cross-component integration', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWaitForData(page);
  });

  test('exchange filter shows only matching rows', async ({ page }) => {
    const cp = controlPanel(page);
    const panel = offersPanel(page);

    // Wait for table to have data rows before interacting with filters
    await expect(panel.locator('table tbody tr').first()).not.toHaveText('No offers', { timeout: 5000 });

    await selectDropdownOption(page, cp.locator('button').filter({ hasText: 'All Exchanges' }), /BISQ/i);
    await page.waitForTimeout(400);

    const exchangeTags = panel.locator('table tbody td:first-child span');
    await expect(exchangeTags.first()).toBeVisible({ timeout: 5000 });

    const allTexts = await exchangeTags.allTextContents();
    expect(allTexts.length).toBeGreaterThan(0);
    for (const text of allTexts) {
      expect(text.toLowerCase()).toContain('bisq');
    }
  });

  test('direction filter shows only bids', async ({ page }) => {
    const cp = controlPanel(page);
    const panel = offersPanel(page);

    // Default premiumOnly view has mostly buy (Bid) offers — select "Bids (Buy)"
    await selectDropdownOption(page, cp.getByRole('button', { name: /^All \d/ }), 'Bids (Buy)');
    await page.waitForTimeout(200);

    const sideCells = panel.locator('table tbody td:nth-child(2)');
    const count = await sideCells.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const text = await sideCells.nth(i).textContent();
      expect(text?.trim()).toBe('Bid');
    }
  });

  test('premium range filters restrict offers', async ({ page }) => {
    const cp = controlPanel(page);
    const panel = offersPanel(page);

    // Set premium min to 3.0
    const minInput = cp.locator('input[placeholder="Min"]');
    await jsFill(minInput, '3');
    await page.waitForTimeout(300);

    const premCells = panel.locator('table tbody td:nth-child(3)');
    const count = await premCells.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const text = await premCells.nth(i).textContent();
      if (text && text !== '—') {
        const val = parseFloat(text.replace('%', ''));
        expect(val).toBeGreaterThanOrEqual(3.0);
      }
    }
  });

  test('payment method filter works', async ({ page }) => {
    const cp = controlPanel(page);
    const panel = offersPanel(page);

    await selectDropdownOption(page, cp.locator('button').filter({ hasText: 'All Payments' }), 'SEPA Instant');
    await page.waitForTimeout(200);

    const paymentCells = panel.locator('table tbody td:last-child');
    const count = await paymentCells.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const text = await paymentCells.nth(i).textContent();
      expect(text?.trim()).toBe('SEPA Instant');
    }
  });

  test('status filter toggles between open and closed', async ({ page }) => {
    const panel = offersPanel(page);
    const cp = controlPanel(page);

    const openCount = await panel.locator('table tbody tr').count();

    // Switch to "All Orders"
    await selectDropdownOption(page, cp.getByRole('button', { name: /^Open \d/ }), 'All Orders');
    await page.waitForTimeout(200);

    const allCount = await panel.locator('table tbody tr').count();
    expect(allCount).toBeGreaterThanOrEqual(openCount);
  });

  test('premium only toggle shows/hides unprofitable offers', async ({ page }) => {
    const panel = offersPanel(page);
    const cp = controlPanel(page);

    const rowsWithPremium = await panel.locator('table tbody tr').count();

    // Toggle OFF
    await jsClick(cp.locator('button').filter({ hasText: 'Premium Only' }));
    await page.waitForTimeout(300);

    const rowsWithout = await panel.locator('table tbody tr').count();
    expect(rowsWithout).toBeGreaterThanOrEqual(rowsWithPremium);

    // Toggle back ON
    await jsClick(cp.locator('button').filter({ hasText: 'Premium Only' }));
    await page.waitForTimeout(300);

    const rowsAgain = await panel.locator('table tbody tr').count();
    expect(rowsAgain).toBe(rowsWithPremium);
  });

  test('combining multiple filters narrows results', async ({ page }) => {
    const panel = offersPanel(page);
    const cp = controlPanel(page);

    const initialCount = await panel.locator('table tbody tr').count();

    // Filter to bisq
    await selectDropdownOption(page, cp.locator('button').filter({ hasText: 'All Exchanges' }), /BISQ/i);
    await page.waitForTimeout(200);

    const bisqCount = await panel.locator('table tbody tr').count();
    expect(bisqCount).toBeLessThanOrEqual(initialCount);

    // Set premium min
    const minInput = cp.locator('input[placeholder="Min"]');
    await jsFill(minInput, '2');
    await page.waitForTimeout(200);

    const filteredCount = await panel.locator('table tbody tr').count();
    expect(filteredCount).toBeLessThanOrEqual(bisqCount);
  });

  test('reset clears all filters and restores table', async ({ page }) => {
    const panel = offersPanel(page);
    const cp = controlPanel(page);

    const initialCount = await panel.locator('table tbody tr').count();

    // Apply filters
    await selectDropdownOption(page, cp.locator('button').filter({ hasText: 'All Exchanges' }), /BISQ/i);
    await page.waitForTimeout(100);

    const minInput = cp.locator('input[placeholder="Min"]');
    await jsFill(minInput, '5');
    await page.waitForTimeout(200);

    const filteredCount = await panel.locator('table tbody tr').count();
    expect(filteredCount).toBeLessThan(initialCount);

    // Reset
    await cp.locator('button').filter({ hasText: '↺ Reset' }).click();
    await page.waitForTimeout(400);

    const resetCount = await panel.locator('table tbody tr').count();
    expect(resetCount).toBe(initialCount);
  });

  test('timeframe change triggers API calls with correct hours', async ({ page }) => {
    const cp = controlPanel(page);

    const statsRequest = page.waitForRequest(req =>
      req.url().includes('/api/stats') && req.url().includes('hours=6'),
    );
    const ohlcRequest = page.waitForRequest(req =>
      req.url().includes('/api/ohlc') && req.url().includes('hours=6'),
    );

    await cp.locator('button').filter({ hasText: 'Last 24h' }).click();
    await page.locator('button').filter({ hasText: 'Last 6h' }).click();

    await Promise.all([statsRequest, ohlcRequest]);
  });

  test('depth chart updates when exchange filter changes', async ({ page }) => {
    const dp = depthPanel(page);
    const cp = controlPanel(page);
    await waitForChartReady(dp, page);

    const before = await dp.screenshot();

    await selectDropdownOption(page, cp.locator('button').filter({ hasText: 'All Exchanges' }), /BISQ/i);
    await page.waitForTimeout(600);

    const after = await dp.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });
});
