export interface Offer {
  exchange: string;
  direction: string;
  price: number;
  price_diff_percent: number | null;
  btc_min: number | null;
  btc_max: number | null;
  payment_method: string | null;
  first_seen: string | null;
  last_seen: string | null;
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
