import { test, expect, gotoAndWaitForData, controlPanel, openControlPanel, jsClick, jsFill } from '../fixtures/base-fixture';

test.describe('ControlPanel (Insights filter sidebar)', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndWaitForData(page);
    await openControlPanel(page);
  });

  test('renders shared and live-only filter section labels', async ({ page }) => {
    const cp = controlPanel(page);
    const label = (text: string) =>
      cp.locator('span.uppercase').filter({ hasText: new RegExp(`^${text}$`) });

    // BTC reference price readout sits at the top of the panel
    await expect(cp.getByText(/^BTC\/EUR — Kraken$/)).toBeVisible();
    await expect(cp.getByText(/^[\d.]+,\d{2}\s*€$/)).toBeVisible();
    // Shared between Live and Past mode
    await expect(label('Direction')).toBeVisible();
    await expect(label('Exchanges')).toBeVisible();
    // Live-only
    await expect(label('Payment')).toBeVisible();
    await expect(label('Premium')).toBeVisible();
    await expect(label('Range')).toBeVisible();
    await expect(label('Net profit EUR')).toBeVisible();
  });

  test('view mode toggle swaps live-only for past-only controls', async ({ page }) => {
    const cp = controlPanel(page);
    const label = (text: string) =>
      cp.locator('span.uppercase').filter({ hasText: new RegExp(`^${text}$`) });

    await jsClick(page.getByRole('button', { name: 'Past Offers', exact: true }));
    await expect(page.getByRole('heading', { name: 'Past Offers' })).toBeVisible();
    await expect(label('Timeframe')).toBeVisible();
    await expect(label('Premium mode')).toBeVisible();
    await expect(cp.getByRole('combobox', { name: 'Premium mode' })).toHaveValue('net_full');
    const payments = cp.getByRole('combobox', { name: 'Payments' });
    await expect(payments).toHaveValue('settings');
    await payments.selectOption('all');
    await expect(payments).toHaveValue('all');
    await expect(label('Payment')).toHaveCount(0);
    await expect(label('Premium range')).toHaveCount(0);
    // Shared controls stay put
    await expect(label('Direction')).toBeVisible();
    await expect(label('Exchanges')).toBeVisible();

    await jsClick(page.getByRole('button', { name: 'Live Offers', exact: true }));
    await expect(label('Payment')).toBeVisible();
    await expect(label('Timeframe')).toHaveCount(0);
  });

  test('past offers support an inclusive custom date range', async ({ page }) => {
    const cp = controlPanel(page);
    await jsClick(page.getByRole('button', { name: 'Past Offers', exact: true }));

    const timeframe = cp.getByRole('combobox', { name: 'Timeframe' });
    const initialCustomRequest = page.waitForRequest(request => {
      if (new URL(request.url()).pathname !== '/api/dashboard/analytics') return false;
      const body = request.postDataJSON() as Record<string, unknown>;
      return body.past_start_date === '2026-03-26'
        && body.past_end_date === '2026-04-01'
        && typeof body.timezone === 'string';
    });
    await timeframe.selectOption('custom');
    const startDate = cp.getByRole('textbox', { name: 'Start date' });
    const endDate = cp.getByRole('textbox', { name: 'End date' });
    await expect(startDate).toHaveValue('2026-03-26');
    await expect(endDate).toHaveValue('2026-04-01');
    await initialCustomRequest;

    const changedCustomRequest = page.waitForRequest(request => {
      if (new URL(request.url()).pathname !== '/api/dashboard/analytics') return false;
      const body = request.postDataJSON() as Record<string, unknown>;
      return body.past_start_date === '2026-03-30'
        && body.past_end_date === '2026-03-31';
    });
    await startDate.fill('2026-03-30');
    await endDate.fill('2026-03-31');
    await expect(startDate).toHaveValue('2026-03-30');
    await expect(endDate).toHaveValue('2026-03-31');
    await changedCustomRequest;

    const presetRequest = page.waitForRequest(request => {
      if (new URL(request.url()).pathname !== '/api/dashboard/analytics') return false;
      const body = request.postDataJSON() as Record<string, unknown>;
      return !('past_start_date' in body) && !('past_end_date' in body) && !('timezone' in body);
    });
    await timeframe.selectOption('24h');
    await presetRequest;
  });

  test('live offers use the full-panel detail view', async ({ page }) => {
    let row = page.getByTestId('live-offers-row').first();
    await expect(row).toBeVisible();
    await expect(row.locator('input[type="checkbox"]')).not.toBeChecked();

    await jsClick(row);
    const detail = page.getByTestId('live-offer-detail');
    await expect(detail).toBeVisible();
    await expect(page.getByRole('region', { name: 'Trade tracing' })).toBeVisible();
    await expect(detail.getByText('Observed', { exact: true })).toHaveCount(0);
    await expect(detail.getByText('History', { exact: true })).toHaveCount(0);

    const close = page.getByRole('button', { name: 'Close live offer details' });
    await jsClick(close);
    row = page.getByTestId('live-offers-row').first();
    await expect(row).toBeVisible();
    await expect(row.locator('input[type="checkbox"]')).not.toBeChecked();

    await jsClick(row.locator('input[type="checkbox"]'));
    await jsClick(row);
    await jsClick(page.getByRole('button', { name: 'Close live offer details' }));
    await expect(page.getByTestId('live-offers-row').first().locator('input[type="checkbox"]')).toBeChecked();
  });

  test('direction pills select a side', async ({ page }) => {
    const cp = controlPanel(page);
    const buyPill = cp.getByRole('button', { name: 'Buy', exact: true });
    await jsClick(buyPill);
    await expect(buyPill).toHaveClass(/text-accent/);
  });

  test('fiat switching reloads live and historical offers with the selected currency', async ({ page }) => {
    const cp = controlPanel(page);
    const fiat = cp.getByTitle('Show live and past offers quoted in this currency');
    const liveRequest = page.waitForRequest(req => {
      const url = new URL(req.url());
      return url.pathname === '/api/live_offers' && url.searchParams.get('fiat') === 'USD';
    });
    const pastRequest = page.waitForRequest(req => {
      const url = new URL(req.url());
      return url.pathname === '/api/past_offers' && url.searchParams.get('fiat') === 'USD';
    });
    await fiat.selectOption('USD');
    await Promise.all([liveRequest, pastRequest]);
    await expect(fiat).toHaveValue('USD');
    await expect(cp.getByText(/^BTC\/USD — Kraken$/)).toBeVisible();

    await jsClick(page.getByRole('button', { name: 'Past Offers', exact: true }));
    await expect(page.getByRole('heading', { name: 'Past Offers' })).toBeVisible();
    await expect(cp.getByTitle('Show live and past offers quoted in this currency')).toHaveValue('USD');
  });

  test('exchange pills toggle exchanges on and off', async ({ page }) => {
    const cp = controlPanel(page);
    const bisqPill = cp.getByRole('button', { name: /Bisq v1/ });
    await expect(bisqPill).toBeVisible();

    await jsClick(bisqPill);
    await expect(bisqPill).toHaveClass(/line-through/);

    await jsClick(cp.getByRole('button', { name: 'All', exact: true }));
    await expect(bisqPill).not.toHaveClass(/line-through/);
  });

  test('payment dropdown shows options and selection works', async ({ page }) => {
    const cp = controlPanel(page);
    await jsClick(cp.locator('button').filter({ hasText: 'All Payments' }));

    // Wait for dropdown menu to render and choose the grouped payment option.
    const sepaOption = page.locator('.absolute button').filter({ hasText: 'SEPA Instant' }).first();
    await sepaOption.waitFor({ state: 'visible' });
    await expect(page.locator('.absolute button').filter({ hasText: 'Revolut' }).first()).toBeVisible();

    await sepaOption.click();
    await expect(cp.locator('button').filter({ hasText: 'SEPA Instant' })).toBeVisible();
  });

  test('premium range sliders accept values', async ({ page }) => {
    const cp = controlPanel(page);
    await jsClick(cp.getByRole('button', { name: '%', exact: true }));
    const minSlider = cp.getByRole('slider', { name: 'Premium % minimum' });
    const maxSlider = cp.getByRole('slider', { name: 'Premium % maximum' });
    const max = Number(await maxSlider.getAttribute('max'));
    const nextMin = String(Math.min(300, max));

    await jsFill(minSlider, nextMin);
    await expect(minSlider).toHaveValue(nextMin);
    await expect(maxSlider).toBeVisible();
  });

  test('premium dropdown can include non premium offers', async ({ page }) => {
    const cp = controlPanel(page);
    const premiumDropdown = cp.locator('button').filter({ hasText: 'Net Premium Full' });

    await expect(premiumDropdown).toBeVisible();

    await jsClick(premiumDropdown);
    await page.locator('.absolute button').filter({ hasText: 'Incl. non premium offers' }).click();
    await expect(cp.locator('button').filter({ hasText: 'Incl. non premium offers' })).toBeVisible();

    await jsClick(cp.locator('button').filter({ hasText: 'Incl. non premium offers' }));
    await page.locator('.absolute button').filter({ hasText: 'Raw Premium' }).click();
    await expect(cp.locator('button').filter({ hasText: 'Raw Premium' })).toBeVisible();
  });

  test('reset button restores default filters', async ({ page }) => {
    const cp = controlPanel(page);

    // Disable an exchange and change the premium range.
    await jsClick(cp.getByRole('button', { name: /Bisq v1/ }));
    await jsClick(cp.getByRole('button', { name: '%', exact: true }));
    const minSlider = cp.getByRole('slider', { name: 'Premium % minimum' });
    const initialMin = await minSlider.inputValue();
    const max = Number(await minSlider.getAttribute('max'));
    await jsFill(minSlider, String(Math.min(Number(initialMin) + 50, max)));

    await cp.locator('button').filter({ hasText: '↺ Reset filters' }).click();

    await expect(cp.getByRole('button', { name: /Bisq v1/ })).not.toHaveClass(/line-through/);
    await expect(minSlider).toHaveValue(initialMin);
    await expect(cp.locator('button').filter({ hasText: 'Net Premium Full' })).toBeVisible();
  });

  test('refresh button triggers API calls', async ({ page }) => {
    const cp = controlPanel(page);
    const offersRequest = page.waitForRequest(req => req.url().includes('/api/past_offers'));
    await cp.locator('button').filter({ hasText: '↻ Refresh' }).click();
    await offersRequest;
  });
});
