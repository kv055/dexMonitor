import { test, expect, gotoAndWaitForData, openSettings, settingsOverlay } from '../fixtures/base-fixture';

test.describe('CEX permissions', () => {
  test('migrates preferences, applies capability locks, and renders separate controls', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('dex-excluded-cexes', JSON.stringify(['binance']));
      localStorage.removeItem('dex-excluded-spot-cexes');
      localStorage.removeItem('dex-excluded-hedge-cexes');
    });

    let liveURL = '';
    page.on('request', request => {
      if (request.url().includes('/api/live_offers?')) liveURL = request.url();
    });
    await gotoAndWaitForData(page);

    const query = new URL(liveURL).searchParams;
    expect(query.get('exclude_spot_cexes')?.split(',').sort()).toEqual(['binance', 'bitstamp', 'coinbase']);
    expect(query.get('exclude_hedge_cexes')?.split(',').sort()).toEqual(['binance', 'bitstamp', 'coinbase', 'kraken']);

    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dex-excluded-spot-cexes') ?? '[]'))).toEqual(['binance']);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dex-excluded-hedge-cexes') ?? '[]'))).toEqual(['binance']);

    await openSettings(page);
    const panel = settingsOverlay(page);
    await expect(panel.getByText('Kraken', { exact: true })).toBeVisible();
    await expect(panel.getByText('Coinbase', { exact: true })).toBeVisible();
    await expect(panel.getByText('Bitstamp', { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Disable CEX' })).toBeVisible();

    await panel.getByRole('button', { name: /Kraken/ }).click();
    await expect(panel.getByText('Missing Permissions: hedge_positions')).toBeVisible();

    await panel.getByRole('button', { name: /Coinbase/ }).click();
    await expect(panel.getByText('Missing Permissions: fetch_deposit_address, spot_trading, read_balances, withdraw').first()).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Locked' })).toHaveCount(4);
  });
});
