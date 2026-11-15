import { test, expect, gotoAndWaitForData, controlPanel, openControlPanel, jsClick, jsFill } from '../fixtures/base-fixture';
import { MOCK_LIVE_OFFERS } from '../fixtures/mock-data';

async function selectMenuOption(
  page: import('@playwright/test').Page,
  trigger: import('@playwright/test').Locator,
  option: string,
) {
  await jsClick(trigger);
  await page.getByRole('menuitemradio', { name: option, exact: true }).click();
}

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
    await expect(label('Fiat')).toBeVisible();
    await expect(label('Premium')).toBeVisible();
    await expect(label('Range')).toBeVisible();
    await expect(label('Net profit EUR')).toBeVisible();
    // Live-only
    await expect(label('Reference source')).toBeVisible();
    await expect(label('Payment methods')).toBeVisible();
  });

  test('view mode toggle swaps live-only for past-only controls', async ({ page }) => {
    const cp = controlPanel(page);
    const label = (text: string) =>
      cp.locator('span.uppercase').filter({ hasText: new RegExp(`^${text}$`) });

    await jsClick(page.getByRole('button', { name: 'Past Offers', exact: true }));
    await expect(page.getByRole('heading', { name: 'Past Offers' })).toBeVisible();
    await expect(label('Timeframe')).toBeVisible();
    // Same Premium / Range controls as Live, with past-specific options.
    await expect(label('Premium')).toBeVisible();
    await expect(cp.getByTitle(/Raw is the quoted premium/)).toContainText('Net Full');
    await expect(label('Range')).toBeVisible();
    await expect(label('Net profit EUR')).toBeVisible();
    const payments = cp.getByTitle('Show all methods, linked methods, or selected linked methods');
    await expect(payments).toContainText('Linked methods');
    await expect(label('Payment methods')).toBeVisible();
    await expect(label('Reference source')).toHaveCount(0);
    await expect(label('Premium range')).toHaveCount(0);
    // Shared controls stay put
    await expect(label('Direction')).toBeVisible();
    await expect(label('Exchanges')).toBeVisible();

    await jsClick(page.getByRole('button', { name: 'Live Offers', exact: true }));
    await expect(label('Payment methods')).toBeVisible();
    await expect(label('Reference source')).toBeVisible();
    await expect(label('Premium')).toBeVisible();
    await expect(cp.getByTitle(/Raw is the quoted premium/)).toContainText('Net Full');
    await expect(label('Timeframe')).toHaveCount(0);
  });

  test('past offers support an inclusive custom date range', async ({ page }) => {
    const cp = controlPanel(page);
    await jsClick(page.getByRole('button', { name: 'Past Offers', exact: true }));

    const timeframe = cp.getByTitle('Show offers closed within a preset window or a custom date range');
    const initialCustomRequest = page.waitForRequest(request => {
      if (new URL(request.url()).pathname !== '/api/dashboard/analytics') return false;
      const body = request.postDataJSON() as Record<string, unknown>;
      return body.past_start_date === '2026-03-26'
        && body.past_end_date === '2026-04-01'
        && typeof body.timezone === 'string';
    });
    await selectMenuOption(page, timeframe, 'Custom date range');
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
    await selectMenuOption(page, timeframe, 'Past 24h');
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
    const bidPill = cp.getByRole('button', { name: 'Bid', exact: true });
    await jsClick(bidPill);
    await expect(bidPill).toHaveClass(/text-accent/);
  });

  test('fiat dropdown rows show live raw-premium offer counts', async ({ page }) => {
    const cp = controlPanel(page);
    const fiat = cp.getByTitle('Show live and past offers quoted in this currency');
    await jsClick(fiat);
    await expect(page.getByRole('menuitemradio', { name: 'EUR', exact: true })).toBeVisible();
    await expect(page.getByTestId('fiat-raw-premium-count-EUR')).toHaveText('10');
    await expect(page.getByTestId('fiat-raw-premium-count-USD')).toHaveText('4');
    await expect(page.getByTestId('fiat-raw-premium-count-AUD')).toHaveText('0');
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
    await selectMenuOption(page, fiat, 'USD');
    await Promise.all([liveRequest, pastRequest]);
    await expect(fiat).toContainText('USD');
    await expect(cp.getByText(/^BTC\/USD — Kraken$/)).toBeVisible();

    await jsClick(page.getByRole('button', { name: 'Past Offers', exact: true }));
    await expect(page.getByRole('heading', { name: 'Past Offers' })).toBeVisible();
    await expect(cp.getByTitle('Show live and past offers quoted in this currency')).toContainText('USD');
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

  test('payment scope dropdown shows linked methods and selection works', async ({ page }) => {
    const cp = controlPanel(page);
    const payments = cp.getByTitle('Show all methods, linked methods, or selected linked methods');
    await selectMenuOption(page, payments, 'Linked methods');
    const revolut = cp.getByRole('checkbox', { name: 'Revolut', exact: true });
    await expect(revolut).toBeVisible();
    await revolut.check();
    await expect(revolut).toBeChecked();
    await expect(payments).toContainText('1 linked method');
  });

  test('premium range sliders accept values', async ({ page }) => {
    const cp = controlPanel(page);
    await jsClick(cp.getByRole('button', { name: '%', exact: true }));
    const minSlider = cp.getByRole('slider', { name: 'Premium % minimum' });
    await expect(minSlider).toBeVisible();
    const maxSlider = cp.getByRole('slider', { name: 'Premium % maximum' });
    const max = Number(await maxSlider.getAttribute('max'));
    const nextMin = String(Math.min(300, max));

    await jsFill(minSlider, nextMin);
    await expect(minSlider).toHaveValue(nextMin);
    await expect(maxSlider).toBeVisible();
  });

  test('premium dropdown can include non premium offers', async ({ page }) => {
    const cp = controlPanel(page);
    const premiumDropdown = cp.getByTitle(/Raw is the quoted premium/);

    await expect(premiumDropdown).toContainText('Net Full');

    await selectMenuOption(page, premiumDropdown, 'Incl. non premium offers');
    await expect(premiumDropdown).toContainText('Incl. non premium offers');

    await selectMenuOption(page, premiumDropdown, 'Raw');
    await expect(premiumDropdown).toContainText('Raw');
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
    await expect(cp.getByRole('slider', { name: 'Premium % minimum' })).toHaveCount(0);
    await expect(cp.getByRole('button', { name: 'EUR', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(cp.locator('span.uppercase').filter({ hasText: /^Net profit EUR$/ })).toBeVisible();
    await expect(cp.getByTitle(/Raw is the quoted premium/)).toContainText('Net Full');
  });

  test('refresh button triggers API calls', async ({ page }) => {
    const cp = controlPanel(page);
    const offersRequest = page.waitForRequest(req => req.url().includes('/api/past_offers'));
    await cp.locator('button').filter({ hasText: '↻ Refresh' }).click();
    await offersRequest;
  });

  test('untouched live range follows the bounds when offers change', async ({ page }) => {
    const cp = controlPanel(page);
    let fullBook = false;
    // Start with a single premium offer (narrow range), then serve the full book.
    await page.route('**/api/live_offers?*', route =>
      route.fulfill({ json: fullBook ? MOCK_LIVE_OFFERS : [MOCK_LIVE_OFFERS[0]] }),
    );
    await page.reload();
    await openControlPanel(page);
    await selectMenuOption(page, cp.getByTitle('Show all methods, linked methods, or selected linked methods'), 'All methods');
    await jsClick(cp.getByRole('group', { name: 'Range unit' }).getByRole('button', { name: '%', exact: true }));
    const minSlider = cp.getByRole('slider', { name: 'Premium % minimum' });
    const maxSlider = cp.getByRole('slider', { name: 'Premium % maximum' });
    await expect(minSlider).toBeVisible();
    const narrowMin = await minSlider.getAttribute('min');

    fullBook = true;
    await selectMenuOption(page, cp.getByTitle('Show live and past offers quoted in this currency'), 'USD');
    await expect.poll(() => minSlider.getAttribute('min')).not.toBe(narrowMin);
    // The untouched slider spans the new full range instead of sticking to the old one.
    await expect.poll(async () => (await minSlider.inputValue()) === (await minSlider.getAttribute('min'))).toBe(true);
    await expect.poll(async () => (await maxSlider.inputValue()) === (await maxSlider.getAttribute('max'))).toBe(true);
  });
});
