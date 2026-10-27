-- All browser access goes through cup-api. Never grant browser roles writes.
grant usage on schema public to service_role;
create table public.cup_teams (
  id text primary key,
  data jsonb not null,
  version integer not null default 0 check (version >= 0),
  check (data->>'id' = id)
);
create table public.cup_matches (
  id text primary key,
  data jsonb not null,
  version integer not null default 0 check (version >= 0),
  check (data->>'id' = id)
);
create table public.cup_history (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  kind text not null check (kind in ('match','team')),
  before_data jsonb not null,
  after_data jsonb not null,
  at timestamptz not null default now()
);
create index cup_history_entity_time on public.cup_history (entity_id, at desc, id desc);
create table public.cup_login_attempts (
  key text primary key,
  count integer not null,
  until_at timestamptz not null
);
create index cup_login_expiry on public.cup_login_attempts (until_at);

alter table public.cup_teams enable row level security;
alter table public.cup_matches enable row level security;
alter table public.cup_history enable row level security;
alter table public.cup_login_attempts enable row level security;
revoke all on public.cup_teams, public.cup_matches, public.cup_history, public.cup_login_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.cup_teams, public.cup_matches, public.cup_history, public.cup_login_attempts to service_role;

create function public.cup_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'teams', coalesce((select jsonb_agg(data || jsonb_build_object('version',version) order by id) from public.cup_teams),'[]'::jsonb),
    'matches', coalesce((select jsonb_agg(data || jsonb_build_object('version',version) order by id) from public.cup_matches),'[]'::jsonb)
  );
$$;

-- Row lock, compare-and-swap and audit insert share one transaction.
create function public.cup_update_entity(p_kind text, p_id text, p_version integer, p_patch jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  previous jsonb;
  current_version integer;
  next_data jsonb;
  stamp timestamptz := clock_timestamp();
begin
  if p_kind = 'team' then
    select data,version into previous,current_version from public.cup_teams where id=p_id for update;
  elsif p_kind = 'match' then
    select data,version into previous,current_version from public.cup_matches where id=p_id for update;
  else
    return jsonb_build_object('status',400,'error','记录类型不正确');
  end if;
  if previous is null then return jsonb_build_object('status',404,'error','记录不存在'); end if;
  if current_version <> p_version then
    return jsonb_build_object('status',409,'error','这条记录已被其他人修改，请读取最新数据后重试。','conflict',true);
  end if;
  if p_kind = 'team' then
    next_data := previous || jsonb_build_object('name',p_patch->'name','version',current_version+1);
  else
    next_data := previous || jsonb_build_object(
      'homeScore',case when p_patch->>'status'='unplayed' then null else p_patch->'homeScore' end,
      'awayScore',case when p_patch->>'status'='unplayed' then null else p_patch->'awayScore' end,
      'status',p_patch->'status','round',p_patch->'round','kickoff',p_patch->'kickoff',
      'demo',coalesce(p_patch->'demo','false'::jsonb),'version',current_version+1,'updatedAt',stamp
    );
  end if;
  if p_kind='team' then
    update public.cup_teams set data=next_data,version=current_version+1 where id=p_id;
  else
    update public.cup_matches set data=next_data,version=current_version+1 where id=p_id;
  end if;
  insert into public.cup_history(entity_id,kind,before_data,after_data,at)
    values(p_id,p_kind,previous,next_data,stamp);
  return jsonb_build_object('status',200,'value',next_data);
end;
$$;

create function public.cup_login_attempt(p_key text) returns integer
language plpgsql security invoker set search_path = '' as $$
declare attempts integer;
begin
  delete from public.cup_login_attempts where until_at < now();
  insert into public.cup_login_attempts(key,count,until_at) values(p_key,1,now()+interval '10 minutes')
    on conflict(key) do update set count=public.cup_login_attempts.count+1
    returning count into attempts;
  return attempts;
end;
$$;

revoke execute on function public.cup_snapshot() from public, anon, authenticated;
revoke execute on function public.cup_update_entity(text,text,integer,jsonb) from public, anon, authenticated;
revoke execute on function public.cup_login_attempt(text) from public, anon, authenticated;
grant execute on function public.cup_snapshot() to service_role;
grant execute on function public.cup_update_entity(text,text,integer,jsonb) to service_role;
grant execute on function public.cup_login_attempt(text) to service_role;
