import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../supabase/functions/cup-api/handler.ts';

const origin = 'https://example.github.io';
function setup(adminPassword = 'test-only-admin-password-123') {
  let clock = 1_798_000_000_000, attempts = 0, writes = 0;
  const handler = createHandler({
    password: 'test-only-editor-password', adminPassword, sessionSecret: 'test-only-session-secret-at-least-32-characters', origins: [origin], now: () => clock,
    database: {
      snapshot: async () => ({ teams: [], matches: [] }),
      update: async (_kind, id, version, patch, admin) => { if(id==='A-12'&&!admin)return {status:423,error:'管理员已锁定'}; writes++; return version === 4 ? { status: 409, conflict: true } : { status: 200, value: { id, ...patch, version: version + 1 } }; },
      submitRound: async () => ({status:200,lockedMatches:11}),
      history: async id => [{ id, kind: 'match' }],
      loginAttempt: async () => ++attempts,
      clearAttempts: async () => { attempts = 0; },
    },
  });
  const call = (path, method = 'GET', body, token, source = origin) => handler(new Request(`https://project.supabase.co/functions/v1/cup-api/api/${path}`, { method, headers: { ...(source ? { Origin: source } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), 'x-forwarded-for': '198.51.100.8', 'Content-Type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
  return { call, handler, expire: () => { clock += 13 * 3600_000; }, writes: () => writes };
}
const match = { kind: 'match', id: 'E-12', version: 1, homeScore: 0, awayScore: 0, status: 'live', round: 3, kickoff: null };

test('public snapshot, CORS preflight and ETag support; writes require allowed origin and session', async () => {
  const { call, writes } = setup();
  const publicResult = await call('tournament');
  assert.equal(publicResult.status, 200);
  assert.equal(publicResult.headers.get('Access-Control-Allow-Origin'), origin);
  assert.ok(publicResult.headers.get('ETag'));
  assert.equal((await call('tournament', 'OPTIONS')).status, 204);
  assert.equal((await call('tournament', 'GET', undefined, undefined, 'https://other.example')).status, 403);
  assert.equal((await call('tournament', 'PATCH', match)).status, 403);
  assert.equal((await call('tournament', 'PATCH', match, undefined, null)).status, 403);
  assert.equal(writes(), 0);
  const health = await (await call('health')).json();
  assert.deepEqual(health, { passwordConfigured: true, adminPasswordConfigured: true, sessionSecretConfigured: true, originsConfigured: true });
});
test('admin sessions cannot be forged with editor credentials; only admins submit or correct locks', async () => {
 const s=setup();const payload={round:1,version:0,confirmed:true,matches:[{id:'A-12',version:0,homeScore:0,awayScore:0}]};
 assert.equal((await s.call('session','POST',{role:'admin',password:'test-only-editor-password'})).status,401);
 const editor=(await (await s.call('session','POST',{password:'test-only-editor-password'})).json()).token;
 assert.equal((await s.call('rounds/submit','POST',payload,editor)).status,403);
 assert.equal((await s.call('tournament','PATCH',{...match,id:'A-12'},editor)).status,423);
 assert.equal((await s.call('rounds/submit','POST',payload,editor.replace('.editor.','.admin.'))).status,403);
 const admin=(await (await s.call('session','POST',{role:'admin',password:'test-only-admin-password-123'})).json()).token;
 assert.equal((await (await s.call('session','GET',undefined,admin)).json()).admin,true);
 assert.equal((await s.call('tournament','PATCH',{...match,id:'A-12'},admin)).status,200);
 assert.equal((await s.call('rounds/submit','POST',{...payload,confirmed:false},admin)).status,400);
 assert.equal((await s.call('rounds/submit','POST',{...payload,matches:[...payload.matches,...payload.matches]},admin)).status,400);
 assert.equal((await s.call('rounds/submit','POST',payload,admin)).status,200);
 assert.equal((await setup('').call('session','POST',{role:'admin',password:'anything'})).status,503);
});
test('editor login, zero draw save, invalid scores, conflict, history and token expiration', async () => {
  const s = setup();
  assert.equal((await s.call('session', 'POST', { password: 'wrong' })).status, 401);
  const login = await s.call('session', 'POST', { password: 'test-only-editor-password' });
  const { token } = await login.json();
  assert.equal((await s.call('session', 'GET', undefined, token)).status, 200);
  assert.equal((await (await s.call('session', 'GET', undefined, token)).json()).editor, true);
  assert.equal((await s.call('tournament', 'PATCH', match, token)).status, 200);
  assert.equal((await s.call('tournament', 'PATCH', { ...match, homeScore: -1 }, token)).status, 400);
  assert.equal((await s.call('tournament', 'PATCH', { ...match, homeScore: null }, token)).status, 400);
  assert.equal((await s.call('tournament', 'PATCH', { ...match, round: 4 }, token)).status, 400);
  assert.equal((await s.call('tournament', 'PATCH', { ...match, version: 4 }, token)).status, 409);
  assert.equal((await s.call('history?id=E-12', 'GET', undefined, token)).status, 200);
  assert.equal((await s.call('history?id=E-12')).status, 403);
  assert.equal((await (await s.call('session', 'GET', undefined, token + 'x')).json()).editor, false);
  s.expire();
  assert.equal((await s.call('tournament', 'PATCH', match, token)).status, 403);
});
test('incorrect passwords are rate limited on the server', async () => {
  const { call } = setup();
  for (let n = 0; n < 10; n++) assert.equal((await call('session', 'POST', { password: 'wrong' })).status, 401);
  assert.equal((await call('session', 'POST', { password: 'test-only-editor-password' })).status, 429);
});
test('conditional reads accept weak ETags added by response compression', async () => {
  const { call, handler } = setup();
  const first = await call('tournament');
  const etag = first.headers.get('ETag');
  for (const validator of [etag, `W/${etag}`, `"different", W/${etag}`, '*']) {
    const response = await handler(new Request('https://project.supabase.co/functions/v1/cup-api/api/tournament', { headers: { Origin: origin, 'If-None-Match': validator } }));
    assert.equal(response.status, 304);
    assert.equal(await response.text(), '');
  }
});
