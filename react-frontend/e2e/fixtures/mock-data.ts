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
  direction: 'bid' | 'ask',
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
  const withdrawalBTC = direction === 'ask' ? 0 : btcAmount * 0.0015;
  const networkBTC = btcAmount * 0.001;
  const abortNetworkBTC = direction === 'ask' ? networkBTC * 2 : networkBTC;
  const abortTotalBTC = direction === 'ask'
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
      route_method: 'onchain_direct',
      trade_direction: direction === 'ask' ? 'ask' : 'bid',
      num_network_txs: direction === 'ask' ? 1 : 2,
      estimated_profit_pct: netPremium,
      estimated_profit_btc: btcAmount * (netPremium / 100),
      cex_taker_fee_pct: 0.25,
      cex_taker_fee_btc: cexTakerBTC,
      withdrawal_fee_pct: 0.15,
      withdrawal_fee_btc: withdrawalBTC,
      network_fee_pct: 0.10,
      network_fee_btc: networkBTC,
      routing_fee_sum_pct: 0.10,
      routing_fee_sum_btc: networkBTC,
      routing_profile: 'Direct_main2main',
      network_fee_method: 'onchain_direct',
      network_fee_tier: 'standard',
      network_fee_confidence: 0.9,
      network_fee_detail: null,
      conversion: {
        strategy: '',
        service_fee_pct: 0, service_fee_btc: 0,
        provider_miner_btc: 0, lockup_fee_btc: 0,
        routing_fee_pct: 0, routing_fee_btc: 0,
        channel_open_btc: 0,
        fee_sum_pct: 0, fee_sum_btc: 0,
        crossover_amount_btc: 0,
      },
      hedge: {
        fee_sum_btc: 0,
        fee_sum_pct: 0,
      },
      dex_fee_pct: 0.35,
      dex_fee_btc: btcAmount * 0.0035,
      total_cost_pct: tradeCost,
      total_cost_btc: btcAmount * (tradeCost / 100),
      capital: (() => {
        const depositPct = exchange === 'bisq' ? 0.15 : 0;
        const depositBtc = depositPct > 0 ? Math.max(btcAmount * depositPct, 0.001) : 0;
        const depositEur = depositBtc * refPrice;
        const spotEur = btcAmount * refPrice;
        return {
          btc_amount: btcAmount,
          btc_price: refPrice,
          spot_notional: spotEur,
          hedge_collateral: 0,
          security_deposit_pct: depositPct,
          security_deposit_side: direction === 'ask' ? 'buyer' : 'seller',
          security_deposit_btc: depositBtc,
          security_deposit_fiat: depositEur,
          total_fiat: spotEur + depositEur,
          deposit_estimated: depositPct > 0,
        };
      })(),
    },
    abort_cost: {
      btc_amount: btcAmount,
      trade_direction: direction === 'ask' ? 'ask' : 'bid',
      num_network_txs: 2,
      cex_buy_taker: { pct: direction === 'ask' ? 0 : pct(cexTakerBTC), btc: direction === 'ask' ? 0 : cexTakerBTC },
      cex_sell_taker: { pct: direction === 'ask' ? 0 : pct(cexTakerBTC), btc: direction === 'ask' ? 0 : cexTakerBTC },
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
        side: direction === 'ask' ? 'long' : 'short',
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
    payment_methods: [opts.payment ?? 'SEPA'],
    offer_id: `offer-${id}`,
    first_seen: ts(opts.firstSeenHoursAgo ?? 12),
    last_seen: opts.isLive !== false ? ts(0) : ts(opts.lastSeenHoursAgo ?? 2),
    is_live: opts.isLive !== false,
    ref_price: refPrice,
    premium: premiumPct,
    time: ts(opts.firstSeenHoursAgo ?? 12),
  };
}

export const MOCK_LIVE_OFFER_FIAT_COUNTS = {
  raw_premium: {
    EUR: 10,
    USD: 4,
    GBP: 2,
    AUD: 0,
    CHF: 1,
    SEK: 0,
    NOK: 0,
    CAD: 0,
  },
};

