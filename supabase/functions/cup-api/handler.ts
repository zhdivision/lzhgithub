type Database = {
  snapshot(): Promise<unknown>;
  update(kind: string, id: string, version: number, patch: Record<string, unknown>): Promise<{status: number; [key: string]: unknown}>;
  history(id: string): Promise<unknown>;
  loginAttempt(key: string): Promise<number>;
  clearAttempts(key: string): Promise<void>;
};
type Settings = { password: string; sessionSecret: string; origins: string[]; database: Database; now?: () => number };
const encoder = new TextEncoder();
const hex = (value: ArrayBuffer) => Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
const sha = async (value: string) => hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
async function equal(a: string, b: string) {
  const [x, y] = await Promise.all([sha(a), sha(b)]);
  let difference = 0;
  for (let i = 0; i < x.length; i++) difference |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return difference === 0;
}

// Validates and reconstructs allowed fields; immutable group/opponent IDs never
// come from the request body. The same validation applies to all write callers.
function updateInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || !/^[A-F](?:[1-4]|-[1-4][1-4])$/.test(v.id) || !Number.isSafeInteger(v.version) || (v.version as number) < 0 || (v.version as number) > 2_000_000_000) return null;
  if (v.kind === 'team') {
    if (typeof v.name !== 'string' || !v.name.trim() || v.name.trim().length > 80) return null;
    return { kind: 'team', id: v.id, version: v.version as number, patch: { name: v.name.trim() } };
  }
  if (v.kind !== 'match' || !['unplayed','live','finished'].includes(v.status as string)) return null;
  const score = (s: unknown) => s === null || (Number.isInteger(s) && (s as number) >= 0 && (s as number) <= 1_000_000_000);
  if (!score(v.homeScore) || !score(v.awayScore) || (v.status !== 'unplayed' && (v.homeScore === null || v.awayScore === null))) return null;
  if (v.round !== null && (!Number.isInteger(v.round) || (v.round as number) < 1 || (v.round as number) > 3)) return null;
  if (v.kickoff !== null && (typeof v.kickoff !== 'string' || v.kickoff.length > 40 || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v.kickoff) || !Number.isFinite(Date.parse(v.kickoff)))) return null;
  if (v.demo !== undefined && typeof v.demo !== 'boolean') return null;
  return { kind: 'match', id: v.id, version: v.version as number, patch: { homeScore: v.homeScore, awayScore: v.awayScore, status: v.status, round: v.round, kickoff: v.kickoff, demo: v.demo ?? false } };
}

export function createHandler(settings: Settings) {
  const now = settings.now || Date.now;
  const origins = new Set(settings.origins);
  const signature = async (payload: string) => {
    const key = await crypto.subtle.importKey('raw', encoder.encode(settings.sessionSecret + settings.password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
  };
  const editor = async (request: Request) => {
    const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || '';
    if (!/^\d{13}\.[a-f\d-]{36}\.[a-f\d]{64}$/.test(token)) return false;
    const [expires, nonce, sig] = token.split('.');
    if (Number(expires) <= now() || Number(expires) > now() + 12 * 3600_000) return false;
    return equal(sig, await signature(`${expires}.${nonce}`));
  };
  return async (request: Request) => {
    const origin = request.headers.get('Origin');
    const allowed = !!origin && origins.has(origin);
    const headers: Record<string,string> = { 'Cache-Control': 'no-store', Vary: 'Origin', 'X-Content-Type-Options': 'nosniff' };
    if (allowed) Object.assign(headers, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization,content-type,if-none-match',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Expose-Headers': 'ETag',
      'Access-Control-Max-Age': '600',
    });
    const json = (value: unknown, status = 200, extra: Record<string,string> = {}) => Response.json(value, { status, headers: { ...headers, ...extra } });
    if (origin && !allowed) return json({ error: '此网页地址尚未获准连接比分服务' }, 403);
    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers });
    const url = new URL(request.url), path = url.pathname.replace(/^.*(?=\/api\/)/, '');
    if (path === '/api/health' && request.method === 'GET') return json({ passwordConfigured: !!settings.password, sessionSecretConfigured: settings.sessionSecret.length >= 32, originsConfigured: origins.size > 0 });
    const write = !['GET','HEAD'].includes(request.method);
    if (write && !allowed) return json({ error: '请求来源不正确' }, 403);
    if (!settings.password || settings.sessionSecret.length < 32) return json({ error: '服务尚未配置编辑口令与会话密钥' }, 503);
    try {
      if (path === '/api/session') {
        if (request.method === 'GET') return json({ editor: await editor(request) });
        if (request.method === 'DELETE') return json({ editor: false });
        if (request.method === 'POST') {
          const input = await request.json() as { password?: unknown } | null;
          if (typeof input?.password !== 'string' || input.password.length > 256) return json({ error: '请输入编辑口令' }, 400);
          // Supabase's gateway supplies the forwarding chain. Do not store raw IPs.
          const client = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
          const key = await sha(client + settings.sessionSecret);
          if (await settings.database.loginAttempt(key) > 10) return json({ error: '尝试次数过多，请十分钟后再试' }, 429);
          if (!await equal(input.password, settings.password)) return json({ error: '编辑口令不正确' }, 401);
          await settings.database.clearAttempts(key);
          const payload = `${now() + 12 * 3600_000}.${crypto.randomUUID()}`;
          return json({ editor: true, token: `${payload}.${await signature(payload)}` });
        }
      }
      if (path === '/api/tournament') {
        if (request.method === 'GET') {
          const snapshot = await settings.database.snapshot(), text = JSON.stringify(snapshot);
          const etag = `"${await sha(text)}"`;
          const validators = request.headers.get('If-None-Match')?.split(',').map(value => value.trim().replace(/^W\//i, ''));
          if (validators?.some(value => value === '*' || value === etag)) return new Response(null, { status: 304, headers: { ...headers, ETag: etag } });
          return json(snapshot, 200, { ETag: etag });
        }
        if (request.method === 'PATCH') {
          if (!await editor(request)) return json({ error: '请输入编辑口令后再保存' }, 403);
          const input = updateInput(await request.json());
          if (!input) return json({ error: '请检查队名、比分、轮次和开赛时间；比分须为非负整数' }, 400);
          const result = await settings.database.update(input.kind, input.id, input.version, input.patch);
          const { status, ...body } = result;
          return json(body, status);
        }
      }
      if (path === '/api/history' && request.method === 'GET') {
        if (!await editor(request)) return json({ error: '请输入编辑口令' }, 403);
        const id = url.searchParams.get('id');
        if (!id || id.length > 12) return json({ error: '记录编号不正确' }, 400);
        return json(await settings.database.history(id));
      }
      return json({ error: '接口不存在或请求方法不支持' }, 404);
    } catch (error) {
      if (error instanceof SyntaxError) return json({ error: '请求内容格式不正确' }, 400);
      // Never include database errors, API keys, password or session tokens in logs.
      console.error('cup-api request failed', request.method, path);
      return json({ error: '暂时无法读取或保存比分，请稍后重试' }, 503);
    }
  };
}
