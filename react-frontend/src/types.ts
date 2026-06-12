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

export interface AbortCostBreakdown {
  btc_amount: number;
  trade_direction: string;
  num_network_txs: number;
  cex_buy_taker: LiveOfferCostComponent;
  cex_sell_taker: LiveOfferCostComponent;
  withdrawal: LiveOfferCostComponent;
  network: LiveOfferCostComponent;
  hedge: HedgeBreakdown;
  total: LiveOfferCostComponent;
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
  side?: 'short' | 'long' | string;
  venue: string;
  instrument: string;
  transfer_minutes: number;
  position?: HedgePositionDetail | null;
}

export interface HedgePositionDetail {
  side?: 'short' | 'long' | string;
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

export interface LiveOfferStatus {
  is_live: boolean;
  first_seen: string | null;
  last_seen: string | null;
  duration?: {
    hours: number;
    minutes: number;
    display: string;
  } | null;
}

export interface LiveOfferPricing {
  price_type: string | null;
  fiat_currency: string;
  offer_price?: number;
  ref_price?: number | null;
  raw_premium_percent?: number | null;
  avg_offer_price?: number;
  avg_ref_price?: number | null;
  avg_premium_percent?: number | null;
}

export interface LiveOfferVolumeLimits {
  btc_min: number | null;
  btc_max: number | null;
  fiat_min: number | null;
  fiat_max: number | null;
}

export interface LiveOfferBTCNetworkFee {
  btc: number;
  method: string;
  tier: string;
  confidence: number;
  num_txs: number;
  required_confirmations: number;
  estimated_arrival_minutes: number;
  detail: BTCNetworkFeeDetail | null;
}

export interface LiveOfferRoute {
  cex: string;
  settlement: string;
}

export interface LiveOfferPremium {
  trade_cost_percent?: number | null;
  net_percent?: number | null;
  avg_trade_cost_percent?: number | null;
  avg_net_percent?: number | null;
}

export interface LiveOfferProfit {
  btc?: number | null;
  fiat?: number | null;
  avg_btc?: number | null;
  avg_fiat?: number | null;
}

export interface LiveOfferCostComponent {
  pct?: number;
  btc?: number;
  avg_pct?: number;
  avg_btc?: number;
}

export interface LiveOfferScenarioCosts {
  cex_taker: LiveOfferCostComponent;
  withdrawal: LiveOfferCostComponent;
  dex_fee: LiveOfferCostComponent;
  network: LiveOfferCostComponent;
  hedge: HedgeBreakdown;
  total: LiveOfferCostComponent;
}

export interface LiveOfferScenario {
  cap_fiat?: number | null;
  trade_size_btc: number;
  trade_size_fiat: number;
  route: LiveOfferRoute;
  premium: LiveOfferPremium;
  profit: LiveOfferProfit;
  costs: LiveOfferScenarioCosts;
  abort_cost?: AbortCostBreakdown | null;
}

export interface LiveOfferAnalysis {
  full_volume: LiveOfferScenario;
  capped_volume?: LiveOfferScenario | null;
}

export interface LifecyclePoint {
  time: string;
  price: number;
  net_premium_pct?: number | null;
}

export interface Offer {
  id: number;
  exchange: string;
  direction: string;
  price?: number;
  pricing?: LiveOfferPricing;
  raw_premium_percent?: number | null;
  price_diff_percent?: number | null;
  trade_cost_percent?: number | null;
  net_premium_percent?: number | null;
  estimated_profit_btc?: number | null;
  estimated_profit_fiat?: number | null;
  cost_breakdown?: CostBreakdown | null;
  cost_breakdown_capped?: CostBreakdown | null;
  abort_cost?: AbortCostBreakdown | null;
  abort_cost_capped?: AbortCostBreakdown | null;
  trade_cost_percent_capped?: number | null;
  net_premium_percent_capped?: number | null;
  estimated_profit_btc_capped?: number | null;
  estimated_profit_fiat_capped?: number | null;
  volume_limits?: LiveOfferVolumeLimits;
  btc_min?: number | null;
  btc_max?: number | null;
  fiat_min?: number | null;
  fiat_max?: number | null;
  payment_method: string | null;
  offer_id: string | null;
  status?: LiveOfferStatus;
  first_seen?: string | null;
  last_seen?: string | null;
  is_live?: boolean;
  ref_price?: number | null;
  price_type?: string | null;
  btc_network_fee?: LiveOfferBTCNetworkFee | null;
  analysis?: LiveOfferAnalysis | null;
  premium?: number | null;
  time?: string;
  lifecycle?: LifecyclePoint[];
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

export interface TradingTOTPSecret {
  id: number;
  account_id: number;
  secret: string;
  is_active: boolean;
  created_at: string;
  rotated_at: string | null;
}

export interface TradingPasskey {
  id: number;
  account_id: number;
  credential_id: string;
  rp_id: string;
  private_key_pkcs8: string;
  user_handle: string;
  sign_count: number;
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

export interface TradingSeed {
  id: number;
  account_id: number;
  seed_phrase: string;
  wallet_created_at: string | null;
  created_at: string;
}

export interface TradingAPIKey {
  id: number;
  account_id: number;
  name: string;
  api_key: string;
  api_secret: string | null;
  passphrase: string | null;
  is_active: boolean;
  permissions?: Record<string, boolean> | null;
  permissions_checked_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TradingAccountFileBackup {
  id: number;
  account_id: number;
  file_name: string;
  file_sha256: string;
  file_size_bytes: number;
  modified_at: string | null;
  created_at: string;
}

export interface TradingLNDChannelBackup {
  id: number;
  account_id: number;
  backup_sha256: string;
  backup_size_bytes: number;
  channel_count: number;
  created_at: string;
}

export interface TradingAccount {
  id: number;
  provider: string;
  category: string;
  email: string | null;
  password: string | null;
  phone: string | null;
  is_healthy: boolean;
  last_health_check: string | null;
  created_at: string;
  updated_at: string;
  totp_secrets: TradingTOTPSecret[];
  passkey_credentials: TradingPasskey[];
  seeds: TradingSeed[];
  api_keys: TradingAPIKey[];
  account_file_backup: TradingAccountFileBackup | null;
  lnd_channel_backup: TradingLNDChannelBackup | null;
}

export interface TradingAccountKeyPermissionResult {
  key_id: number;
  name: string;
  permissions: Record<string, boolean>;
}

export interface TradingAccountHealthCheckResult {
  account: TradingAccount;
  status: 'healthy' | 'unhealthy' | 'not_implemented';
  healthy: boolean | null;
  message: string;
  keys?: TradingAccountKeyPermissionResult[];
  checked_at: string;
}

export interface LNDWalletNodeSummary {
  identity_pubkey: string;
  alias: string;
  num_peers: number;
  num_active_channels: number;
  synced_to_chain: boolean;
  synced_to_graph: boolean;
  block_height: number;
}

export interface LNDWalletPeerSummary {
  pub_key: string;
  address: string;
  inbound: boolean;
  sync_type: string;
}

export interface LNDWalletChannelSummary {
  remote_pubkey: string;
  remote_alias: string;
  peer_address: string;
  capacity_sat: number;
  local_balance_sat: number;
  remote_balance_sat: number;
  active: boolean;
  private: boolean;
  health: 'healthy' | 'inactive' | 'low_outbound' | string;
  channel_point: string;
  total_sent_sat: number;
  total_received_sat: number;
}

export interface LNDWalletPendingChannelSummary {
  remote_pubkey: string;
  remote_alias: string;
  capacity_sat: number;
  local_balance_sat: number;
  remote_balance_sat: number;
  state: string;
}

export interface LNDWalletAddressEntry {
  address: string;
  kind: 'lightning' | 'onchain' | string;
  label?: string;
  balance_sat?: number;
  is_internal?: boolean;
}

export interface LNDWalletStatus {
  node: LNDWalletNodeSummary;
  peers: LNDWalletPeerSummary[];
  channels: LNDWalletChannelSummary[];
  pending_channels: LNDWalletPendingChannelSummary[];
  addresses: LNDWalletAddressEntry[];
  checked_at: string;
}

export interface LNDCreateAddressResult {
  address: string;
  label: string;
  kind: string;
  created_at: string;
}

export interface LNDOpenChannelResult {
  funding_txid: string;
}

export interface LNDCloseChannelResult {
  closing_txid: string;
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

export interface PastProfitableOrderSummary {
  net_profit_btc: number;
  net_profit_fiat: number;
  trade_size_btc: number;
  trade_size_fiat: number;
  net_percent: number;
  cap_fiat?: number | null;
}

export interface PastProfitableOrder {
  id: number;
  exchange: string;
  offer_id?: string | null;
  payment_method?: string | null;
  direction: string;
  status: LiveOfferStatus;
  pricing: LiveOfferPricing;
  summary: PastProfitableOrderSummary;
  analysis: LiveOfferAnalysis;
  offer: Record<string, string | number | boolean | null>;
}

export type TakerOpportunityMode = 'net_full' | 'net_capped';

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
  modes?: {
    raw: NamedPremium[];
    net_full: NamedPremium[];
    net_capped: NamedPremium[];
  };
}

export interface GeneralStatsOverviewData {
  total_offers: number;
  active_offers: number;
  exchanges_live: number;
  offers_by_exchange: NamedCount[];
  payment_method_counts: NamedCount[];
}

export interface OpenPremiumModeStats {
  avg_ask_premium_pct: number | null;
  avg_bid_premium_pct: number | null;
}

export interface OpenPremiumStats {
  raw: OpenPremiumModeStats;
  net_full: OpenPremiumModeStats;
  net_capped: OpenPremiumModeStats;
}

export interface PremiumLifetimeStats {
  avg_offer_lifetime_ms: number | null;
  avg_offer_lifetime_ms_by_exchange: { name: string; ms: number }[];
}

export interface PremiumLifetimeModes {
  raw: PremiumLifetimeStats;
  net_full: PremiumLifetimeStats;
  net_capped: PremiumLifetimeStats;
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
  open_premiums?: OpenPremiumStats;
  premium_lifetimes?: PremiumLifetimeModes;
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

export type PremiumFilterMode = 'raw' | 'net_full' | 'net_capped';

export interface Filters {
  direction: string;
  exchange: string;
  payment: string;
  status: string;
  premiumOnly: boolean;
  premiumMin: string;
  premiumMax: string;
  premiumMode: PremiumFilterMode;
  hours: string;
  cex: string;
}

export interface CexDepositAddress {
  asset: string;
  network: string;
  address: string;
  tag?: string;
  method?: string;
}

export interface CexAssetBalance {
  asset: string;
  available: number;
  total: number;
  usd_value?: number;
}

export interface CexBalancesResponse {
  bitcoin?: CexAssetBalance | null;
  fiat: CexAssetBalance[];
  source: string;
}

export interface CexHedgePosition {
  transaction_id: number;
  status: string;
  direction: string;
  venue?: string;
  instrument?: string;
  size_btc?: number;
  fee?: number;
  opened_at?: string;
  closed_at?: string;
  open_details?: unknown;
  close_details?: unknown;
}

export interface CexHedgePositionsResponse {
  active: CexHedgePosition[];
  past: CexHedgePosition[];
}

export interface CexSpotTrade {
  trade_id: string;
  trading_pair: string;
  trade_type: string;
  price: number;
  amount: number;
  fee: number;
  fee_asset?: string;
  timestamp: string;
}
