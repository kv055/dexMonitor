import { apiPost, request } from './client';
import type {
  CexPreTradeCheckRequest,
  CexTradeflowRequest,
  CexTradeflowResult,
  MMTransactionStatus,
  PreTradeCheckReport,
  WithdrawalTrackResult,
} from './mmControllerContract';

export function cexPreTradeCheck(payload: CexPreTradeCheckRequest) {
  return apiPost<PreTradeCheckReport>('/api/mm-controller/cex/pre-trade-check', payload);
}

export function cexTradeflow(payload: CexTradeflowRequest) {
  return apiPost<CexTradeflowResult>('/api/mm-controller/cex/tradeflow', payload);
}

export function fetchMMTransaction(id: number) {
  return request<MMTransactionStatus>(`/api/mm-controller/transactions/${id}`);
}

export function cexWithdrawalTrack(provider: string, withdrawalId: string, clientRequestId?: string) {
  const params = new URLSearchParams({ provider, withdrawal_id: withdrawalId });
  if (clientRequestId) params.set('client_request_id', clientRequestId);
  return request<WithdrawalTrackResult>(`/api/mm-controller/cex/withdrawal-track?${params}`);
}