export const MOCK_LIVE_OFFERS = [
  // ── PremiumOnly-passing offers ──
  // Buy direction with positive premium (user sells on DEX at premium)
  offer(1, 'bisq', 'bid', 84460, 3.0, { btcMax: 0.10, payment: 'SEPA' }),
  offer(2, 'bisq', 'bid', 83640, 2.0, { btcMax: 0.05, payment: 'Revolut', firstSeenHoursAgo: 6 }),
  offer(3, 'bisq', 'bid', 85280, 4.0, { btcMax: 0.08, payment: 'SEPA', firstSeenHoursAgo: 3 }),
  offer(4, 'hodlhodl', 'bid', 85690, 4.5, { btcMax: 0.20, payment: 'SEPA', firstSeenHoursAgo: 10 }),
  offer(5, 'hodlhodl', 'bid', 82820, 1.0, { btcMax: 0.03, payment: 'Revolut', firstSeenHoursAgo: 4 }),
  offer(6, 'robosats', 'bid', 86510, 5.5, { btcMax: 0.04, payment: 'Revolut', firstSeenHoursAgo: 2 }),
  offer(7, 'robosats', 'bid', 83230, 1.5, { btcMax: 0.02, payment: 'Wise', firstSeenHoursAgo: 7 }),
  // Sell direction with negative premium (user buys on DEX cheaper)
  offer(8, 'bisq', 'ask', 80360, -2.0, { btcMax: 0.06, payment: 'SEPA', firstSeenHoursAgo: 15 }),
  offer(9, 'robosats', 'ask', 81590, -0.5, { btcMax: 0.03, payment: 'PayPal', firstSeenHoursAgo: 5 }),

  // ── Non-PremiumOnly offers (filtered out by default) ──
  // Sell direction with positive premium
  offer(10, 'bisq', 'ask', 84050, 2.5, { btcMax: 0.06, payment: 'SEPA', firstSeenHoursAgo: 8 }),
  offer(11, 'hodlhodl', 'ask', 87330, 6.5, { btcMax: 0.01, payment: 'Cash App', firstSeenHoursAgo: 1 }),
  offer(12, 'robosats', 'ask', 88150, 7.5, { btcMax: 0.005, payment: 'Wise', firstSeenHoursAgo: 0.5 }),
  // Buy direction with negative premium
  offer(13, 'hodlhodl', 'bid', 79540, -3.0, { btcMax: 0.10, payment: 'Revolut', firstSeenHoursAgo: 9 }),

  // ── Closed offers ──
  offer(14, 'bisq', 'bid', 83500, 1.8, { btcMax: 0.06, payment: 'SEPA', isLive: false, firstSeenHoursAgo: 20, lastSeenHoursAgo: 4 }),
  offer(15, 'hodlhodl', 'bid', 84200, 2.7, { btcMax: 0.10, payment: 'Revolut', isLive: false, firstSeenHoursAgo: 18, lastSeenHoursAgo: 6 }),
];

