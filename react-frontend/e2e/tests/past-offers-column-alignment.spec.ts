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
    { title: 'first seen', rowIndex: 3 },
    { title: 'last seen', rowIndex: 4 },
    { title: 'duration', rowIndex: 5 },
    { title: 'size', rowIndex: 6 },
    { title: 'net profit', rowIndex: 7 },
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
    analysis: {
      full_volume: scenario(1, 60000, 0.001, 60, 3),
      min_volume: scenario(0.02, 1200, 0.00001, 0.6, 0.05),
    },
    offer: {},
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
  await jsClick(page.getByRole('button', { name: 'Net Min', exact: true }));

  const row = page.getByTestId('past-offers-row').first();
  await expect(row).toContainText('0,0200 BTC');
  await expect(row).toContainText('0,60 €');
});
