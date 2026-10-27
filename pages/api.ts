// This is the public API address, not a key. No secret belongs in VITE_* values.
const endpoint = (import.meta.env.VITE_CUP_API_URL || '').replace(/\/$/, '');
const sessionKey = 'xingchen-editor-session';
let token = '';
let cachedSnapshot: { etag: string; body: unknown } | undefined;
try { token = sessionStorage.getItem(sessionKey) || ''; } catch { /* Storage may be disabled. */ }

function remember(value: string) {
  token = value;
  try { if (value) sessionStorage.setItem(sessionKey, value); else sessionStorage.removeItem(sessionKey); } catch { /* Keep the session in memory. */ }
}

export async function request<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  if (!endpoint) throw new Error('共享比分接口尚未配置，请联系维护者。');
  const method = (options.method || 'GET').toUpperCase();
  const headers = new Headers(options.headers);
  if (options.body) headers.set('Content-Type', 'application/json');
  if (token && path !== '/api/tournament') headers.set('Authorization', `Bearer ${token}`);
  if (token && method === 'PATCH') headers.set('Authorization', `Bearer ${token}`);
  if (path === '/api/tournament' && method === 'GET' && cachedSnapshot) headers.set('If-None-Match', cachedSnapshot.etag);
  const response = await fetch(`${endpoint}${path}`, { ...options, headers, credentials: 'omit', cache: 'no-store', signal: options.signal || AbortSignal.timeout(12000) });
  if (response.status === 304 && cachedSnapshot) return cachedSnapshot.body as T;
  let body: { error?: string; token?: string; editor?: boolean };
  try { body = await response.json(); } catch { throw new Error('共享比分服务暂时不可用，请稍后重试。'); }
  if (!response.ok) {
    if (response.status === 401 || (response.status === 403 && token)) {
      remember(''); window.dispatchEvent(new Event('cup-session-expired'));
    }
    throw new Error(body.error || '请求失败，请稍后再试');
  }
  if (path === '/api/session') {
    if (method === 'POST' && body.token) remember(body.token);
    if (method === 'DELETE' || body.editor === false) remember('');
  }
  if (path === '/api/tournament' && method === 'GET') {
    const etag = response.headers.get('ETag');
    if (etag) cachedSnapshot = { etag, body };
  }
  return body as T;
}
