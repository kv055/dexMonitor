import { test, expect, gotoAndWaitForData, openSettings, settingsOverlay } from '../fixtures/base-fixture';

test.describe('CEX permissions', () => {
  test('uses central policy, applies fail-closed locks, and renders separate controls', async ({ page }) => {
    let liveURL = '';
    page.on('request', request => {
      if (request.url().includes('/api/live_offers?')) liveURL = request.url();
    });
    await gotoAndWaitForData(page);

    const query = new URL(liveURL).searchParams;
    expect(query.has('exclude_spot_cexes')).toBe(false);
    expect(query.has('exclude_hedge_cexes')).toBe(false);

    await openSettings(page);
    const panel = settingsOverlay(page);
    await expect(panel.getByText('Kraken', { exact: true })).toBeVisible();
    await expect(panel.getByText('Coinbase', { exact: true })).toBeVisible();
    await expect(panel.getByText('Bitstamp', { exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Unsupported' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Disable CEX' }).first()).toBeVisible();

    await panel.getByRole('button', { name: /Kraken/ }).click();
    await expect(panel.getByText('Required API-key permissions were not granted.')).toBeVisible();

    await panel.getByRole('button', { name: /Coinbase/ }).click();
    await expect(panel.getByText('No active API keys are configured.').first()).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Locked' })).toHaveCount(3);

    await panel.getByRole('button', { name: 'Disable CEX' }).first().click();
    await expect(panel.getByRole('button', { name: 'Enable CEX' }).first()).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('dex-excluded-spot-cexes'))).toBeNull();
  });
});
