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
  const cexTakerBTC = btcAmount * 0.0025;
  const withdrawalBTC = direction === 'sell' ? 0 : btcAmount * 0.0015;
  const networkBTC = btcAmount * 0.001;
  const abortNetworkBTC = direction === 'sell' ? networkBTC * 2 : networkBTC;
  const abortTotalBTC = direction === 'sell'
    ? abortNetworkBTC
    : cexTakerBTC + cexTakerBTC + withdrawalBTC + abortNetworkBTC;
  const pct = (btc: number) => btcAmount > 0 ? (btc / btcAmount) * 100 : 0;
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
      route_cex: 'kraken',
      route_dex: exchange,
      route_method: 'onchain',
      trade_direction: direction === 'sell' ? 'ask' : 'bid',
      num_network_txs: direction === 'sell' ? 1 : 2,
      estimated_profit_pct: netPremium,
      estimated_profit_btc: btcAmount * (netPremium / 100),
      cex_taker_fee_pct: 0.25,
      cex_taker_fee_btc: cexTakerBTC,
      withdrawal_fee_pct: 0.15,
      withdrawal_fee_btc: withdrawalBTC,
      network_fee_pct: 0.10,
      network_fee_btc: networkBTC,
      network_fee_method: 'onchain',
      network_fee_tier: 'standard',
      network_fee_confidence: 0.9,
      network_fee_detail: null,
      hedge: {
        fee_sum_btc: 0,
        fee_sum_pct: 0,
        legs: [],
      },
      dex_fee_pct: 0.35,
      dex_fee_btc: btcAmount * 0.0035,
      total_cost_pct: tradeCost,
      total_cost_btc: btcAmount * (tradeCost / 100),
    },
    abort_cost: {
      btc_amount: btcAmount,
      trade_direction: direction === 'sell' ? 'ask' : 'bid',
      num_network_txs: 2,
      cex_buy_taker: { pct: direction === 'sell' ? 0 : pct(cexTakerBTC), btc: direction === 'sell' ? 0 : cexTakerBTC },
      cex_sell_taker: { pct: direction === 'sell' ? 0 : pct(cexTakerBTC), btc: direction === 'sell' ? 0 : cexTakerBTC },
      withdrawal: { pct: pct(withdrawalBTC), btc: withdrawalBTC },
      network: { pct: pct(abortNetworkBTC), btc: abortNetworkBTC },
      hedge: {
        open_fee_pct: 0,
        open_fee_btc: 0,
        close_fee_pct: 0,
        close_fee_btc: 0,
        funding_fee_pct: 0,
        funding_fee_btc: 0,
        fee_sum_pct: 0,
        fee_sum_btc: 0,
        side: direction === 'sell' ? 'long' : 'short',
        venue: '',
        instrument: '',
        transfer_minutes: 0,
        position: null,
      },
      total: { pct: pct(abortTotalBTC), btc: abortTotalBTC },
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

export const MOCK_PAST_OFFER_LIFECYCLES: Record<number, Array<{ time: string; price: number; net_premium_pct: number }>> = {
  101: [
    { time: new Date(FIXED_TIME - 36 * 3600_000).toISOString(), price: 82900, net_premium_pct: 0.8 },
    { time: new Date(FIXED_TIME - 33 * 3600_000).toISOString(), price: 83200, net_premium_pct: 1.0 },
    { time: new Date(FIXED_TIME - 30 * 3600_000).toISOString(), price: 83800, net_premium_pct: 1.2 },
  ],
  103: [
    { time: new Date(FIXED_TIME - 28 * 3600_000).toISOString(), price: 82400, net_premium_pct: 0.9 },
    { time: new Date(FIXED_TIME - 26 * 3600_000).toISOString(), price: 83000, net_premium_pct: 1.1 },
    { time: new Date(FIXED_TIME - 24 * 3600_000).toISOString(), price: 83200, net_premium_pct: 1.35 },
  ],
};

export const MOCK_STALE_PAST_OFFER_LIFECYCLE = [
  { time: ts(40), price: 81200, net_premium_pct: 0.4 },
  { time: ts(39), price: 81500, net_premium_pct: 0.5 },
];

export const MOCK_PAYMENT_METHOD_GROUPS = {
  groups: [
    {
      name: 'sepa_instant',
      display_name: 'SEPA Instant',
      methods: ['SEPA', 'Instant Bank Transfer'],
    },
    {
      name: 'wallets',
      display_name: 'Wallets',
      methods: ['Revolut', 'Wise', 'PayPal', 'Cash App'],
    },
  ],
};

export const MOCK_SNAPSHOT_LOG_COMPACT = [
  {
    id: 1,
    timestamp: ts(0.1),
    exchanges: {
      bisq: { count: 0 },
      hodlhodl: { count: 100 },
      robosats: { count: 8 },
    },
    offers_count: 108,
  },
  {
    id: 2,
    timestamp: ts(1.1),
    exchanges: {
      hodlhodl: { count: 100 },
      robosats: { count: 7 },
    },
    offers_count: 107,
  },
];

export const MOCK_SNAPSHOT_LOG_DETAIL: Record<number, (typeof MOCK_SNAPSHOT_LOG_COMPACT)[number]> = {
  1: {
    ...MOCK_SNAPSHOT_LOG_COMPACT[0],
    exchanges: {
      bisq: { count: 0, ids: [] },
      hodlhodl: { count: 100, ids: ['hh-1', 'hh-2'] },
      robosats: { count: 8, ids: ['rs-1'] },
    },
  },
  2: {
    ...MOCK_SNAPSHOT_LOG_COMPACT[1],
    exchanges: {
      hodlhodl: { count: 100, ids: ['hh-old-1'] },
      robosats: { count: 7, ids: ['rs-old-1'] },
    },
  },
};

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

export const MOCK_PAST_ORDER_STATS = {
  fiat_currency: 'EUR',
  excluded_payment_methods: [],
  timeframes: [
    {
      timeframe: '24h',
      hours: 24,
      premium_order_count: 3,
      total_net_profit_btc: 0.0012,
      total_net_profit_fiat: 98.4,
      average_order_size_btc: 0.05,
      smallest_order_size_btc: 0.02,
      biggest_order_size_btc: 0.1,
    },
  ],
};

export const MOCK_GENERAL_STATS = {
  total_offers: 15,
  active_offers: 13,
  exchanges_live: 3,
  offers_by_exchange: [
    { name: 'bisq', count: 6 },
    { name: 'hodlhodl', count: 4 },
    { name: 'robosats', count: 5 },
  ],
  best_ask_premium_pct: -2.0,
  avg_ask_premium_pct: -1.25,
  best_bid_premium_pct: 5.5,
  avg_bid_premium_pct: 2.75,
  avg_offer_lifetime_ms: 3_600_000,
  avg_offer_lifetime_ms_by_exchange: [
    { name: 'bisq', ms: 3_600_000 },
    { name: 'hodlhodl', ms: 5_400_000 },
    { name: 'robosats', ms: 2_700_000 },
  ],
  payment_method_counts: [
    { name: 'SEPA', count: 5 },
    { name: 'Revolut', count: 4 },
    { name: 'Wise', count: 3 },
  ],
  past_premiums: [],
};

export const MOCK_GENERAL_STATS_OVERVIEW = {
  total_offers: MOCK_GENERAL_STATS.total_offers,
  active_offers: MOCK_GENERAL_STATS.active_offers,
  exchanges_live: MOCK_GENERAL_STATS.exchanges_live,
  offers_by_exchange: MOCK_GENERAL_STATS.offers_by_exchange,
  payment_method_counts: MOCK_GENERAL_STATS.payment_method_counts,
};

export const MOCK_GENERAL_STATS_OPEN_PREMIUMS = {
  raw: {
    avg_ask_premium_pct: MOCK_GENERAL_STATS.avg_ask_premium_pct,
    avg_bid_premium_pct: MOCK_GENERAL_STATS.avg_bid_premium_pct,
  },
  net_full: {
    avg_ask_premium_pct: MOCK_GENERAL_STATS.avg_ask_premium_pct,
    avg_bid_premium_pct: MOCK_GENERAL_STATS.avg_bid_premium_pct,
  },
  net_capped: {
    avg_ask_premium_pct: MOCK_GENERAL_STATS.avg_ask_premium_pct,
    avg_bid_premium_pct: MOCK_GENERAL_STATS.avg_bid_premium_pct,
  },
};

export const MOCK_GENERAL_STATS_LIFETIMES = {
  raw: {
    avg_offer_lifetime_ms: MOCK_GENERAL_STATS.avg_offer_lifetime_ms,
    avg_offer_lifetime_ms_by_exchange: MOCK_GENERAL_STATS.avg_offer_lifetime_ms_by_exchange,
  },
  net_full: {
    avg_offer_lifetime_ms: MOCK_GENERAL_STATS.avg_offer_lifetime_ms,
    avg_offer_lifetime_ms_by_exchange: MOCK_GENERAL_STATS.avg_offer_lifetime_ms_by_exchange,
  },
  net_capped: {
    avg_offer_lifetime_ms: MOCK_GENERAL_STATS.avg_offer_lifetime_ms,
    avg_offer_lifetime_ms_by_exchange: MOCK_GENERAL_STATS.avg_offer_lifetime_ms_by_exchange,
  },
};

export const MOCK_GENERAL_STATS_PAST_PREMIUMS = MOCK_GENERAL_STATS.past_premiums;
export const MOCK_GENERAL_STATS_PAYMENT_METHODS = MOCK_GENERAL_STATS.payment_method_counts;

// ── OHLC ──────────────────────────────────────────────────────────────────────

function candle(hoursAgo: number, open: number, high: number, low: number, close: number) {
  const d = new Date(FIXED_TIME - hoursAgo * 3600_000);
  return { time: d.toISOString().replace('T', ' ').slice(0, 19), open, high, low, close };
}

function windowCandles(totalHours: number, stepHours: number) {
  const count = Math.floor(totalHours / stepHours);
  return Array.from({ length: count }, (_, i) => {
    const hoursAgo = totalHours - i * stepHours;
    const base = 81200 + i * 18;
    return candle(hoursAgo, base, base + 240, base - 220, base + 80);
  });
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

export const MOCK_OHLC_DATA_4H_WINDOW = {
  interval_min: 240,
  candles: windowCandles(480, 4),
};

export const MOCK_OHLC_DATA_1D_WINDOW = {
  interval_min: 1440,
  candles: windowCandles(2880, 24),
};
