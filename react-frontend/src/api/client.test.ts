import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiErrorFromBody, apiPost, errorCode, errorMessage, fetchResponse } from './client';

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

describe('API errors', () => {
  const respond = (body: string, status: number, contentType = 'application/json') =>
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': contentType } })));

  it('keeps the operator message, code, detail, leg and reference of a structured error', async () => {
    respond('{"error":"Opening the hedge on kraken failed.","code":"hedge_failed","detail":"kraken futures: HTTP 400","leg":"hedge","ref":"ab12"}', 502);
    const error = await fetchResponse('/api/mm-controller/cex/tradeflow').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ message: 'Opening the hedge on kraken failed.', status: 502, code: 'hedge_failed', detail: 'kraken futures: HTTP 400', leg: 'hedge', ref: 'ab12' });
  });

  it('explains proxy error pages instead of showing their HTML', async () => {
    respond('<html><head><title>502 Bad Gateway</title></head><body><center>nginx</center></body></html>', 502, 'text/html');
    const error = await fetchResponse('/api/x').catch((e: unknown) => e) as ApiError;
    expect(error.message).toBe('A backend service is not responding (HTTP 502). It may be restarting; try again in a moment.');
    expect(error.detail).toBe('502 Bad Gateway');
  });

  it('keeps short plain-text messages and explains empty bodies', async () => {
    respond('offer is not currently live\n', 404, 'text/plain');
    await expect(fetchResponse('/api/x')).rejects.toThrow('offer is not currently live');
    respond('', 504, 'text/plain');
    await expect(fetchResponse('/api/x')).rejects.toThrow('A backend service took too long to answer (HTTP 504). Try again in a moment.');
  });

  it('explains an unreachable server and keeps the browser reason as detail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await fetchResponse('/api/x').catch((e: unknown) => e) as ApiError;
    expect(error).toMatchObject({ status: 0, detail: 'Failed to fetch' });
    expect(error.message).toMatch(/^Could not reach the dashboard server/);
    expect(errorMessage(error)).toBe(error.message);
    expect(errorCode(error)).toBeUndefined();
  });

  it('lets aborted requests through unchanged', async () => {
    const abort = new DOMException('The operation was aborted.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    await expect(fetchResponse('/api/x')).rejects.toBe(abort);
  });

  it('builds messages from status alone when nothing else is available', () => {
    expect(apiErrorFromBody(503, '').message).toMatch(/temporarily unavailable \(HTTP 503\)/);
    expect(apiErrorFromBody(500, 'x'.repeat(1000)).message).toMatch(/internal error \(HTTP 500\)/);
    expect(apiErrorFromBody(409, '{"detail":"only detail"}').message).toBe('only detail');
  });
});
