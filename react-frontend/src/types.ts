export interface CostBreakdown {
  btc_amount: number;
  cex_taker_fee_pct: number;
  cex_taker_fee_btc: number;
  withdrawal_fee_pct: number;
  withdrawal_fee_btc: number;
  network_fee_pct: number;
  network_fee_btc: number;
  dex_fee_pct: number;
  dex_fee_btc: number;
  total_cost_pct: number;
  total_cost_btc: number;
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
  btc_min: number | null;
  btc_max: number | null;
  payment_method: string | null;
  offer_id: string | null;
  first_seen: string | null;
  last_seen: string | null;
  is_live: boolean;
  ref_price: number | null;
  premium?: number | null;
  time?: string;
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
}
