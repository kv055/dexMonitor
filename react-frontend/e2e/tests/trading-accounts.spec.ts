import type { Page } from '@playwright/test';
import { test, expect, gotoAndWaitForData } from '../fixtures/base-fixture';

async function openTradingAccounts(page: Page) {
  await page.getByRole('button', { name: 'Trading Accounts', exact: true }).click();
  const panel = page.getByTestId('trading-accounts-panel');
  await expect(panel).toBeVisible();
  return panel;
}

async function openBisqPaymentAccountCreator(page: Page) {
  const panel = await openTradingAccounts(page);
  await panel.getByRole('button', { name: /^Trading/ }).click();
  const detail = panel.getByTestId('account-detail-pane').filter({ visible: true });
  await expect(detail).toContainText('Bisq');
  await detail.getByTestId('account-detail-tab-methods').click();
  await detail.getByRole('button', { name: /Saved payment methods/ }).click();
  await expect(detail.getByLabel('Bisq 1 payment method')).toBeVisible();
  return detail;
}

test.describe('TradingAccounts', () => {
  test('shows the payment accounts desktop state', async ({ page }) => {
    await gotoAndWaitForData(page);
    const panel = await openTradingAccounts(page);
    const detailPane = panel.getByTestId('account-detail-pane').filter({ visible: true });

    await expect(detailPane).toContainText('Revolut');
    await expect(panel).toHaveScreenshot('trading-accounts-payment-desktop.png');
  });

  test('switches subtabs, auto-selects, updates detail, and mounts communication settings', async ({ page }) => {
    await gotoAndWaitForData(page);
    const panel = await openTradingAccounts(page);
    const detailPane = panel.getByTestId('account-detail-pane').filter({ visible: true });

    await panel.getByRole('button', { name: /^Trading/ }).click();
    await expect(detailPane).toContainText('Bisq');
    await expect(panel.getByText('0 TOTP', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('0 Passkeys', { exact: true })).toHaveCount(0);

    await panel.getByTestId('account-summary-card-33').click();
    await expect(detailPane).toContainText('Kraken');
    await expect(detailPane.getByRole('switch', { name: /Activate Kraken/ })).toBeVisible();
    await expect(detailPane).toContainText('BTC 0.245');
    await expect(panel).toHaveScreenshot('trading-accounts-trading-desktop.png');

    await panel.getByRole('button', { name: /^Communication/ }).click();
    await expect(panel.getByRole('heading', { name: 'Telegram bot', exact: true })).toBeVisible();
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

  test('shows Unlinked instead of priority when a payment account has no catalog link', async ({ page }) => {
    await gotoAndWaitForData(page);
    const panel = await openTradingAccounts(page);
    const card = panel.getByTestId('account-summary-card-12');
    await expect(card.getByText('Unlinked', { exact: true })).toBeVisible();
    await expect(card.getByLabel(/Priority/)).toHaveCount(0);
    await expect(card.getByText(/Created|Updated/)).toHaveCount(0);

    await card.click();
    const detail = panel.getByTestId('account-detail-pane').filter({ visible: true });
    await expect(detail.getByText('Unlinked', { exact: true })).toBeVisible();
    await expect(detail.getByText('Inactive', { exact: true })).toBeVisible();
    await expect(detail.getByRole('switch', { name: /Activate WISE/ })).toBeDisabled();
  });

  test('renders supported and unavailable Bisq methods and mutates only after confirmation', async ({ page }) => {
    let createRequests = 0;
    let createdPayload: { payment_method_id?: string; fields?: Record<string, string> } | null = null;
    page.on('request', request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/mm-controller/bisq/payment-accounts') {
        createRequests += 1;
        createdPayload = request.postDataJSON() as typeof createdPayload;
      }
    });

    await gotoAndWaitForData(page);
    const panel = await openBisqPaymentAccountCreator(page);
    const methodSelect = panel.getByLabel('Bisq 1 payment method');
    await expect(methodSelect.locator('option', { hasText: 'Revolut' })).toBeEnabled();
    await expect(methodSelect.locator('option', { hasText: 'Cash App' })).toHaveAttribute('disabled', '');

    await methodSelect.selectOption('REVOLUT');
    await expect(panel.getByLabel('User Name')).toHaveValue('$desk');
    await expect(panel.getByLabel('Account Name')).toHaveValue('Revolut Revolut');
    await panel.getByLabel('Trade Currencies').fill('EUR');
    await panel.getByLabel('Selected Trade Currency').fill('EUR');
    expect(createRequests).toBe(0);

    await panel.getByRole('button', { name: 'Review payment account' }).click();
    await expect(panel.getByText('Review before creating in Bisq')).toBeVisible();
    expect(createRequests).toBe(0);

    await panel.getByRole('button', { name: 'Create and link payment account' }).click();
    await expect.poll(() => createRequests).toBe(1);
    await expect(panel.getByText('Revolut Revolut', { exact: true })).toBeVisible();
    expect(createdPayload?.payment_method_id).toBe('REVOLUT');
    expect(createdPayload?.fields?.userName).toBe('$desk');
  });

  test('keeps Bisq form values and review visible after a daemon validation error', async ({ page }) => {
    await page.route('**/api/mm-controller/bisq/payment-accounts', async route => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ status: 502, json: { error: 'Bisq rejected the username' } });
        return;
      }
      await route.fallback();
    });

    await gotoAndWaitForData(page);
    const panel = await openBisqPaymentAccountCreator(page);
    await panel.getByLabel('Bisq 1 payment method').selectOption('REVOLUT');
    await panel.getByLabel('User Name').fill('alice-edited');
    await panel.getByRole('button', { name: 'Review payment account' }).click();
    await panel.getByRole('button', { name: 'Create and link payment account' }).click();

    await expect(panel.getByText('Bisq rejected the username')).toBeVisible();
    await expect(panel.getByText('Review before creating in Bisq')).toBeVisible();
    await panel.getByRole('button', { name: 'Back to edit' }).click();
    await expect(panel.getByLabel('User Name')).toHaveValue('alice-edited');
  });

});
