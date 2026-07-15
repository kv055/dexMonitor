import type { Page } from '@playwright/test';
import { test, expect, gotoAndWaitForData } from '../fixtures/base-fixture';

async function openTradingAccounts(page: Page) {
  await page.getByRole('button', { name: 'Trading Accounts', exact: true }).click();
  const panel = page.getByTestId('trading-accounts-panel');
  await expect(panel).toBeVisible();
  return panel;
}

test.describe('TradingAccounts', () => {
  test('shows the payment accounts desktop state', async ({ page }) => {
    await gotoAndWaitForData(page);
    const panel = await openTradingAccounts(page);
    const detailPane = panel.getByTestId('account-detail-pane').first();

    await expect(detailPane).toContainText('Revolut');
    await expect(panel).toHaveScreenshot('trading-accounts-payment-desktop.png');
  });

  test('switches subtabs, auto-selects, updates detail, and mounts communication settings', async ({ page }) => {
    await gotoAndWaitForData(page);
    const panel = await openTradingAccounts(page);
    const detailPane = panel.getByTestId('account-detail-pane').first();

    await panel.getByRole('button', { name: /^Trading/ }).click();
    await expect(detailPane).toContainText('Bisq');
    await expect(panel.getByText('0 TOTP', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('0 Passkeys', { exact: true })).toHaveCount(0);

    await panel.getByTestId('account-summary-card-33').click();
    await expect(detailPane).toContainText('Kraken');
    await expect(detailPane).toContainText('BTC 0.245');
    await expect(panel).toHaveScreenshot('trading-accounts-trading-desktop.png');

    await panel.getByRole('button', { name: /^Communication/ }).click();
    await expect(panel.getByText('Telegram Bot', { exact: true })).toBeVisible();
  });

  test('keeps provider names visible on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoAndWaitForData(page);
    const panel = await openTradingAccounts(page);

    await expect(panel.getByTestId('account-summary-card-11')).toContainText('Revolut');
    await expect(panel.getByText('Payments', { exact: true })).toBeVisible();
    await expect(panel).toHaveScreenshot('trading-accounts-mobile.png');
  });

  test('shows the payment account priority in its list item', async ({ page }) => {
    await gotoAndWaitForData(page);
    const panel = await openTradingAccounts(page);
    await expect(panel.getByTestId('account-summary-card-11').getByLabel('Priority 1')).toBeVisible();
  });
});
