import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPost, fetchResponse } from './client';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API client', () => {
  it('serializes JSON requests through the shared client', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiPost<{ ok: boolean }>('/api/example', { value: 42 })).resolves.toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"value":42}');
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('reports API error messages and broadcasts non-authentication 401s', async () => {
    const unauthorized = vi.fn();
    window.addEventListener('auth:unauthorized', unauthorized);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"Session expired"}', {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })));

    await expect(fetchResponse('/api/private')).rejects.toThrow('Session expired');
    expect(unauthorized).toHaveBeenCalledOnce();
    window.removeEventListener('auth:unauthorized', unauthorized);
  });
});
