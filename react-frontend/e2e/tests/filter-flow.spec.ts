import { test, expect, gotoAndWaitForData, waitForChartReady, controlPanel, openControlPanel, closeControlPanel, offersPanel, depthPanel, jsClick, jsFill } from '../fixtures/base-fixture';

const offerRows = (panel: import('@playwright/test').Locator) => panel.getByTestId('live-offers-row');
const offerCells = (panel: import('@playwright/test').Locator, index: number) =>
  offerRows(panel).locator(`:scope > span > span:nth-child(${index + 1})`);

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

    await expect(offerRows(panel).first()).toBeVisible({ timeout: 5000 });

    await openControlPanel(page);
    await enableOnlyExchange(page, /Bisq v1/);
    await closeControlPanel(page);
    await page.waitForTimeout(400);

    const exchangeTags = offerCells(panel, 0);
    await expect(exchangeTags.first()).toBeVisible({ timeout: 5000 });

    const allTexts = await exchangeTags.allTextContents();
    expect(allTexts.length).toBeGreaterThan(0);
    for (const text of allTexts) {
      expect(text.toLowerCase()).toContain('bisq');
    }
  });

  test('direction filter shows only bids', async ({ page }) => {
    const panel = offersPanel(page);

    // Default premium-only view has mostly bid offers — select "Bid".
    await openControlPanel(page);
    await jsClick(controlPanel(page).getByRole('button', { name: 'Bid', exact: true }));
    await closeControlPanel(page);
    await page.waitForTimeout(200);

    const sideCells = offerCells(panel, 1);
    const count = await sideCells.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const text = await sideCells.nth(i).textContent();
      expect(text?.trim()).toBe('Bid');
    }
  });

  test('premium range filters restrict offers', async ({ page }) => {
    const panel = offersPanel(page);

    // Switch the range metric to premium and set its lower bound to 3%.
    await openControlPanel(page);
    const cp = controlPanel(page);
    await jsClick(cp.getByRole('button', { name: '%', exact: true }));
    const minSlider = cp.getByRole('slider', { name: 'Premium % minimum' });
    await jsFill(minSlider, '300');
    await closeControlPanel(page);
    await page.waitForTimeout(300);

    const premCells = offerCells(panel, 2);
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
    const cp = controlPanel(page);
    const paymentScope = cp.getByTitle('Show all methods, linked methods, or selected linked methods');
    await selectDropdownOption(page, paymentScope, 'Linked methods');
    const revolut = cp.getByRole('checkbox', { name: 'Revolut', exact: true });
    await revolut.check();
    await expect(revolut).toBeChecked();
    await closeControlPanel(page);
    await page.waitForTimeout(200);

    const paymentCells = offerCells(panel, 3);
    const count = await paymentCells.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const text = await paymentCells.nth(i).textContent();
      expect(text?.trim()).toMatch(/Revolut/);
    }
  });

  test('insights live offers list follows the sidebar filters', async ({ page }) => {
    await openControlPanel(page);
    const insightsList = offersPanel(page);

    await expect(offerRows(insightsList).first()).toBeVisible();
    const initialCount = await offerRows(insightsList).count();
    expect(initialCount).toBeGreaterThan(0);

    // Filtering by direction narrows the list in place.
    await jsClick(controlPanel(page).getByRole('button', { name: 'Bid', exact: true }));
    await page.waitForTimeout(200);

    const sideCells = offerCells(insightsList, 1);
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

    const rowsWithPremium = await offerRows(panel).count();

    // Include non-premium offers.
    await openControlPanel(page);
    await selectDropdownOption(page, cp.getByTitle(/Raw is the quoted premium/), 'Incl. non premium offers');
    await closeControlPanel(page);
    await page.waitForTimeout(300);

    const rowsWithout = await offerRows(panel).count();
    expect(rowsWithout).toBeGreaterThanOrEqual(rowsWithPremium);

    // Switch back to the default premium-only metric.
    await openControlPanel(page);
    await selectDropdownOption(page, cp.getByTitle(/Raw is the quoted premium/), 'Net Full');
    await closeControlPanel(page);
    await page.waitForTimeout(300);

    const rowsAgain = await offerRows(panel).count();
    expect(rowsAgain).toBe(rowsWithPremium);
  });

  test('combining multiple filters narrows results', async ({ page }) => {
    const panel = offersPanel(page);
    const cp = controlPanel(page);

    const initialCount = await offerRows(panel).count();

    // Filter to bisq
    await openControlPanel(page);
    await enableOnlyExchange(page, /Bisq v1/);
    await closeControlPanel(page);
    await page.waitForTimeout(200);

    const bisqCount = await offerRows(panel).count();
    expect(bisqCount).toBeLessThanOrEqual(initialCount);

    // Combine the exchange selection with a direction filter.
    await openControlPanel(page);
    await jsClick(cp.getByRole('button', { name: 'Bid', exact: true }));
    await closeControlPanel(page);
    await page.waitForTimeout(200);

    const filteredCount = await offerRows(panel).count();
    expect(filteredCount).toBeLessThanOrEqual(bisqCount);
  });

  test('reset clears all filters and restores table', async ({ page }) => {
    const panel = offersPanel(page);
    const cp = controlPanel(page);

    const initialCount = await offerRows(panel).count();

    // Apply filters
    await openControlPanel(page);
    await enableOnlyExchange(page, /Bisq v1/);
    await page.waitForTimeout(100);

    await jsClick(cp.getByRole('button', { name: 'Bid', exact: true }));
    await closeControlPanel(page);
    await page.waitForTimeout(200);

    const filteredCount = await offerRows(panel).count();
    expect(filteredCount).toBeLessThan(initialCount);

    // Reset
    await openControlPanel(page);
    await cp.locator('button').filter({ hasText: '↺ Reset filters' }).click();
    await closeControlPanel(page);
    await page.waitForTimeout(400);

    const resetCount = await offerRows(panel).count();
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
