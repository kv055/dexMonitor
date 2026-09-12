import { test, expect, gotoAndWaitForData, offersPanel, controlPanel, openControlPanel, closeControlPanel, jsClick } from '../fixtures/base-fixture';

const rowCells = (row: import('@playwright/test').Locator) => row.locator(':scope > span > span');

test.describe('Live offers list', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWaitForData(page, 'all');
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
    await expect(detail.getByRole('tablist', { name: 'Offer breakdown sections' })).toBeVisible();
    await expect(detail.getByRole('tab', { name: 'Offer' })).toHaveAttribute('aria-selected', 'true');
    await expect(detail.getByRole('tabpanel', { name: 'Offer' })).toBeVisible();
    await expect(detail.getByText(/^(Bid|Ask) side$/)).toBeVisible();

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

  test('shows one offer breakdown panel per selected tab', async ({ page }) => {
    await offersPanel(page).getByTestId('live-offers-row').first().click();
    const detail = page.getByTestId('live-offer-detail');

    await expect(detail.getByRole('tab', { name: 'Offer' })).toHaveAttribute('aria-selected', 'true');
    await expect(detail.getByRole('tabpanel', { name: 'Offer' })).toBeVisible();
    await expect(detail.getByText(/^(Bid|Ask) side$/)).toBeVisible();
    await expect(detail.getByText('Total costs', { exact: true })).toHaveCount(0);
    await expect(detail.getByText('Spot notional (CEX buy)')).toHaveCount(0);
    await expect(detail.getByText('Fiat collateral (CEX)')).toHaveCount(0);

    await jsClick(detail.getByRole('tab', { name: 'Trade economics' }));
    await expect(detail.getByRole('tabpanel', { name: 'Trade economics' })).toBeVisible();
    await expect(detail.getByText('Total costs', { exact: true })).toBeVisible();
    await expect(detail.getByText('Gross DEX premium', { exact: true })).toBeVisible();
    await expect(detail.getByText('Net profit', { exact: true }).first()).toBeVisible();
    await expect(detail.getByText(/^(Bid|Ask) side$/)).toHaveCount(0);

    await jsClick(detail.getByRole('tab', { name: 'Capital allocation' }));
    await expect(detail.getByRole('tabpanel', { name: 'Capital allocation' })).toBeVisible();
    // Mock CEX hedge is unavailable, so live detail defaults to hedgeless capital labels.
    await expect(detail.getByText('Fiat collateral (CEX)')).toBeVisible();
    await expect(detail.getByText('BTC liquidity pool')).toBeVisible();
    await expect(detail.getByText('Total costs', { exact: true })).toHaveCount(0);

    await jsClick(detail.getByRole('tab', { name: 'Risk' }));
    await expect(detail.getByRole('tabpanel', { name: 'Risk' })).toBeVisible();
    await expect(detail.getByText('Reputation')).toBeVisible();
    await expect(detail.getByText('Maker stake')).toBeVisible();
    await expect(detail.getByText('Security deposit')).toBeVisible();
    await expect(detail.getByText('Rating inputs')).toBeVisible();
    await expect(detail.getByText('Venue signals')).toBeVisible();
  });

  test('shows Bisq 2 bonded reputation including unstaked makers', async ({ page }) => {
    await openControlPanel(page);
    await jsClick(controlPanel(page).getByRole('button', { name: 'None', exact: true }));
    await jsClick(controlPanel(page).getByRole('button', { name: /Bisq v2/ }));
    await closeControlPanel(page);

    const panel = offersPanel(page);
    await expect(panel.getByTitle(/72\/100 · Bonded reputation score/)).toBeVisible();
    await expect(panel.getByText('reputation', { exact: true })).toBeVisible();
    await expect(panel.getByText('unstaked', { exact: true })).toBeVisible();
    await expect(panel.getByText('0★')).toBeVisible();
  });

  test('shows the empty state when filters exclude every offer', async ({ page }) => {
    await openControlPanel(page);
    await jsClick(controlPanel(page).getByRole('button', { name: 'None', exact: true }));
    await expect(offersPanel(page).getByText('No live offers for the selected filters.')).toBeVisible();
  });
});
