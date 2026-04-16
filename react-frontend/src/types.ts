export interface BTCNetworkFeeDetail {
  tx_vbytes: number;
  tx_type: string;
  tx_inputs: number;
  tx_outputs: number;
  num_txs: number;
  selected_sat_vb: number;
  required_confirmations: number;
  selected_inclusion_minutes: number;
  selected_full_confirmation_minutes: number;
  economic_sat_vb: number;
  economic_inclusion_minutes: number;
  economic_full_confirmation_minutes: number;
  standard_sat_vb: number;
  standard_inclusion_minutes: number;
  standard_full_confirmation_minutes: number;
  fast_sat_vb: number;
  fast_inclusion_minutes: number;
  fast_full_confirmation_minutes: number;
  express_sat_vb: number;
  express_inclusion_minutes: number;
  express_full_confirmation_minutes: number;
  congestion_level: string;
  mempool_size_mb: number;
  unconfirmed_tx_count: number;
  data_age_minutes: number;
}

export interface CostBreakdown {
  btc_amount: number;
  route_cex: string;
  route_dex: string;
  route_method: string;
  trade_direction: string;   // "bid" (buy CEX→sell DEX) or "ask" (buy DEX→sell CEX)
  num_network_txs: number;   // 2 for bid side, 1 for ask side
  estimated_profit_pct: number;
  estimated_profit_btc: number;
  cex_taker_fee_pct: number;
  cex_taker_fee_btc: number;
  withdrawal_fee_pct: number;
  withdrawal_fee_btc: number;
  network_fee_pct: number;
  network_fee_btc: number;
  network_fee_method: string;
  network_fee_tier: string;
  network_fee_confidence: number;
  network_fee_detail: BTCNetworkFeeDetail | null;
  hedge: HedgeBreakdown;
  dex_fee_pct: number;
  dex_fee_btc: number;
  total_cost_pct: number;
  total_cost_btc: number;
}

export interface HedgeBreakdown {
  open_fee_pct: number;
  open_fee_btc: number;
  close_fee_pct: number;
  close_fee_btc: number;
  funding_fee_pct: number;
  funding_fee_btc: number;
  fee_sum_pct: number;
  fee_sum_btc: number;
  venue: string;
  instrument: string;
  transfer_minutes: number;
  position?: HedgePositionDetail | null;
}

export interface HedgePositionDetail {
  hedge_ratio: number;
  leverage_used: number;
  hedge_notional_eur: number;
  initial_margin_eur: number;
  recommended_collateral_eur: number;
  stress_move_pct: number;
  stress_loss_eur: number;
  maintenance_requirement_eur: number;
  free_collateral_after_stress_eur: number;
  liquidation_move_pct: number;
  btc_price_eur: number;
}

export interface Offer {
  id: number;
  exchange: string;
  direction: string;
  price: number;
  price_diff_percent: number | null;
  trade_cost_percent: number | null;
  net_premium_percent: number | null;
  cost_breakdown: CostBreakdown | null;
  cost_breakdown_capped?: CostBreakdown | null;
  trade_cost_percent_capped?: number | null;
  net_premium_percent_capped?: number | null;
  btc_min: number | null;
  btc_max: number | null;
  payment_method: string | null;
  offer_id: string | null;
  first_seen: string | null;
  last_seen: string | null;
  is_live: boolean;
  ref_price: number | null;
  price_type?: string | null;
  premium?: number | null;
  time?: string;
  lifecycle?: { time: string; price: number; net_premium_pct?: number | null }[];
}

export interface ExchangeStat {
  exchange: string;
  offer_count: number;
}

export interface PriceStat {
  exchange: string;
  avg_price: number;
  min_price: number;
  max_price: number;
}

export interface Stats {
  offer_counts: ExchangeStat[];
  price_stats: PriceStat[];
}

export interface OHLCCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface OHLCData {
  candles: OHLCCandle[];
  interval_min?: number;
}

export interface PastOrderTimeframeStats {
  timeframe: string;
  hours: number;
  premium_order_count: number;
  total_net_profit_btc: number;
  total_net_profit_fiat: number;
  average_order_size_btc: number;
  smallest_order_size_btc: number;
  biggest_order_size_btc: number;
  // present only when max_fiat_limit was set and at least one order exceeded the cap
  total_net_profit_btc_capped?: number | null;
  total_net_profit_fiat_capped?: number | null;
  average_order_size_btc_capped?: number | null;
}

export interface PastOrderStats {
  fiat_currency: string;
  excluded_payment_methods: string[];
  timeframes: PastOrderTimeframeStats[];
}

export interface NamedCount {
  name: string;
  count: number;
}

export interface NamedPremium {
  name: string;
  avg_premium_pct: number;
}

export interface PastPremiumTimeframeStats {
  timeframe: string;
  hours: number;
  avg_premium_by_exchange: NamedPremium[];
}

export interface GeneralStatsData {
  total_offers: number;
  active_offers: number;
  exchanges_live: number;
  offers_by_exchange: NamedCount[];
  best_ask_premium_pct: number | null;
  avg_ask_premium_pct: number | null;
  best_bid_premium_pct: number | null;
  avg_bid_premium_pct: number | null;
  avg_offer_lifetime_ms: number | null;
  avg_offer_lifetime_ms_by_exchange: { name: string; ms: number }[];
  payment_method_counts: NamedCount[];
  past_premiums?: PastPremiumTimeframeStats[];
}

export interface PaymentMethodGroup {
  name: string;
  display_name: string;
  methods: string[];
}

export interface CexInfo {
  name: string;
  methods: string[];
  has_lightning: boolean;
}

export interface FeeTierOption {
  value: string;
  label: string;
}

export interface TradeCostConfig {
  cexes: CexInfo[];
  fee_tiers: FeeTierOption[];
}

export interface Filters {
  direction: string;
  exchange: string;
  payment: string;
  status: string;
  premiumMin: string;
  premiumMax: string;
  premiumOnly: boolean;
  hours: string;
  cex: string;
}
