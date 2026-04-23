/**
 * Deterministic mock data for Playwright E2E tests.
 * All timestamps are relative to FIXED_TIME so that frozen Date.now() keeps everything consistent.
 */

export const FIXED_TIME = new Date('2026-04-01T12:00:00Z').getTime();

function ts(hoursAgo: number): string {
  const d = new Date(FIXED_TIME - hoursAgo * 3600_000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

// ── Offers ────────────────────────────────────────────────────────────────────

function offer(
  id: number,
  exchange: string,
  direction: 'buy' | 'sell',
  price: number,
  premiumPct: number,
  opts: Partial<{
    btcMin: number; btcMax: number; payment: string;
    firstSeenHoursAgo: number; lastSeenHoursAgo: number;
    isLive: boolean; refPrice: number;
    tradeCostPct: number; netPremiumPct: number;
  }> = {},
) {
  const refPrice = opts.refPrice ?? 82000;
  const btcAmount = opts.btcMax ?? 0.05;
  const tradeCost = opts.tradeCostPct ?? 0.85;
  const netPremium = opts.netPremiumPct ?? (premiumPct - tradeCost);
  return {
    id,
    exchange,
    direction,
    price,
    price_diff_percent: premiumPct,
    trade_cost_percent: tradeCost,
    net_premium_percent: netPremium,
    cost_breakdown: {
      btc_amount: btcAmount,
      cex_taker_fee_pct: 0.25,
      cex_taker_fee_btc: btcAmount * 0.0025,
      withdrawal_fee_pct: 0.15,
      withdrawal_fee_btc: btcAmount * 0.0015,
      network_fee_pct: 0.10,
      network_fee_btc: btcAmount * 0.001,
      dex_fee_pct: 0.35,
      dex_fee_btc: btcAmount * 0.0035,
      total_cost_pct: tradeCost,
      total_cost_btc: btcAmount * (tradeCost / 100),
    },
    btc_min: opts.btcMin ?? 0.001,
    btc_max: opts.btcMax ?? 0.05,
    payment_method: opts.payment ?? 'SEPA',
    offer_id: `offer-${id}`,
    first_seen: ts(opts.firstSeenHoursAgo ?? 12),
    last_seen: opts.isLive !== false ? ts(0) : ts(opts.lastSeenHoursAgo ?? 2),
    is_live: opts.isLive !== false,
    ref_price: refPrice,
    premium: premiumPct,
    time: ts(opts.firstSeenHoursAgo ?? 12),
  };
}

export const MOCK_LIVE_OFFERS = [
  // ── PremiumOnly-passing offers ──
  // Buy direction with positive premium (user sells on DEX at premium)
  offer(1, 'bisq', 'buy', 84460, 3.0, { btcMax: 0.10, payment: 'SEPA' }),
  offer(2, 'bisq', 'buy', 83640, 2.0, { btcMax: 0.05, payment: 'Revolut', firstSeenHoursAgo: 6 }),
  offer(3, 'bisq', 'buy', 85280, 4.0, { btcMax: 0.08, payment: 'SEPA', firstSeenHoursAgo: 3 }),
  offer(4, 'hodlhodl', 'buy', 85690, 4.5, { btcMax: 0.20, payment: 'SEPA', firstSeenHoursAgo: 10 }),
  offer(5, 'hodlhodl', 'buy', 82820, 1.0, { btcMax: 0.03, payment: 'Revolut', firstSeenHoursAgo: 4 }),
  offer(6, 'robosats', 'buy', 86510, 5.5, { btcMax: 0.04, payment: 'Revolut', firstSeenHoursAgo: 2 }),
  offer(7, 'robosats', 'buy', 83230, 1.5, { btcMax: 0.02, payment: 'Wise', firstSeenHoursAgo: 7 }),
  // Sell direction with negative premium (user buys on DEX cheaper)
  offer(8, 'bisq', 'sell', 80360, -2.0, { btcMax: 0.06, payment: 'SEPA', firstSeenHoursAgo: 15 }),
  offer(9, 'robosats', 'sell', 81590, -0.5, { btcMax: 0.03, payment: 'PayPal', firstSeenHoursAgo: 5 }),

  // ── Non-PremiumOnly offers (filtered out by default) ──
  // Sell direction with positive premium
  offer(10, 'bisq', 'sell', 84050, 2.5, { btcMax: 0.06, payment: 'SEPA', firstSeenHoursAgo: 8 }),
  offer(11, 'hodlhodl', 'sell', 87330, 6.5, { btcMax: 0.01, payment: 'Cash App', firstSeenHoursAgo: 1 }),
  offer(12, 'robosats', 'sell', 88150, 7.5, { btcMax: 0.005, payment: 'Wise', firstSeenHoursAgo: 0.5 }),
  // Buy direction with negative premium
  offer(13, 'hodlhodl', 'buy', 79540, -3.0, { btcMax: 0.10, payment: 'Revolut', firstSeenHoursAgo: 9 }),

  // ── Closed offers ──
  offer(14, 'bisq', 'buy', 83500, 1.8, { btcMax: 0.06, payment: 'SEPA', isLive: false, firstSeenHoursAgo: 20, lastSeenHoursAgo: 4 }),
  offer(15, 'hodlhodl', 'buy', 84200, 2.7, { btcMax: 0.10, payment: 'Revolut', isLive: false, firstSeenHoursAgo: 18, lastSeenHoursAgo: 6 }),
];

// Past offers: only closed historical offers (separate IDs to avoid duplicates when app combines live+past)
export const MOCK_PAST_OFFERS = [
  offer(101, 'bisq', 'buy', 83800, 2.2, { isLive: false, firstSeenHoursAgo: 36, lastSeenHoursAgo: 30, payment: 'SEPA' }),
  offer(102, 'hodlhodl', 'sell', 80200, -2.2, { isLive: false, firstSeenHoursAgo: 30, lastSeenHoursAgo: 26, payment: 'Revolut' }),
  offer(103, 'robosats', 'buy', 83200, 1.5, { isLive: false, firstSeenHoursAgo: 28, lastSeenHoursAgo: 24, payment: 'Wise' }),
  offer(104, 'bisq', 'sell', 81000, -1.2, { isLive: false, firstSeenHoursAgo: 42, lastSeenHoursAgo: 38, payment: 'PayPal' }),
  offer(105, 'hodlhodl', 'buy', 85000, 3.7, { isLive: false, firstSeenHoursAgo: 40, lastSeenHoursAgo: 34, payment: 'SEPA' }),
];

// ── Stats ─────────────────────────────────────────────────────────────────────

export const MOCK_STATS = {
  offer_counts: [
    { exchange: 'bisq', offer_count: 5 },
    { exchange: 'hodlhodl', offer_count: 4 },
    { exchange: 'robosats', offer_count: 4 },
  ],
  price_stats: [
    { exchange: 'bisq', avg_price: 83548, min_price: 81180, max_price: 85280 },
    { exchange: 'hodlhodl', avg_price: 84705, min_price: 80360, max_price: 88150 },
    { exchange: 'robosats', avg_price: 84665, min_price: 81590, max_price: 87330 },
  ],
};

// ── OHLC ──────────────────────────────────────────────────────────────────────

function candle(hoursAgo: number, open: number, high: number, low: number, close: number) {
  const d = new Date(FIXED_TIME - hoursAgo * 3600_000);
  return { time: d.toISOString().replace('T', ' ').slice(0, 19), open, high, low, close };
}

export const MOCK_OHLC_DATA = {
  candles: [
    candle(24, 81200, 81500, 80900, 81300),
    candle(23, 81300, 81800, 81100, 81600),
    candle(22, 81600, 82000, 81400, 81900),
    candle(21, 81900, 82200, 81700, 82100),
    candle(20, 82100, 82500, 81900, 82300),
    candle(19, 82300, 82600, 82000, 82400),
    candle(18, 82400, 82800, 82200, 82700),
    candle(17, 82700, 83000, 82500, 82800),
    candle(16, 82800, 83200, 82600, 83100),
    candle(15, 83100, 83300, 82900, 83000),
    candle(14, 83000, 83400, 82800, 83300),
    candle(13, 83300, 83500, 83100, 83200),
    candle(12, 83200, 83600, 83000, 83500),
    candle(11, 83500, 83700, 83300, 83400),
    candle(10, 83400, 83800, 83200, 83700),
    candle(9,  83700, 83900, 83500, 83600),
    candle(8,  83600, 84000, 83400, 83900),
    candle(7,  83900, 84100, 83700, 83800),
    candle(6,  83800, 84200, 83600, 84100),
    candle(5,  84100, 84300, 83900, 84000),
    candle(4,  84000, 84400, 83800, 84300),
    candle(3,  84300, 84500, 84100, 84200),
    candle(2,  84200, 84600, 84000, 84500),
    candle(1,  84500, 84700, 84300, 84400),
  ],
};

// Shorter data set for 1h timeframe tests
export const MOCK_OHLC_DATA_1H = {
  candles: [
    candle(1, 84500, 84700, 84300, 84400),
  ],
};
