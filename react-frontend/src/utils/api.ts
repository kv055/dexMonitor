import type {
  CexBalancesResponse,
  CexDepositAddress,
  CexWithdrawalAddress,
  CexHedgePositionsResponse,
  CexSpotTrade,
  LNDCloseChannelResult,
  LNDCreateAddressResult,
  LNDOpenChannelResult,
  LNDChannelPresetsResponse,
  LNDWalletInitResult,
  LNDWalletState,
  LNDWalletStatus,
  LSPChannelConfig,
  LSPChannelStatus,
  SubmarineSwapRecord,
  ServiceVersions,
  TradingAccount,
  TradingAccountCredentialReveal,
  TradingAccountHealthCheckResult,
  TradingAPIKey,
  TradingPasskey,
  TradingSeed,
  TradingTOTPSecret,
  TradingBankAccount,
  PaymentMethodRow,
  PaymentMethodUpdatePayload,
  PaymentMethodChatTemplate,
  TradingWalletAddress,
  BisqPaymentAccount,
  BisqPaymentMethod,
  BisqPaymentAccountForm,
  BisqCreatePaymentAccountPayload,
  TransactionalLiquiditySettings,
  DexPendingLiquidity,
} from '../types';
import { fetchResponse, request } from '../api/client';
export { apiFetch, apiPost, apiPostWithHeaders } from '../api/client';
export type { ApiResponseWithHeaders } from '../api/client';

export function fetchTradingAccounts() {
  return request<TradingAccount[]>('/api/trading/accounts');
}

export function revealTradingAccountCredentials(id: number) {
  return request<TradingAccountCredentialReveal>(`/api/trading/accounts/${id}/credentials`);
}

export function revealTradingAccountSecrets(id: number) {
  return request<TradingAccount>(`/api/trading/accounts/${id}/secrets`);
}

export async function downloadBisqAccountFile(id: number) {
  const response = await fetchResponse(`/api/trading/accounts/${id}/bisq-account-file`);
  return response.blob();
}

type AccountWritePayload = {
  provider: string;
  category?: string;
  email: string;
  password: string;
  phone: string;
  payment_tag: string;
  notification_channels?: Array<'push' | 'email'>;
  is_active?: boolean;
};

