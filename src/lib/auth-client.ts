export interface Account {
  id: string; username: string; displayName: string;
  role: "admin" | "user"; status: "pending" | "active" | "rejected" | "suspended";
  version: number; createdAt: number; reviewedAt: number | null; mustChangePassword: number;
}
export interface Session { user: Account | null; scope: "full" | "pending" | "password_change" | null }
export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string) { super(message); }
}
let csrf: Promise<string> | null = null;
let generation = new AbortController();
let installed = false;
let accountId: string | null = null;

export function bindAccount(id: string | null) { accountId = id; }

export function clearAccountRequests() {
  generation.abort(); generation = new AbortController(); csrf = null; accountId = null;
}

export function installAuthenticatedFetch() {
  if (installed || location.protocol === "file:") return;
  installed = true;
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('genforecast-session') : null;
  channel?.addEventListener('message', () => {
    clearAccountRequests();
    window.dispatchEvent(new Event('genforecast-session-invalid'));
  });
  const native = window.fetch.bind(window);
  const getCsrf = () => csrf ??= native('/api/auth/csrf', { credentials: 'same-origin', cache: 'no-store' })
    .then(async r => { if (!r.ok) throw new Error('요청 확인 정보를 받지 못했습니다.'); return (await r.json()).token as string; })
    .catch(e => { csrf = null; throw e; });
  window.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return native(input, init);
    const request = new Request(input, init);
    const signal = AbortSignal.any([request.signal, generation.signal]);
    const headers = new Headers(request.headers);
    // Capture before awaiting CSRF: another tab may change the shared session cookie.
    if (accountId && (!url.pathname.startsWith('/api/auth/') || ['/api/auth/password', '/api/auth/logout', '/api/auth/reauthenticate'].includes(url.pathname)))
      headers.set('X-Account-ID', accountId);
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (mutation) headers.set('X-CSRF-Token', await getCsrf());
    const retry = request.clone();
    let response = await native(request, { headers, credentials: 'same-origin', signal, cache: 'no-store' });
    let error = response.status === 403 ? await response.clone().json().catch(() => ({})) : null;
    if (mutation && error?.code === 'csrf_failed') {
      csrf = null; headers.set('X-CSRF-Token', await getCsrf());
      response = await native(retry, { headers, credentials: 'same-origin', signal, cache: 'no-store' });
      error = response.status === 403 ? await response.clone().json().catch(() => ({})) : null;
    }
    if (error?.code === 'account_changed' || !url.pathname.startsWith('/api/auth/') && (response.status === 401 || error?.code === 'approval_required')) {
      window.dispatchEvent(new Event('genforecast-session-invalid'));
    }
    if (response.ok && ['/api/auth/login', '/api/auth/logout', '/api/auth/password'].includes(url.pathname)) {
      csrf = null;
      channel?.postMessage('changed');
    }
    return response;
  };
}

export async function authJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers }, signal: options?.signal ?? AbortSignal.timeout(15000) });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(value?.detail || '서버 요청을 처리하지 못했습니다.', response.status, value?.code || 'request_failed');
  if (!value) throw new Error('서버 응답을 확인해 주세요.');
  return value as T;
}
