import type {
  CexBalancesResponse,
  CexDepositAddress,
  CexWithdrawalAddress,
  CexHedgePositionsResponse,
  CexSpotTrade,
  LNDCloseChannelResult,
  LNDCreateAddressResult,
  LNDOpenChannelResult,
  LNDWalletStatus,
  TradingAccount,
  TradingAccountHealthCheckResult,
  TradingAPIKey,
  TradingPasskey,
  TradingSeed,
  TradingTOTPSecret,
} from '../types';

const API_BASE = '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const raw = await res.text();
    let message = raw.trim();
    if (message) {
      try {
        const body = JSON.parse(message) as { error?: string };
        if (body.error?.trim()) {
          message = body.error.trim();
        }
      } catch {
        // Keep plain-text error bodies as-is.
      }
    } else {
      message = `API error: ${res.status}`;
    }
    throw new Error(message);
  }
  return res.json();
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, init);
}

export async function apiPost<T>(path: string, body: unknown, init?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
  return request<T>(path, {
    ...init,
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function fetchTradingAccounts() {
  return request<TradingAccount[]>('/api/trading/accounts');
}

export function createAccount(payload: { provider: string; email: string; password: string; phone: string }) {
  return request<TradingAccount>('/api/trading/accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAccount(id: number, payload: { provider: string; email: string; password: string; phone: string }) {
  return request<TradingAccount>(`/api/trading/accounts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
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

export function fetchLNDWalletStatus() {
  return request<LNDWalletStatus>('/api/mm-controller/lnd/wallet');
}

export function createLNDWalletAddress(label?: string) {
  return request<LNDCreateAddressResult>('/api/mm-controller/lnd/addresses', {
    method: 'POST',
    body: JSON.stringify({ label: label?.trim() ?? '' }),
  });
}

export function openLNDChannel(payload: {
  node_pubkey: string;
  peer_host?: string;
  local_funding_amount_sat: number;
  push_sat?: number;
  sat_per_vbyte?: number;
  private?: boolean;
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
