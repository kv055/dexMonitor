const AUTH_UNAVAILABLE_MESSAGE =
  'The login service is temporarily unavailable. Your credentials were not checked. Please try again in a moment.';

function isAuthEndpoint(path: string): boolean {
  return path.startsWith('/api/auth/');
}

export interface ApiResponseWithHeaders<T> {
  data: T;
  headers: Headers;
}

export async function fetchResponse(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (error) {
    if (isAuthEndpoint(path)) throw new Error(AUTH_UNAVAILABLE_MESSAGE);
    throw error;
  }

  if (response.ok) return response;
  if (response.status === 401 && !isAuthEndpoint(path)) {
    window.dispatchEvent(new Event('auth:unauthorized'));
  }
  if (isAuthEndpoint(path) && [502, 503, 504].includes(response.status)) {
    throw new Error(AUTH_UNAVAILABLE_MESSAGE);
  }

  const raw = await response.text();
  let message = raw.trim();
  if (message) {
    try {
      const body = JSON.parse(message) as { error?: string };
      if (body.error?.trim()) message = body.error.trim();
    } catch {
      // Plain-text error bodies already contain the most useful message.
    }
  } else {
    message = `API error: ${response.status}`;
  }
  throw new Error(message);
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
