/**
 * Fetch wrapper: same-origin /api (Vite proxies to the backend), JSON
 * in/out, backend error envelopes become thrown ApiError objects.
 *
 * Auth: the access token lives in memory here; on a 401 the client tries
 * one silent refresh (httpOnly cookie) and retries the request once.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

let accessToken = '';
let onSession: (user: SessionUser | null, token: string) => void = () => {};

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export function setAccessToken(token: string) {
  accessToken = token;
}

/** The auth store registers here to hear about silent refreshes/expiry. */
export function onSessionChange(handler: typeof onSession) {
  onSession = handler;
}

/** POST /api/auth/refresh using the httpOnly cookie. */
export async function tryRefresh(): Promise<SessionUser | null> {
  const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
  if (!res.ok) {
    accessToken = '';
    onSession(null, '');
    return null;
  }
  const data = (await res.json()) as { user: SessionUser; accessToken: string };
  accessToken = data.accessToken;
  onSession(data.user, data.accessToken);
  return data.user;
}

async function request<T>(method: string, url: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const init: RequestInit = { method, headers, credentials: 'include' };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const res = await fetch(url, init);

  // Expired access token → one silent refresh + retry (never for auth calls).
  if (res.status === 401 && !retried && !url.startsWith('/api/auth/')) {
    const refreshed = await tryRefresh();
    if (refreshed) return request<T>(method, url, body, true);
  }

  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; details?: never } })?.error;
    throw new ApiError(err?.code ?? 'UNKNOWN', err?.message ?? res.statusText, res.status, err?.details);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
};
