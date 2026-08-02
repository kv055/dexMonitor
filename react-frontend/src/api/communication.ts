import { request } from './client';

export interface TelegramConfig {
  bot_token_present: boolean;
  chat_id: string;
  dexmm_webhook_url: string;
  pushpush_webhook_url: string;
  dexmm_webhook_set: boolean;
  pushpush_webhook_set: boolean;
  config_version: number;
}

export type TelegramService = 'dexmm' | 'pushpush';

export interface TelegramActionResult {
  ok: boolean;
  detail?: string;
  url?: string;
}

export interface TelegramPairing {
  deep_link: string;
  expires_at: string;
}

export function fetchTelegramConfig() {
  return request<TelegramConfig>('/api/mm-controller/telegram/config');
}

export function saveTelegramConfig(payload: {
  bot_token?: string;
  chat_id?: string;
  dexmm_webhook_url?: string;
  pushpush_webhook_url?: string;
}) {
  return request<TelegramConfig>('/api/mm-controller/telegram/config', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function setTelegramWebhook(service: TelegramService) {
  return request<TelegramActionResult>(`/api/mm-controller/telegram/set-webhook?service=${service}`, { method: 'POST' });
}

export function createTelegramPairing() {
  return request<TelegramPairing>('/api/mm-controller/telegram/pair', { method: 'POST' });
}

export function testTelegram(service: TelegramService) {
  return request<TelegramActionResult>(`/api/mm-controller/telegram/test?service=${service}`, { method: 'POST' });
}

export interface PhoneCallbackAttempt {
  received_at: string;
  endpoint: string;
  outcome: 'accepted' | 'blocked' | 'invalid' | 'error';
  status_code: number;
  device_id?: string;
  app?: string;
  detail?: string;
}

export interface PhonePushSetup {
  notify_url: string;
  heartbeat_url: string;
  notify_credential_configured: boolean;
  heartbeat_credential_configured: boolean;
  online: boolean;
  device_id: string;
  last_seen: string;
  max_age_seconds: number;
  heartbeat_status_error?: string;
  callback_history: PhoneCallbackAttempt[];
  callback_history_error?: string;
}

export interface PhonePushSecrets {
  shared_secret: string;
}

export function fetchPhonePushSetup() {
  return request<PhonePushSetup>('/api/phone-push/setup');
}

export function revealPhonePushSecrets() {
  return request<PhonePushSecrets>('/api/phone-push/setup/reveal', { method: 'POST' });
}
