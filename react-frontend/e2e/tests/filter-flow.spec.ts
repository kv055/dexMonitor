import { test, expect, gotoAndWaitForData, waitForChartReady, controlPanel, openControlPanel, closeControlPanel, offersPanel, depthPanel, jsClick, jsFill } from '../fixtures/base-fixture';

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

/** Disable every exchange pill, then re-enable only the given one. */
async function enableOnlyExchange(
  page: import('@playwright/test').Page,
  exchangeLabel: RegExp,
) {
  const cp = controlPanel(page);
  await jsClick(cp.getByRole('button', { name: 'None', exact: true }));
  await jsClick(cp.getByRole('button', { name: exchangeLabel }));
}

test.describe('Filter Flow — Cross-component integration', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWaitForData(page);
  });

  test('exchange filter shows only matching rows', async ({ page }) => {
    const panel = offersPanel(page);

    // Wait for table to have data rows before interacting with filters
    await expect(panel.locator('table tbody tr').first()).not.toHaveText('No offers', { timeout: 5000 });

    await openControlPanel(page);
    await enableOnlyExchange(page, /Bisq v1/);
    await closeControlPanel(page);
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
    const panel = offersPanel(page);

    // Default premiumOnly view has mostly buy (Bid) offers — select "Buy"
    await openControlPanel(page);
    await jsClick(controlPanel(page).getByRole('button', { name: 'Buy', exact: true }));
    await closeControlPanel(page);
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
    const panel = offersPanel(page);

    // Set premium min to 3.0
    await openControlPanel(page);
    const minInput = controlPanel(page).locator('input[placeholder="Min"]');
    await jsFill(minInput, '3');
    await closeControlPanel(page);
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
    const panel = offersPanel(page);

    await openControlPanel(page);
    await selectDropdownOption(page, controlPanel(page).locator('button').filter({ hasText: 'All Payments' }), 'SEPA Instant');
    await closeControlPanel(page);
    await page.waitForTimeout(200);

    // Payment is the second-to-last column; the last one is the chart-visibility checkbox.
    const paymentCells = panel.locator('table tbody td:nth-last-child(2)');
    const count = await paymentCells.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const text = await paymentCells.nth(i).textContent();
      expect(text?.trim()).toBe('SEPA Instant');
    }
  });

  test('insights live offers list follows the sidebar filters', async ({ page }) => {
    await openControlPanel(page);
    const insightsTable = page.locator('table');

    // Live mode shows the offers preview table inside the insights panel.
    await expect(insightsTable.locator('tbody tr').first()).toBeVisible();
    const initialCount = await insightsTable.locator('tbody tr').count();
    expect(initialCount).toBeGreaterThan(0);

    // Filtering by direction narrows the list in place.
    await jsClick(controlPanel(page).getByRole('button', { name: 'Buy', exact: true }));
    await page.waitForTimeout(200);

    const sideCells = insightsTable.locator('tbody td:nth-child(2)');
    const count = await sideCells.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const text = await sideCells.nth(i).textContent();
      expect(text?.trim()).toBe('Bid');
    }
  });

  test('premium dropdown shows/hides non premium offers', async ({ page }) => {
    const panel = offersPanel(page);
    const cp = controlPanel(page);

    const rowsWithPremium = await panel.locator('table tbody tr').count();

    // Include non-premium offers.
    await openControlPanel(page);
    await selectDropdownOption(page, cp.locator('button').filter({ hasText: 'Net Premium Full' }), 'Incl. non premium offers');
    await closeControlPanel(page);
    await page.waitForTimeout(300);

    const rowsWithout = await panel.locator('table tbody tr').count();
    expect(rowsWithout).toBeGreaterThanOrEqual(rowsWithPremium);

    // Switch back to the default premium-only metric.
    await openControlPanel(page);
    await selectDropdownOption(page, cp.locator('button').filter({ hasText: 'Incl. non premium offers' }), 'Net Premium Full');
    await closeControlPanel(page);
    await page.waitForTimeout(300);

    const rowsAgain = await panel.locator('table tbody tr').count();
    expect(rowsAgain).toBe(rowsWithPremium);
  });

  test('combining multiple filters narrows results', async ({ page }) => {
    const panel = offersPanel(page);
    const cp = controlPanel(page);

    const initialCount = await panel.locator('table tbody tr').count();

    // Filter to bisq
    await openControlPanel(page);
    await enableOnlyExchange(page, /Bisq v1/);
    await closeControlPanel(page);
    await page.waitForTimeout(200);

    const bisqCount = await panel.locator('table tbody tr').count();
    expect(bisqCount).toBeLessThanOrEqual(initialCount);

    // Set premium min
    await openControlPanel(page);
    const minInput = cp.locator('input[placeholder="Min"]');
    await jsFill(minInput, '2');
    await closeControlPanel(page);
    await page.waitForTimeout(200);

    const filteredCount = await panel.locator('table tbody tr').count();
    expect(filteredCount).toBeLessThanOrEqual(bisqCount);
  });

  test('reset clears all filters and restores table', async ({ page }) => {
    const panel = offersPanel(page);
    const cp = controlPanel(page);

    const initialCount = await panel.locator('table tbody tr').count();

    // Apply filters
    await openControlPanel(page);
    await enableOnlyExchange(page, /Bisq v1/);
    await page.waitForTimeout(100);

    const minInput = cp.locator('input[placeholder="Min"]');
    await jsFill(minInput, '5');
    await closeControlPanel(page);
    await page.waitForTimeout(200);

    const filteredCount = await panel.locator('table tbody tr').count();
    expect(filteredCount).toBeLessThan(initialCount);

    // Reset
    await openControlPanel(page);
    await cp.locator('button').filter({ hasText: '↺ Reset filters' }).click();
    await closeControlPanel(page);
    await page.waitForTimeout(400);

    const resetCount = await panel.locator('table tbody tr').count();
    expect(resetCount).toBe(initialCount);
  });

  test('depth chart updates when exchange filter changes', async ({ page }) => {
    const dp = depthPanel(page);
    await waitForChartReady(dp, page);

    const before = await dp.screenshot();

    await openControlPanel(page);
    await enableOnlyExchange(page, /Bisq v1/);
    await closeControlPanel(page);
    await page.waitForTimeout(600);

    const after = await dp.screenshot();
    expect(Buffer.compare(before, after)).not.toBe(0);
  });
});
