import { apiPost, request } from './client';
import type {
  CexPreTradeCheckRequest,
  CexTradeflowRequest,
  CexTradeflowAccepted,
  CexTradeflowResult,
  MMTransactionStatus,
  PreTradeCheckReport,
  ResolvedRoute,
  WithdrawalTrackResult,
} from './mmControllerContract';

export function cexPreTradeCheck(payload: CexPreTradeCheckRequest) {
  return apiPost<PreTradeCheckReport>('/api/mm-controller/cex/pre-trade-check', payload);
}

export function quoteBisqExecution(payload: {
  offer_id: string;
  btc_amount_sats?: number;
  btc_amount?: number;
  trade_mode: string;
  payment_method?: string;
  payment_methods?: string[];
  fiat_currency?: string;
  provider: string;
  resolved_route: CexTradeflowRequest['resolved_route'];
  selected_offer?: Record<string, unknown>;
  max_cex_fiat_spend?: number;
  max_wallet_debit_sats?: number;
  min_fiat_proceeds?: number;
}) {
  return apiPost<{
    quote_id: string;
    expires_at: string;
    trade_mode: string;
    payment_account_id: string;
    funding_address: string;
    trade_amount_sats: number;
    security_deposit_sats: number;
    taker_fee_sats: number;
    mining_fee_sats: number;
    total_to_pay_sats: number;
    hedgeless_network_fee_sats?: number;
    fiat_amount: number;
    volume?: string;
    limits: { max_cex_fiat_spend?: number; max_wallet_debit_sats?: number; min_fiat_proceeds?: number };
    is_btc_wallet_funded: boolean;
    missing_sats: number;
  }>('/api/mm-controller/bisq/execution/quote', payload);
}

export function cexTradeflow(payload: CexTradeflowRequest & { quote_id?: string; idempotency_key?: string }) {
  return apiPost<CexTradeflowResult | CexTradeflowAccepted | (CexTradeflowResult & { accepted?: boolean; stage?: string })>('/api/mm-controller/cex/tradeflow', payload);
}

export type BisqAcceptance = { quote_id: string; idempotency_key: string };
export function acceptBisqExecution(payload: BisqAcceptance) {
  return apiPost<{ accepted: boolean; transaction_id: number; stage: string }>(
    '/api/mm-controller/bisq/execution/accept', payload,
  );
}

export interface ExecutionQuote {
  quote_id: string;
  expires_at: string;
  venue_coordinator_id?: string;
  offer_id: string;
  payment_method: string;
  fiat_amount: number;
  btc_amount: number;
  max_bond_sat: number;
  max_escrow_sat: number;
  bond_fee_sat: number;
  escrow_fee_sat: number;
  resolved_route?: ResolvedRoute;
  executable: boolean;
  blocked_reason?: string;
}

export function createExecutionQuote(payload: {
  offer_db_id: number;
  offer_id?: string;
  exchange: string;
  venue_coordinator_id?: string;
  amount: string;
  unit: 'btc' | 'fiat';
  payment_method?: string;
}) {
  return apiPost<ExecutionQuote>('/api/execution-quotes', payload);
}

export function fetchMMTransaction(id: number) {
  return request<MMTransactionStatus>(`/api/mm-controller/transactions/${id}`);
}

export function cexWithdrawalTrack(provider: string, withdrawalId: string, clientRequestId?: string) {
  const params = new URLSearchParams({ provider, withdrawal_id: withdrawalId });
  if (clientRequestId) params.set('client_request_id', clientRequestId);
  return request<WithdrawalTrackResult>(`/api/mm-controller/cex/withdrawal-track?${params}`);
}