export function createAccount(payload: AccountWritePayload) {
  return request<TradingAccount>('/api/trading/accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAccount(id: number, payload: AccountWritePayload) {
  return request<TradingAccount>(`/api/trading/accounts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function reorderPaymentAccounts(accountIds: number[]) {
  return request<{ ok: boolean }>('/api/trading/accounts/priorities', {
    method: 'PUT',
    body: JSON.stringify({ account_ids: accountIds }),
  });
}

export function deleteAccount(id: number) {
  return request<{ ok: boolean }>(`/api/trading/accounts/${id}`, { method: 'DELETE' });
}

export function runAccountHealthCheck(id: number) {
  return request<TradingAccountHealthCheckResult>(`/api/trading/accounts/${id}/health_check`, {
    method: 'POST',
  });
}

export function createTOTPSecret(accountId: number, payload: { secret: string; is_active: boolean }) {
  return request<TradingTOTPSecret>(`/api/trading/accounts/${accountId}/totp_secrets`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateTOTPSecret(id: number, payload: { secret: string; is_active: boolean }) {
  return request<TradingTOTPSecret>(`/api/trading/totp_secrets/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteTOTPSecret(id: number) {
  return request<{ ok: boolean }>(`/api/trading/totp_secrets/${id}`, { method: 'DELETE' });
}

export function createPasskey(accountId: number, payload: Omit<TradingPasskey, 'id' | 'account_id' | 'created_at'>) {
  return request<TradingPasskey>(`/api/trading/accounts/${accountId}/passkey_credentials`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updatePasskey(id: number, payload: Omit<TradingPasskey, 'id' | 'account_id' | 'created_at'>) {
  return request<TradingPasskey>(`/api/trading/passkey_credentials/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deletePasskey(id: number) {
  return request<{ ok: boolean }>(`/api/trading/passkey_credentials/${id}`, { method: 'DELETE' });
}

export function createSeed(accountId: number, payload: Omit<TradingSeed, 'id' | 'account_id' | 'created_at'>) {
  return request<TradingSeed>(`/api/trading/accounts/${accountId}/seeds`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateSeed(id: number, payload: Omit<TradingSeed, 'id' | 'account_id' | 'created_at'>) {
  return request<TradingSeed>(`/api/trading/seeds/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteSeed(id: number) {
  return request<{ ok: boolean }>(`/api/trading/seeds/${id}`, { method: 'DELETE' });
}

export function createAPIKey(accountId: number, payload: Omit<TradingAPIKey, 'id' | 'account_id' | 'created_at' | 'updated_at'>) {
  return request<TradingAPIKey>(`/api/trading/accounts/${accountId}/api_keys`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAPIKey(id: number, payload: Omit<TradingAPIKey, 'id' | 'account_id' | 'created_at' | 'updated_at'>) {
  return request<TradingAPIKey>(`/api/trading/api_keys/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteAPIKey(id: number) {
  return request<{ ok: boolean }>(`/api/trading/api_keys/${id}`, { method: 'DELETE' });
}

export function createBankAccount(accountId: number, payload: Omit<TradingBankAccount, 'id' | 'account_id' | 'created_at' | 'updated_at'>) {
  return request<TradingBankAccount>(`/api/trading/accounts/${accountId}/bank_accounts`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateBankAccount(id: number, payload: Omit<TradingBankAccount, 'id' | 'account_id' | 'created_at' | 'updated_at'>) {
  return request<TradingBankAccount>(`/api/trading/bank_accounts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteBankAccount(id: number) {
  return request<{ ok: boolean }>(`/api/trading/bank_accounts/${id}`, { method: 'DELETE' });
}

export function fetchLNDWalletStatus() {
  return request<LNDWalletStatus>('/api/mm-controller/lnd/wallet');
}

export function fetchDexPendingLiquidity() {
  return request<DexPendingLiquidity>('/api/mm-controller/transactions/dex-pending-liquidity');
}

export function fetchTransactionalLiquiditySettings() {
  return request<TransactionalLiquiditySettings>('/api/mm-controller/transactional-liquidity');
}

export function updateTransactionalLiquiditySettings(payload: {
  fiat_currency: string;
  amount_source: 'custom' | 'capped_volume';
  custom_amount: number | null;
  trade_mode: 'hedgefull_single_collateral' | 'hedgeless_double_collateral';
  target_direction: 'bid' | 'ask';
}) {
  return request<TransactionalLiquiditySettings>('/api/mm-controller/transactional-liquidity', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function fetchLNDWalletState() {
  return request<LNDWalletState>('/api/mm-controller/lnd/wallet/state');
}

export function fetchLNDChannelPresets() {
  return request<LNDChannelPresetsResponse>('/api/mm-controller/lnd/channel-presets');
}

export function fetchServiceVersions() {
  return request<ServiceVersions>('/api/mm-controller/service-versions');
}

export function initLNDWallet() {
  return request<LNDWalletInitResult>('/api/mm-controller/lnd/wallet/init', {
    method: 'POST',
  });
}

export function createLNDWalletAddress(label?: string) {
  return request<LNDCreateAddressResult>('/api/mm-controller/lnd/addresses', {
    method: 'POST',
    body: JSON.stringify({ label: label?.trim() ?? '' }),
  });
}

export function openLNDChannel(payload: {
  preset_id?: string;
  node_pubkey?: string;
  peer_host?: string;
  local_funding_amount_sat: number;
  push_sat?: number;
  sat_per_vbyte?: number;
  target_conf?: number;
  private?: boolean;
  allow_additional_channel?: boolean;
}) {
  return request<LNDOpenChannelResult>('/api/mm-controller/lnd/channels/open', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function closeLNDChannel(payload: {
  channel_point: string;
  force?: boolean;
  sat_per_vbyte?: number;
}) {
  return request<LNDCloseChannelResult>('/api/mm-controller/lnd/channels/close', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function fetchLSPChannel(){return request<LSPChannelConfig>('/api/mm-controller/lnd/lsp-channel')}
export function updateLSPChannel(payload:LSPChannelConfig){return request<LSPChannelConfig>('/api/mm-controller/lnd/lsp-channel',{method:'PUT',body:JSON.stringify(payload)})}
export function fetchLSPChannelStatus(){return request<LSPChannelStatus>('/api/mm-controller/lnd/lsp-channel/status')}
export function fetchSubmarineSwaps(){return request<SubmarineSwapRecord[]>('/api/mm-controller/lnd/submarine-swaps?limit=20')}

export function fetchCexDepositAddresses(accountId: number) {
  return request<CexDepositAddress[]>(`/api/trading/accounts/${accountId}/cex/deposit-addresses`);
}

export function fetchCexWithdrawalAddresses(accountId: number) {
  return request<CexWithdrawalAddress[]>(`/api/trading/accounts/${accountId}/cex/withdrawal-addresses`);
}

export function fetchCexBalances(accountId: number) {
  return request<CexBalancesResponse>(`/api/trading/accounts/${accountId}/cex/balances`);
}

export function fetchCexHedgePositions(accountId: number) {
  return request<CexHedgePositionsResponse>(`/api/trading/accounts/${accountId}/cex/hedge-positions`);
}

export function fetchCexSpotTrades(accountId: number, limit = 50) {
  return request<CexSpotTrade[]>(`/api/trading/accounts/${accountId}/cex/spot-trades?limit=${limit}`);
}

export function fetchPaymentMethods() {
  return request<{ payment_methods: PaymentMethodRow[] }>('/api/trading/payment_methods');
}

export function updatePaymentMethod(id: number, payload: PaymentMethodUpdatePayload) {
  return request<{ payment_methods: PaymentMethodRow[] }>(`/api/trading/payment_methods/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function degradePaymentMethodToAlias(id: number, providerId: number) {
  return request<{ payment_methods: PaymentMethodRow[] }>(
    `/api/trading/payment_methods/${id}/degrade-to-alias/${providerId}`,
    { method: 'POST' },
  );
}

export function promotePaymentMethodAlias(id: number, alias: string) {
  return request<{ payment_methods: PaymentMethodRow[] }>(
    `/api/trading/payment_methods/${id}/aliases/promote`,
    { method: 'POST', body: JSON.stringify({ alias }) },
  );
}

export function deletePaymentMethod(id: number) {
  return request<{ ok: boolean }>(`/api/trading/payment_methods/${id}`, { method: 'DELETE' });
}

export function fetchPaymentMethodChatTemplates(id: number) {
  return request<{ chat_templates: PaymentMethodChatTemplate[] }>(`/api/trading/payment_methods/${id}/chat_templates`);
}

export function updatePaymentMethodChatTemplate(
  id: number,
  exchange: string,
  payload: { template: string; is_active: boolean; trade_direction: 'bid' | 'ask' },
) {
  return request<{ chat_templates: PaymentMethodChatTemplate[] }>(
    `/api/trading/payment_methods/${id}/chat_templates/${encodeURIComponent(exchange)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    },
  );
}

export function deletePaymentMethodChatTemplate(id: number, exchange: string, tradeDirection: 'bid' | 'ask') {
  return request<{ ok: boolean }>(
    `/api/trading/payment_methods/${id}/chat_templates/${encodeURIComponent(exchange)}?trade_direction=${tradeDirection}`,
    { method: 'DELETE' },
  );
}

export function fetchTradingWalletAddresses() {
  return request<{ wallet_addresses: TradingWalletAddress[] }>('/api/trading/wallet_addresses');
}

// --- Bisq1 payment-account profile (proxied to dexMmController) ---

export function fetchBisqPaymentAccounts() {
  return request<{ payment_accounts: BisqPaymentAccount[] }>('/api/mm-controller/bisq/payment-accounts');
}

export function fetchBisqPaymentMethods() {
  return request<{ payment_methods: BisqPaymentMethod[] }>('/api/mm-controller/bisq/payment-methods');
}

export function fetchBisqPaymentAccountForm(paymentMethodId: string) {
  return request<BisqPaymentAccountForm>(
    `/api/mm-controller/bisq/payment-methods/${encodeURIComponent(paymentMethodId)}/form`,
  );
}

export function createBisqPaymentAccount(payload: BisqCreatePaymentAccountPayload) {
  return request<BisqPaymentAccount>('/api/mm-controller/bisq/payment-accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteBisqPaymentAccount(id: string) {
  return request<{ ok: boolean }>(`/api/mm-controller/bisq/payment-accounts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
