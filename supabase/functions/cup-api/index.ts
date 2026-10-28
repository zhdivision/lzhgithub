import { createHandler } from './handler.ts';

const url = Deno.env.get('SUPABASE_URL') || '';
const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const key = keys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
async function rest(path: string, method = 'GET', body?: unknown) {
  if (!url || !key) throw new Error('Backend database connection is not configured');
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, ...(key.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${key}` }), 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Database request failed (${response.status})`);
  return response.status === 204 ? null : response.json();
}
Deno.serve(createHandler({
  password: Deno.env.get('EDITOR_PASSWORD') || '',
  adminPassword: Deno.env.get('ADMIN_PASSWORD') || '',
  sessionSecret: Deno.env.get('SESSION_SECRET') || '',
  origins: ['https://zhdivision.github.io', ...(Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(value => { try { return new URL(value.trim()).origin; } catch { return ''; } }).filter(Boolean)],
  database: {
    snapshot: () => rest('rpc/cup_snapshot', 'POST', {}),
    update: (kind, id, version, patch, admin) => rest('rpc/cup_update_entity_secure', 'POST', { p_kind: kind, p_id: id, p_version: version, p_patch: patch, p_admin: admin }),
    submitRound: (round, version, matches) => rest('rpc/cup_submit_round', 'POST', { p_round: round, p_version: version, p_items: matches }),
    history: async id => {
      const rows = await rest(`cup_history?entity_id=eq.${encodeURIComponent(id)}&select=id,kind,before_data,after_data,at&order=at.desc,id.desc&limit=20`);
      return rows.map((row: { id: string; kind: string; before_data: unknown; after_data: unknown; at: string }) => ({ id: row.id, kind: row.kind, before: row.before_data, after: row.after_data, at: row.at }));
    },
    loginAttempt: id => rest('rpc/cup_login_attempt', 'POST', { p_key: id }),
    clearAttempts: async id => { await rest(`cup_login_attempts?key=eq.${encodeURIComponent(id)}`, 'DELETE'); },
  },
}));
