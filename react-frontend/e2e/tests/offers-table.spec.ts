import { test, expect, gotoAndWaitForData, offersPanel, controlPanel, openControlPanel, jsClick } from '../fixtures/base-fixture';

const rowCells = (row: import('@playwright/test').Locator) => row.locator(':scope > span > span');

test.describe('Live offers list', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWaitForData(page);
  });

  test('renders the current grid headers and offer rows', async ({ page }) => {
    const panel = offersPanel(page);
    for (const header of ['Offer', 'Dir', 'Premium', 'Payment method', 'First seen', 'Reputation', 'Stake', 'Age', 'Size', 'Net profit']) {
      await expect(panel.getByText(header, { exact: true }).first()).toBeVisible();
    }
    expect(await panel.getByTestId('live-offers-row').count()).toBeGreaterThan(0);
  });

  test('renders side and premium styling', async ({ page }) => {
    const rows = offersPanel(page).getByTestId('live-offers-row');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < Math.min(count, 5); index += 1) {
      const cells = rowCells(rows.nth(index));
      const side = cells.nth(1);
      const sideText = (await side.textContent())?.trim();
      await expect(side).toHaveClass(sideText === 'Bid' ? /text-green/ : /text-red/);
      await expect(cells.nth(2)).toHaveClass(/text-(green|accent|red)/);
    }
  });

  test('opens and closes the live offer breakdown', async ({ page }) => {
    await offersPanel(page).getByTestId('live-offers-row').first().click();
    const detail = page.getByTestId('live-offer-detail');
    await expect(detail).toBeVisible();
    await expect(detail.getByRole('region', { name: 'Decision summary' })).toBeVisible();
    await expect(detail.getByRole('region', { name: 'Trade economics' })).toBeVisible();
    await expect(detail.getByText('Total costs', { exact: true })).toBeVisible();
    await expect(detail.getByText('Gross DEX premium', { exact: true })).toBeVisible();
    await expect(detail.getByText('Net profit', { exact: true }).first()).toBeVisible();
    await expect(detail.getByText(/^Capital allocation/)).toBeVisible();

    await jsClick(page.getByRole('button', { name: 'Close live offer details' }));
    await expect(page.getByTestId('live-offer-detail')).not.toBeVisible();
    await expect(offersPanel(page).getByTestId('live-offers-row').first()).toBeVisible();
  });

  test('supports keyboard selection', async ({ page }) => {
    const row = offersPanel(page).getByTestId('live-offers-row').first();
    await row.focus();
    await row.press('Enter');
    await expect(page.getByTestId('live-offer-detail')).toBeVisible();
  });

  test('stacks supporting economics below the cost table on narrow screens', async ({ page }) => {
    await offersPanel(page).getByTestId('live-offers-row').first().click();
    const detail = page.getByTestId('live-offer-detail');
    const economics = detail.getByRole('region', { name: 'Trade economics' });
    const supporting = detail.getByRole('complementary', { name: 'Capital requirements' });

    const [wideEconomics, wideSupporting] = await Promise.all([economics.boundingBox(), supporting.boundingBox()]);
    expect(wideEconomics).not.toBeNull();
    expect(wideSupporting).not.toBeNull();
    expect(wideSupporting!.x).toBeGreaterThan(wideEconomics!.x + wideEconomics!.width - 2);

    await page.setViewportSize({ width: 800, height: 1200 });
    const [narrowEconomics, narrowSupporting] = await Promise.all([economics.boundingBox(), supporting.boundingBox()]);
    expect(narrowEconomics).not.toBeNull();
    expect(narrowSupporting).not.toBeNull();
    expect(narrowSupporting!.y).toBeGreaterThan(narrowEconomics!.y + narrowEconomics!.height - 2);
  });

  test('shows the empty state when filters exclude every offer', async ({ page }) => {
    await openControlPanel(page);
    await jsClick(controlPanel(page).getByRole('button', { name: 'None', exact: true }));
    await expect(offersPanel(page).getByText('No live offers for the selected filters.')).toBeVisible();
  });
});
