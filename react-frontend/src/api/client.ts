const AUTH_UNAVAILABLE_MESSAGE =
  'The login service is temporarily unavailable. Your credentials were not checked. Please try again in a moment.';

const NETWORK_MESSAGE =
  'Could not reach the dashboard server. Check your connection; if it keeps happening, the server may be restarting.';

function isAuthEndpoint(path: string): boolean {
  return path.startsWith('/api/auth/');
}

export interface ApiResponseWithHeaders<T> {
  data: T;
  headers: Headers;
}

/**
 * A failed API call. `message` is written for the operator; the backend's
 * stable `code`, the technical `detail`, the failed trade `leg` and the log
 * `ref` are kept separately so the UI can branch on them or show them on demand.
 */
export class ApiError extends Error {
  /** HTTP status, or 0 when the server could not be reached at all. */
  readonly status: number;
  readonly code?: string;
  readonly detail?: string;
  readonly leg?: string;
  readonly ref?: string;

  constructor(message: string, options: { status: number; code?: string; detail?: string; leg?: string; ref?: string; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.status = options.status;
    this.code = options.code;
    this.detail = options.detail;
    this.leg = options.leg;
    this.ref = options.ref;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** The operator-facing message of any thrown value. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
}

/** The backend's stable error code, if the error came from the API. */
export function errorCode(error: unknown): string | undefined {
  return isApiError(error) ? error.code : undefined;
}

/** Explains an error response that carries no readable message of its own. */
export function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'The server could not process this request (HTTP 400). Reload the page and try again.';
    case 403:
      return "You don't have permission to do this (HTTP 403).";
    case 404:
      return 'The dashboard server does not know this endpoint (HTTP 404). Reload the page; if it keeps happening, the frontend and server may be running different releases.';
    case 408:
    case 504:
      return `A backend service took too long to answer (HTTP ${status}). Try again in a moment.`;
    case 413:
      return 'This request is too large for the server (HTTP 413).';
    case 429:
      return 'Too many requests right now (HTTP 429). Wait a moment and try again.';
    case 500:
      return 'The dashboard server hit an internal error (HTTP 500). Try again; if it keeps happening, check the server log.';
    case 502:
      return 'A backend service is not responding (HTTP 502). It may be restarting; try again in a moment.';
    case 503:
      return 'A backend service is temporarily unavailable (HTTP 503). It may still be starting; try again in a moment.';
    default:
      return `The server answered with an unexpected error (HTTP ${status}).`;
  }
}

const MAX_TEXT_MESSAGE = 400;

function htmlTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match?.[1]?.replace(/\s+/g, ' ').trim();
  return title || undefined;
}

/** Turns an error response body (JSON, plain text, HTML or empty) into an ApiError. */
export function apiErrorFromBody(status: number, raw: string, contentType = ''): ApiError {
  const text = raw.trim();
  if (!text) return new ApiError(messageForStatus(status), { status });

  if (text.startsWith('{')) {
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      const str = (key: string) => (typeof body[key] === 'string' && (body[key] as string).trim() ? (body[key] as string).trim() : undefined);
      const message = str('error') ?? str('message') ?? str('detail');
      if (message) {
        return new ApiError(message, {
          status,
          code: str('code'),
          detail: message === str('detail') ? undefined : str('detail'),
          leg: str('leg'),
          ref: str('ref'),
        });
      }
      return new ApiError(messageForStatus(status), { status, detail: text.slice(0, MAX_TEXT_MESSAGE) });
    } catch {
      // Not JSON after all; handled as text below.
    }
  }

  if (contentType.includes('text/html') || /^<(!doctype|html|head|body)/i.test(text)) {
    return new ApiError(messageForStatus(status), { status, detail: htmlTitle(text) });
  }

  // Plain-text bodies are short server messages; a very long one is a stack or a page.
  if (text.length > MAX_TEXT_MESSAGE) {
    return new ApiError(messageForStatus(status), { status, detail: `${text.slice(0, MAX_TEXT_MESSAGE)}…` });
  }
  return new ApiError(text, { status });
}

export async function fetchResponse(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    if (isAuthEndpoint(path)) throw new Error(AUTH_UNAVAILABLE_MESSAGE, { cause: error });
    throw new ApiError(NETWORK_MESSAGE, { status: 0, detail: error instanceof Error ? error.message : String(error), cause: error });
  }

  if (response.ok) return response;
  if (response.status === 401 && !isAuthEndpoint(path)) {
    window.dispatchEvent(new Event('auth:unauthorized'));
  }
  if (isAuthEndpoint(path) && [502, 503, 504].includes(response.status)) {
    throw new Error(AUTH_UNAVAILABLE_MESSAGE);
  }

  const raw = await response.text().catch(() => '');
  throw apiErrorFromBody(response.status, raw, response.headers.get('Content-Type') ?? '');
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchResponse(path, init);
  return response.json() as Promise<T>;
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  return request<T>(path, init);
}

export async function apiPost<T>(path: string, body: unknown, init?: Omit<RequestInit, 'method' | 'body'>): Promise<T> {
  return request<T>(path, { ...init, method: 'POST', body: JSON.stringify(body) });
}

export async function apiPostWithHeaders<T>(
  path: string,
  body: unknown,
  init?: Omit<RequestInit, 'method' | 'body'>,
): Promise<ApiResponseWithHeaders<T>> {
  const response = await fetchResponse(path, { ...init, method: 'POST', body: JSON.stringify(body) });
  return { data: await response.json() as T, headers: response.headers };
}
