import { test, expect, gotoAndWaitForData, jsClick } from '../fixtures/base-fixture';
import { MOCK_PAST_ORDER_STATS } from '../fixtures/mock-data';

test('past-offer headers align with their left-aligned values', async ({ page }) => {
  const order = {
    id: 9001,
    exchange: 'bisq',
    offer_id: 'alignment-fixture',
    payment_methods: ['SEPA'],
    direction: 'sell',
    status: {
      is_live: false,
      first_seen: '2026-07-20T10:00:00Z',
      last_seen: '2026-07-20T12:15:00Z',
      duration: { hours: 2, minutes: 15, display: '2h 15m' },
    },
    pricing: {
      price_type: 'fixed',
      fiat_currency: 'EUR',
      avg_offer_price: 62000,
      avg_ref_price: 60000,
      avg_premium_percent: 3.33,
    },
    summary: {
      net_profit_btc: 0.0005,
      net_profit_fiat: 30,
      trade_size_btc: 0.01,
      trade_size_fiat: 600,
      net_percent: 5,
    },
  };

  await page.route('**/api/dashboard/analytics', route => route.fulfill({
    json: {
      past_order_stats: MOCK_PAST_ORDER_STATS,
      past_order_stats_all: MOCK_PAST_ORDER_STATS,
      past_order_stats_net_capped: MOCK_PAST_ORDER_STATS,
      past_order_stats_all_net_capped: MOCK_PAST_ORDER_STATS,
      past_profitable_orders_compact: [order],
      past_profitable_orders: [],
    },
  }));

  await gotoAndWaitForData(page);
  await jsClick(page.getByRole('button', { name: 'Past Offers', exact: true }));

  const header = page.getByTestId('past-offers-header');
  const row = page.getByTestId('past-offers-row').first();
  await expect(header).toBeVisible();
  await expect(row).toBeVisible();

  const rowCells = row.locator(':scope > *');
  const columns = [
    { title: 'first seen', rowIndex: 4 },
    { title: 'last seen', rowIndex: 5 },
    { title: 'duration', rowIndex: 6 },
    { title: 'size', rowIndex: 7 },
    { title: 'net profit', rowIndex: 8 },
  ];
  for (const { title, rowIndex } of columns) {
    const sortButton = header.locator(`button[title="Sort by ${title}"]:visible`);
    const [headerBox, rowBox] = await Promise.all([
      sortButton.boundingBox(),
	  rowCells.nth(rowIndex).boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(rowBox).not.toBeNull();
	expect(Math.abs(headerBox!.x - rowBox!.x)).toBeLessThan(1);
  }

  await expect(header.locator('button[title="Sort by premium"]:visible')).toBeVisible();
  await expect(rowCells.nth(2)).toHaveText('3.3%');

  for (const title of ['size', 'net profit']) {
    const sortButton = header.locator(`button[title="Sort by ${title}"]:visible`);
    const unitToggle = sortButton.locator('xpath=following-sibling::*[1]');
    const [sortBox, toggleBox] = await Promise.all([
      sortButton.boundingBox(),
      unitToggle.boundingBox(),
    ]);
    expect(sortBox).not.toBeNull();
    expect(toggleBox).not.toBeNull();
    expect(toggleBox!.x - (sortBox!.x + sortBox!.width)).toBeLessThanOrEqual(12);
  }

  const firstSeenSorter = header.locator('button[title="Sort by first seen"]:visible');
  const lastSeenSorter = header.locator('button[title="Sort by last seen"]:visible');
  await jsClick(firstSeenSorter);
  await expect(firstSeenSorter).toHaveAttribute('aria-sort', 'descending');
  await jsClick(firstSeenSorter);
  await expect(firstSeenSorter).toHaveAttribute('aria-sort', 'ascending');
  await jsClick(firstSeenSorter);
  await expect(firstSeenSorter).not.toHaveAttribute('aria-sort');
  await expect(lastSeenSorter).not.toHaveAttribute('aria-sort');

  const chartCheckbox = row.locator('input[type="checkbox"]');
  await expect(chartCheckbox).not.toBeChecked();
  await jsClick(row);
  const closeDetails = page.getByRole('button', { name: 'Close past offer details' });
  await expect(closeDetails).toBeVisible();
  await expect(header).toHaveCount(0);
  await jsClick(closeDetails);
  await expect(header).toBeVisible();
  await expect(row.locator('input[type="checkbox"]')).not.toBeChecked();

  await jsClick(row.locator('input[type="checkbox"]'));
  await jsClick(row);
  await jsClick(page.getByRole('button', { name: 'Close past offer details' }));
  await expect(row.locator('input[type="checkbox"]')).toBeChecked();
});

test('Net Min uses the precomputed minimum-volume scenario', async ({ page }) => {
  const scenario = (tradeSizeBtc: number, tradeSizeFiat: number, profitBtc: number, profitFiat: number, netPercent: number) => ({
    trade_size_btc: tradeSizeBtc,
    trade_size_fiat: tradeSizeFiat,
    route: { cex: 'kraken', settlement: 'onchain' },
    premium: { avg_trade_cost_percent: 1, avg_net_percent: netPercent },
    profit: { avg_btc: profitBtc, avg_fiat: profitFiat },
    costs: {
      cex_taker: {}, withdrawal: {}, dex_fee: {}, network: {},
      hedge: {}, total: {},
    },
  });
  const order = {
    id: 9002,
    exchange: 'bisq',
    offer_id: 'minimum-fixture',
    payment_methods: ['SEPA'],
    direction: 'sell',
    status: {
      is_live: false,
      first_seen: '2026-07-20T10:00:00Z',
      last_seen: '2026-07-20T12:15:00Z',
      duration: { hours: 2, minutes: 15, display: '2h 15m' },
    },
    pricing: {
      price_type: 'fixed', fiat_currency: 'EUR',
      avg_offer_price: 62000, avg_ref_price: 60000, avg_premium_percent: 3.33,
    },
    summary: {
      net_profit_btc: 0.001, net_profit_fiat: 60,
      trade_size_btc: 1, trade_size_fiat: 60000, net_percent: 3,
    },
    observation_count: 37,
    analysis: {
      full_volume: scenario(1, 60000, 0.001, 60, 3),
      min_volume: { ...scenario(0.02, 1200, 0.00001, 0.6, 0.05), cost_policy: 'historical_min_volume' },
    },
    offer: {
      price: 62000,
      avg_ref_price: 60000,
      btc_min: 0.02,
      btc_max: 1,
      fiat_min: 1200,
      fiat_max: 60000,
      avg_btc_amount: 0.4,
    },
  };

  await page.route('**/api/dashboard/analytics', route => route.fulfill({
    json: {
      past_order_stats: MOCK_PAST_ORDER_STATS,
      past_order_stats_all: MOCK_PAST_ORDER_STATS,
      past_order_stats_net_min: MOCK_PAST_ORDER_STATS,
      past_order_stats_all_net_min: MOCK_PAST_ORDER_STATS,
      past_profitable_orders_compact: [],
      past_profitable_orders: [order],
    },
  }));

  await gotoAndWaitForData(page);
  await jsClick(page.getByRole('button', { name: 'Past Offers', exact: true }));
  await page.getByRole('combobox', { name: 'Premium mode' }).selectOption('net_min');

  const row = page.getByTestId('past-offers-row').first();
  await expect(row).toContainText('0,0200 BTC');
  await expect(row).toContainText('0,60 €');

  await jsClick(row);
  const detail = page.getByTestId('past-offer-detail');
  await expect(detail).toContainText('37 snapshots');
  await expect(detail).toContainText('Minimum-size estimate');
  await expect(detail).toContainText('1.200,00 € – 60.000,00 €');
  await jsClick(detail.getByRole('button', { name: 'BTC', exact: true }).first());
  await expect(detail).toContainText('0,0200 BTC – 1,0000 BTC');
  await expect(detail.getByRole('button', { name: 'BTC', exact: true })).toHaveAttribute('aria-pressed', 'true');
});