// Past offers: only closed historical offers (separate IDs to avoid duplicates when app combines live+past)
export const MOCK_PAST_OFFERS = [
  offer(101, 'bisq', 'bid', 83800, 2.2, { isLive: false, firstSeenHoursAgo: 36, lastSeenHoursAgo: 30, payment: 'SEPA' }),
  offer(102, 'hodlhodl', 'ask', 80200, -2.2, { isLive: false, firstSeenHoursAgo: 30, lastSeenHoursAgo: 26, payment: 'Revolut' }),
  offer(103, 'robosats', 'bid', 83200, 1.5, { isLive: false, firstSeenHoursAgo: 28, lastSeenHoursAgo: 24, payment: 'Wise' }),
  offer(104, 'bisq', 'ask', 81000, -1.2, { isLive: false, firstSeenHoursAgo: 42, lastSeenHoursAgo: 38, payment: 'PayPal' }),
  offer(105, 'hodlhodl', 'bid', 85000, 3.7, { isLive: false, firstSeenHoursAgo: 40, lastSeenHoursAgo: 34, payment: 'SEPA' }),
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

// Price histories for LIVE offers (served by /api/live_offers/{id}/lifecycle).
// Offer 1: 12h zig-zag path whose net premium flips from negative to positive
// (exercises the color-segment split). Offer 6: short single-color path.
// Live offers without an entry get [] from the fixture and must fall back to
// the 2-point stub.
export const MOCK_LIVE_OFFER_LIFECYCLES: Record<number, Array<{ time: string; price: number; net_premium_pct: number }>> = {
  1: [
    { time: ts(12), price: 81600, net_premium_pct: -0.9 },
    { time: ts(11), price: 82150, net_premium_pct: -0.5 },
    { time: ts(10), price: 81900, net_premium_pct: -0.7 },
    { time: ts(9),  price: 82600, net_premium_pct: -0.2 },
    { time: ts(8),  price: 83150, net_premium_pct: 0.4 },
    { time: ts(7),  price: 82900, net_premium_pct: 0.15 },
    { time: ts(6),  price: 83650, net_premium_pct: 0.9 },
    { time: ts(5),  price: 84150, net_premium_pct: 1.4 },
    { time: ts(4),  price: 83850, net_premium_pct: 1.1 },
    { time: ts(3),  price: 84450, net_premium_pct: 1.7 },
    { time: ts(2),  price: 84150, net_premium_pct: 1.45 },
    { time: ts(1),  price: 84460, net_premium_pct: 2.15 },
  ],
  6: [
    { time: ts(2),   price: 86050, net_premium_pct: 4.2 },
    { time: ts(1.5), price: 86350, net_premium_pct: 4.5 },
    { time: ts(1),   price: 86510, net_premium_pct: 4.65 },
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

export const MOCK_TRADING_ACCOUNTS = [
  {
    id: 11,
    provider: 'Revolut',
    category: 'Fiat Transmitter',
    payment_priority: 1,
    is_active: true,
    email: 'ops@desk.test',
    password: 'secret',
    phone: '+49123456789',
    is_healthy: false,
    last_health_check: null,
    created_at: ts(96),
    updated_at: ts(12),
    totp_secrets: [],
    passkey_credentials: [],
    seeds: [],
    api_keys: [],
    account_file_backup: null,
    lnd_channel_backup: null,
    bank_accounts: [],
  },
  {
    id: 12,
    provider: 'WISE',
    category: 'Fiat Transmitter',
    payment_priority: 2,
    is_active: false,
    email: 'wise@desk.test',
    password: 'secret',
    phone: null,
    is_healthy: false,
    last_health_check: null,
    created_at: ts(90),
    updated_at: ts(20),
    totp_secrets: [],
    passkey_credentials: [],
    seeds: [],
    api_keys: [],
    account_file_backup: null,
    lnd_channel_backup: null,
    bank_accounts: [],
  },
  {
    id: 22,
    provider: 'Bisq',
    category: 'DEX',
    email: null,
    password: null,
    phone: null,
    is_healthy: true,
    last_health_check: ts(2),
    created_at: ts(120),
    updated_at: ts(4),
    totp_secrets: [
      { id: 501, account_id: 22, secret: 'JBSWY3DPEHPK3PXP', is_active: true, created_at: ts(100), rotated_at: null },
    ],
    passkey_credentials: [],
    seeds: [
      { id: 601, account_id: 22, seed_phrase: 'alpha beta gamma delta', wallet_created_at: ts(200), created_at: ts(200) },
    ],
    api_keys: [],
    account_file_backup: {
      id: 701,
      account_id: 22,
      file_name: 'bisq-account.dat',
      file_sha256: 'abcdef1234567890',
      file_size_bytes: 2048,
      modified_at: ts(10),
      created_at: ts(10),
    },
    lnd_channel_backup: null,
    bank_accounts: [],
  },
  {
    id: 33,
    provider: 'Kraken',
    category: 'CEX',
    email: null,
    password: null,
    phone: null,
    is_healthy: true,
    last_health_check: ts(1),
    created_at: ts(72),
    updated_at: ts(1),
    totp_secrets: [],
    passkey_credentials: [],
    seeds: [],
    api_keys: [
      {
        id: 801,
        account_id: 33,
        name: 'Primary',
        api_key: 'kraken-key',
        api_secret: 'kraken-secret',
        passphrase: null,
        is_active: true,
        permissions: { read_balances: 'granted', spot_trading: 'granted' },
        permissions_checked_at: ts(1),
        created_at: ts(72),
        updated_at: ts(1),
      },
    ],
    account_file_backup: null,
    lnd_channel_backup: null,
    bank_accounts: [],
  },
  {
    id: 44,
    provider: 'LND wallet',
    category: 'Internal Infrastructure',
    email: null,
    password: 'wallet-password',
    phone: null,
    is_healthy: true,
    last_health_check: ts(5),
    created_at: ts(240),
    updated_at: ts(5),
    totp_secrets: [],
    passkey_credentials: [],
    seeds: [
      { id: 901, account_id: 44, seed_phrase: 'able acid actor adapt', wallet_created_at: ts(240), created_at: ts(240) },
    ],
    api_keys: [],
    account_file_backup: null,
    lnd_channel_backup: {
      id: 902,
      account_id: 44,
      backup_sha256: '0123456789abcdef',
      backup_size_bytes: 512,
      channel_count: 1,
      created_at: ts(5),
    },
    bank_accounts: [],
  },
];

export const MOCK_TRADING_PAYMENT_METHODS = {
  payment_methods: [
    {
      id: 1001,
      name: 'Revolut',
      merge_regex: null,
      alias_list: [],
      category: 'Fiat Transmitter',
      account_id: 11,
      is_active: true,
      is_linked: true,
      priority: 8,
      match_order: 10,
      link_label: 'Revolut',
      created_at: ts(96),
      updated_at: ts(12),
    },
    {
      id: 1002,
      name: 'Revolut Instant',
      merge_regex: '(?i)^revolut instant$',
      alias_list: ['Revolut instant'],
      category: 'Fiat Transmitter',
      account_id: 11,
      is_active: true,
      is_linked: true,
      priority: 4,
      match_order: 11,
      link_label: 'Revolut',
      created_at: ts(48),
      updated_at: ts(8),
    },
  ],
};

export const MOCK_BISQ_PAYMENT_ACCOUNTS = {
  payment_accounts: [
    {
      id: 'bisq-sepa-1',
      account_name: 'Alice Example · SEPA · DE12345678901234567890',
      payment_method_id: 'SEPA',
      trade_currency: 'EUR',
    },
  ],
};

export const MOCK_CEX_DEPOSIT_ADDRESSES: Record<number, Array<{
  asset: string;
  network: string;
  address: string;
  method?: string;
}>> = {
  33: [
    {
      asset: 'BTC',
      network: 'Bitcoin',
      address: 'bc1qexamplekrakenaddress000000000000000000000',
      method: 'onchain',
    },
  ],
};

export const MOCK_CEX_BALANCES: Record<number, {
  bitcoin?: { asset: string; available: number; total: number };
  fiat: Array<{ asset: string; available: number; total: number }>;
  source: string;
}> = {
  33: {
    bitcoin: { asset: 'BTC', available: 0.245, total: 0.245 },
    fiat: [{ asset: 'EUR', available: 12450.32, total: 12450.32 }],
    source: 'mock',
  },
};

export const MOCK_TELEGRAM_CONFIG = {
  bot_token_present: true,
  chat_id: '123456789',
  dexmm_webhook_url: 'https://dexmm.example.test/telegram',
  pushpush_webhook_url: 'https://pushpush.example.test/telegram',
  dexmm_webhook_set: true,
  pushpush_webhook_set: false,
  config_version: 3,
};

export const MOCK_SNAPSHOT_LOG_COMPACT = [
  {
    id: 1,
    timestamp: ts(0.1),
    exchanges: {
      bisq: { count: 0, status: 'complete' },
      hodlhodl: { count: 100, status: 'complete' },
      robosats: { count: 8, status: 'complete' },
    },
    offers_count: 108,
  },
  {
    id: 2,
    timestamp: ts(1.1),
    exchanges: {
      hodlhodl: { count: 100, status: 'complete' },
      robosats: { count: 7, status: 'complete' },
    },
    offers_count: 107,
  },
];

export const MOCK_SNAPSHOT_LOG_DETAIL: Record<number, (typeof MOCK_SNAPSHOT_LOG_COMPACT)[number]> = {
  1: {
    ...MOCK_SNAPSHOT_LOG_COMPACT[0],
    exchanges: {
      bisq: { count: 0, ids: [], status: 'complete' },
      hodlhodl: { count: 100, ids: ['hh-1', 'hh-2'], status: 'complete' },
      robosats: { count: 8, ids: ['rs-1'], status: 'complete' },
    },
  },
  2: {
    ...MOCK_SNAPSHOT_LOG_COMPACT[1],
    exchanges: {
      hodlhodl: { count: 100, ids: ['hh-old-1'], status: 'complete' },
      robosats: { count: 7, ids: ['rs-old-1'], status: 'complete' },
    },
  },
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

export const MOCK_TRADE_COST_CONFIG = {
  cexes: [
    { name: 'kraken' },
    { name: 'coinbase' },
  ],
  dex_routing_profiles: [
    { dex: 'bisq', bid: 'onchain_direct', ask: 'onchain_direct' },
    { dex: 'bisq2', bid: 'onchain_hub', ask: 'onchain_direct' },
    { dex: 'robosats', bid: 'onchain_swap', ask: 'onchain_swap' },
  ],
  fee_tiers: [
    { value: '', label: 'Auto (congestion-based)' },
    { value: 'economic', label: 'Economic (cheapest, ~1h)' },
    { value: 'standard', label: 'Standard (balanced, ~30min)' },
    { value: 'fast', label: 'Fast (priority, ~10min)' },
    { value: 'express', label: 'Express (next block, ~2min)' },
  ],
};

export const MOCK_CEX_PERMISSIONS = {
  max_age_seconds: 1800,
  exchanges: [
    {
      account_id: 33,
      provider: 'Kraken',
      exchange: 'kraken',
      cost_supported: true,
      execution_supported: true,
      active_key_count: 1,
      permissions_checked_at: ts(1),
      policy: { spot_enabled: true, hedge_enabled: true },
      spot: { supported: true, policy_enabled: true, available: true, effective_enabled: true, blocking_permissions: [], blockers: [] },
      hedge: {
        supported: true,
        policy_enabled: true,
        available: false,
        effective_enabled: false,
        blocking_permissions: ['hedge_positions'],
        blockers: [{ code: 'missing_permission', permissions: ['hedge_positions'], message: 'Required API-key permissions were not granted.' }],
      },
    },
    {
      account_id: 34,
      provider: 'Coinbase',
      exchange: 'coinbase',
      cost_supported: true,
      execution_supported: true,
      active_key_count: 0,
      permissions_checked_at: null,
      policy: { spot_enabled: true, hedge_enabled: true },
      spot: {
        supported: true,
        policy_enabled: true,
        available: false,
        effective_enabled: false,
        blocking_permissions: ['fetch_deposit_address', 'spot_trading', 'read_balances', 'withdraw'],
        blockers: [{ code: 'no_active_keys', message: 'No active API keys are configured.' }],
      },
      hedge: {
        supported: true,
        policy_enabled: true,
        available: false,
        effective_enabled: false,
        blocking_permissions: ['hedge_positions'],
        blockers: [{ code: 'no_active_keys', message: 'No active API keys are configured.' }],
      },
    },
    {
      account_id: 0,
      provider: 'Bitstamp',
      exchange: 'bitstamp',
      cost_supported: true,
      execution_supported: false,
      active_key_count: 0,
      policy: { spot_enabled: true, hedge_enabled: true },
      spot: { supported: false, policy_enabled: true, available: false, effective_enabled: false, blocking_permissions: [], blockers: [{ code: 'unsupported', message: 'MM execution does not support this provider capability.' }] },
      hedge: { supported: false, policy_enabled: true, available: false, effective_enabled: false, blocking_permissions: [], blockers: [{ code: 'unsupported', message: 'MM execution does not support this provider capability.' }] },
    },
  ],
};

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

// Response for POST /api/statistics (Statistics tab).
export const MOCK_STATISTICS = {
  live: {
    total_offers: 12,
    active_offers: 12,
    exchanges_live: 2,
    offers_by_exchange: [
      { name: 'robosats', count: 8 },
      { name: 'hodlhodl', count: 4 },
    ],
    payment_method_counts: [
      { name: 'SEPA', count: 7 },
      { name: 'Revolut', count: 5 },
    ],
    premium_summary: {
      best_ask_premium_pct: 1.2,
      avg_ask_premium_pct: 2.4,
      best_bid_premium_pct: -0.8,
      avg_bid_premium_pct: -1.6,
    },
    offer_lifecycle_points: [
      { lifecycle_hours: 0.5, premium_rate_pct: 1.2, volume_btc: 0.01, exchange: 'robosats', direction: 'ask', is_live: true },
      { lifecycle_hours: 8, premium_rate_pct: -0.8, volume_btc: 0.08, exchange: 'hodlhodl', direction: 'bid', is_live: true },
    ],
  },
  past: {
    total_offers: 34,
    offers_by_exchange: [
      { name: 'robosats', count: 20 },
      { name: 'hodlhodl', count: 14 },
    ],
    payment_method_counts: [
      { name: 'SEPA', count: 18 },
      { name: 'Revolut', count: 16 },
    ],
    past_premiums: [
      {
        timeframe: '24h',
        hours: 24,
        avg_premium_by_exchange: [{ name: 'robosats', avg_premium_pct: 2.1 }],
        modes: {
          raw: [{ name: 'robosats', avg_premium_pct: 2.1 }],
          net_full: [{ name: 'robosats', avg_premium_pct: 1.4 }],
          net_capped: [{ name: 'robosats', avg_premium_pct: 1.1 }],
        },
      },
    ],
    premium_lifetimes: {
      raw: {
        avg_offer_lifetime_ms: 3_600_000,
        avg_offer_lifetime_ms_by_exchange: [{ name: 'robosats', ms: 3_600_000 }],
      },
      net_full: {
        avg_offer_lifetime_ms: 3_500_000,
        avg_offer_lifetime_ms_by_exchange: [{ name: 'robosats', ms: 3_500_000 }],
      },
      net_capped: {
        avg_offer_lifetime_ms: 3_400_000,
        avg_offer_lifetime_ms_by_exchange: [{ name: 'robosats', ms: 3_400_000 }],
      },
    },
    offer_lifecycle_points: [
      { lifecycle_hours: 2, premium_rate_pct: 2.1, volume_btc: 0.02, exchange: 'robosats', direction: 'ask', is_live: false },
      { lifecycle_hours: 36, premium_rate_pct: 3.4, volume_btc: 0.2, exchange: 'hodlhodl', direction: 'ask', is_live: false },
    ],
  },
  shared: {
    hours: 168,
    total_offers: 46,
    active_offers: 12,
    exchanges_live: 2,
    offers_by_exchange: [
      { name: 'robosats', count: 28 },
      { name: 'hodlhodl', count: 18 },
    ],
    payment_method_counts: [
      { name: 'SEPA', count: 25 },
      { name: 'Revolut', count: 21 },
    ],
  },
};
