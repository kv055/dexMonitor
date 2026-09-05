import type { components } from '../generated/monitor-api';

type Schemas = components['schemas'];

export type CexPreTradeCheckRequest = Schemas['CexPreTradeCheckRequest'];
export type PreTradeCheckResult = Schemas['PreTradeCheckResult'];
export type PreTradeCheckReport = Schemas['PreTradeCheckReport'];
export type CexTradeflowRequest = Schemas['CexTradeflowRequest'];
export type CexTradeflowResult = Schemas['CexTradeflowResult'];
export type ResolvedRoute = Schemas['ResolvedRoute'];
export type FeeLine = Schemas['FeeLine'];
export type ExecutionDetail = Schemas['ExecutionDetail'];
export type CexSpotBuyResult = Schemas['CexSpotBuyResult'];
export type CexHedgeOpenResult = Schemas['CexHedgeOpenResult'];
export type MMTransactionStatus = Schemas['MMTransactionStatus'];
export type WithdrawalTrackResult = Schemas['WithdrawalTrackResult'];
export type MempoolTxStatus = Schemas['MempoolTxStatus'];
export type CexDepositAddress = Schemas['CexDepositAddress'];
export type CexWithdrawalAddress = Schemas['CexWithdrawalAddress'];
export type CexSpotTrade = Schemas['CexSpotTrade'];
