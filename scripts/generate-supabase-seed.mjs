import fs from 'node:fs';
const root = new URL('../', import.meta.url);
const snapshot = JSON.parse(fs.readFileSync(new URL('migration-data/supabase-import.json', root), 'utf8'));
if (snapshot.teams.length !== 23 || snapshot.matches.length !== 33) throw new Error('Unexpected tournament counts');
const quoted = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const lines = ['-- Imported snapshot; never overwrite an existing entity.', 'begin;'];
for (const [key, table] of [['teams','cup_teams'], ['matches','cup_matches']]) {
  for (const value of snapshot[key]) {
    if (!/^[A-F][1-4](?:[1-4])?$|^[A-F]-[1-4][1-4]$/.test(value.id) || !Number.isSafeInteger(value.version)) throw new Error('Invalid snapshot entity');
    lines.push(`insert into public.${table}(id,data,version) values('${value.id}',${quoted(value)},${value.version}) on conflict(id) do nothing;`);
  }
}
const sqlText = value => `'${String(value).replaceAll("'", "''")}'`;
for (const row of snapshot.history || []) {
  if (!/^[a-f0-9-]{36}$/.test(row.id) || !['team','match'].includes(row.kind)) throw new Error('Invalid audit record');
  lines.push(`insert into public.cup_history(id,entity_id,kind,before_data,after_data,at) values(${sqlText(row.id)}::uuid,${sqlText(row.entity_id)},${sqlText(row.kind)},${quoted(row.before_data)},${quoted(row.after_data)},${sqlText(row.at)}::timestamptz) on conflict(id) do nothing;`);
}
lines.push('commit;', '');
fs.writeFileSync(new URL('supabase/seed.sql', root), lines.join('\n'));
console.log(JSON.stringify({ teams: snapshot.teams.length, matches: snapshot.matches.length, history: snapshot.history?.length || 0 }));
