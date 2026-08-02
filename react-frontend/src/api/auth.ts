import { request } from './client';

export interface AuthUser {
  username: string;
}

export function authMe() {
  return request<AuthUser>('/api/auth/me');
}

export function authLogin(username: string, password: string) {
  return request<AuthUser>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function authRegister(username: string, password: string) {
  return request<AuthUser>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export function authLogout() {
  return request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' });
}

export function authRegistrationAvailable() {
  return request<{ available: boolean }>('/api/auth/registration_available');
}
