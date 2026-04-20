import type {
  TradingAccount,
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
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function apiFetch<T>(path: string): Promise<T> {
  return request<T>(path);
}

export function fetchTradingAccounts() {
  return request<TradingAccount[]>('/api/trading/accounts');
}

export function createAccount(payload: { provider: string; email: string; password: string }) {
  return request<TradingAccount>('/api/trading/accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateAccount(id: number, payload: { provider: string; email: string; password: string }) {
  return request<TradingAccount>(`/api/trading/accounts/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteAccount(id: number) {
  return request<{ ok: boolean }>(`/api/trading/accounts/${id}`, { method: 'DELETE' });
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
