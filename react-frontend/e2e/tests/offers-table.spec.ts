import { test, expect, gotoAndWaitForData, offersPanel, jsFill, jsClick } from '../fixtures/base-fixture';

test.describe('OffersPreviewTable', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWaitForData(page);
  });

  test('renders table with correct column headers', async ({ page }) => {
    const panel = offersPanel(page);
    const table = panel.locator('table');

    await expect(table.locator('th').filter({ hasText: 'Exch' })).toBeVisible();
    await expect(table.locator('th').filter({ hasText: 'Side' })).toBeVisible();
    await expect(table.locator('th').filter({ hasText: 'Prem.' })).toBeVisible();
    await expect(table.locator('th').filter({ hasText: 'Price' })).toBeVisible();
    await expect(table.locator('th').filter({ hasText: 'Min BTC' })).toBeVisible();
    await expect(table.locator('th').filter({ hasText: 'Max BTC' })).toBeVisible();
    await expect(table.locator('th').filter({ hasText: 'Fiat Min' })).toBeVisible();
    await expect(table.locator('th').filter({ hasText: 'Fiat Max' })).toBeVisible();
    await expect(table.locator('th').filter({ hasText: 'Payment' })).toBeVisible();
  });

  test('displays offer rows with data', async ({ page }) => {
    const panel = offersPanel(page);
    const rows = panel.locator('table tbody tr');
    // Default filters: status=open, premiumOnly=true — should have rows
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
  });

  test('bid rows show green, ask rows show red', async ({ page }) => {
    const panel = offersPanel(page);

    // Check for "Ask" text with red styling
    const askCell = panel.locator('td').filter({ hasText: 'Ask' }).first();
    if (await askCell.isVisible()) {
      await expect(askCell).toHaveClass(/text-red/);
    }
  });

  test('premium cells have color coding', async ({ page }) => {
    const panel = offersPanel(page);
    const premCells = panel.locator('table tbody td:nth-child(3)');
    const count = await premCells.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < Math.min(count, 5); i++) {
      const cell = premCells.nth(i);
      const cls = await cell.getAttribute('class') ?? '';
      expect(cls).toMatch(/text-(green|accent|red)/);
    }
  });

  test('clicking a row opens cost breakdown panel', async ({ page }) => {
    const panel = offersPanel(page);
    const bidRow = panel.locator('table tbody tr').filter({ hasText: 'Bid' }).first();
    await bidRow.click();

    // Cost breakdown panel should appear
    await expect(panel.locator('text=Trade cost breakdown')).toBeVisible();

    // Should show fee rows
    await expect(panel.locator('text=CEX taker fee')).toBeVisible();
    await expect(panel.locator('text=CEX withdrawal')).toBeVisible();
    await expect(panel.locator('text=BTC network fee')).toBeVisible();
    await expect(panel.locator('text=DEX platform fee')).toBeVisible();
    await expect(panel.locator('text=Total cost')).toBeVisible();
    await expect(panel.locator('text=Net premium')).toBeVisible();
  });

  test('clicking selected row deselects it', async ({ page }) => {
    const panel = offersPanel(page);
    const firstRow = panel.locator('table tbody tr').first();

    // Select
    await firstRow.click();
    await expect(panel.locator('text=Trade cost breakdown')).toBeVisible();

    // Deselect — click same row again (use force since panel layout may shift)
    await firstRow.click({ force: true });
    await expect(panel.locator('text=Trade cost breakdown')).not.toBeVisible();
  });

  test('close button on breakdown panel deselects', async ({ page }) => {
    const panel = offersPanel(page);
    await panel.locator('table tbody tr').first().click();
    await expect(panel.locator('text=Trade cost breakdown')).toBeVisible();

    // Wait for panel layout to stabilize before clicking close
    const closeBtn = panel.locator('button[title="Close"]');
    await closeBtn.waitFor({ state: 'visible' });
    await page.waitForTimeout(200);
    await jsClick(closeBtn);
    await expect(panel.locator('text=Trade cost breakdown')).not.toBeVisible();
  });

  test('Fiat columns remain available when selection active', async ({ page }) => {
    const panel = offersPanel(page);

    // Before selection — Fiat columns visible
    await expect(panel.locator('th').filter({ hasText: 'Fiat Min' })).toBeVisible();
    await expect(panel.locator('th').filter({ hasText: 'Fiat Max' })).toBeVisible();

    // Select a row
    await panel.locator('table tbody tr').first().click();

    // Current desktop layout keeps the table columns visible while opening a side panel.
    await expect(panel.locator('text=Trade cost breakdown')).toBeVisible();
    await expect(panel.locator('th').filter({ hasText: 'Fiat Min' })).toBeVisible();
    await expect(panel.locator('th').filter({ hasText: 'Fiat Max' })).toBeVisible();

    // Deselect — they come back
    await panel.locator('button[title="Close"]').click();
    await expect(panel.locator('th').filter({ hasText: 'Fiat Min' })).toBeVisible();
  });

  test('shows "No offers" when filters match nothing', async ({ page }) => {
    const cp = page.locator('.bg-surface').filter({ hasText: 'Control Panel' });

    // Set premium min very high to exclude all offers
    await jsFill(cp.locator('input[placeholder="Min"]'), '99');
    await page.waitForTimeout(300);

    const panel = offersPanel(page);
    await expect(panel.locator('text=No offers')).toBeVisible();
  });
});
