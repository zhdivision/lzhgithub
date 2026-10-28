alter table public.cup_matches add column locked boolean not null default false;
alter table public.cup_matches add column locked_at timestamptz;
create table public.cup_rounds (
  round integer primary key check (round between 1 and 3),
  version integer not null default 0 check (version >= 0),
  locked boolean not null default false,
  submitted_at timestamptz
);
insert into public.cup_rounds(round) values(1),(2),(3);
alter table public.cup_rounds enable row level security;
revoke all on public.cup_rounds from public, anon, authenticated;
grant select,insert,update,delete on public.cup_rounds to service_role;

create or replace function public.cup_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
 select jsonb_build_object(
  'teams',coalesce((select jsonb_agg(data || jsonb_build_object('version',version) order by id) from public.cup_teams),'[]'::jsonb),
  'matches',coalesce((select jsonb_agg(data || jsonb_build_object('version',version,'locked',locked,'lockedAt',locked_at) order by id) from public.cup_matches),'[]'::jsonb),
  'rounds',(select jsonb_agg(jsonb_build_object('round',round,'version',version,'locked',locked,'submittedAt',submitted_at) order by round) from public.cup_rounds)
 );
$$;

create function public.cup_update_entity_secure(p_kind text,p_id text,p_version integer,p_patch jsonb,p_admin boolean) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
 previous jsonb; current_version integer; next_data jsonb;
 is_locked boolean := false; lock_time timestamptz;
 stamp timestamptz := clock_timestamp();
begin
 -- All writers take this transaction lock before row locks. It prevents a
 -- fixture moving between rounds while a whole round is being validated.
 perform pg_advisory_xact_lock(586214,1);
 if p_kind='team' then
  select data,version into previous,current_version from public.cup_teams where id=p_id for update;
 elsif p_kind='match' then
  select data,version,locked,locked_at into previous,current_version,is_locked,lock_time from public.cup_matches where id=p_id for update;
 else return jsonb_build_object('status',400,'error','记录类型不正确');
 end if;
 if previous is null then return jsonb_build_object('status',404,'error','记录不存在'); end if;
 if p_kind='match' and not coalesce(p_admin,false) and (is_locked or exists(
  select 1 from public.cup_rounds where locked and round in (nullif(previous->>'round','')::integer,nullif(p_patch->>'round','')::integer)
 )) then return jsonb_build_object('status',423,'error','本场已由管理员提交锁定，只有管理员可以更正。'); end if;
 if current_version<>p_version then return jsonb_build_object('status',409,'error','这条记录已被其他人修改，请读取最新数据后重试。','conflict',true); end if;
 if p_kind='team' then
  next_data:=previous || jsonb_build_object('name',p_patch->'name','version',current_version+1);
  update public.cup_teams set data=next_data,version=current_version+1 where id=p_id;
 else
  next_data:=previous || jsonb_build_object('homeScore',case when p_patch->>'status'='unplayed' then null else p_patch->'homeScore' end,'awayScore',case when p_patch->>'status'='unplayed' then null else p_patch->'awayScore' end,'status',p_patch->'status','round',p_patch->'round','kickoff',p_patch->'kickoff','demo',coalesce(p_patch->'demo','false'::jsonb),'version',current_version+1,'updatedAt',stamp);
  update public.cup_matches set data=next_data,version=current_version+1 where id=p_id;
 end if;
 insert into public.cup_history(entity_id,kind,before_data,after_data,at) values(p_id,p_kind,previous,next_data,stamp);
 return jsonb_build_object('status',200,'value',case when p_kind='match' then next_data || jsonb_build_object('locked',is_locked,'lockedAt',lock_time) else next_data end);
end;
$$;
-- Keep the old RPC safe for older website tabs: it always has editor rights.
create or replace function public.cup_update_entity(p_kind text,p_id text,p_version integer,p_patch jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
 select public.cup_update_entity_secure(p_kind,p_id,p_version,p_patch,false);
$$;

create function public.cup_submit_round(p_round integer,p_version integer,p_items jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
 round_version integer; expected_count integer; target_count integer; item jsonb;
 previous jsonb; current_version integer; next_data jsonb;
 stamp timestamptz := clock_timestamp();
begin
 perform pg_advisory_xact_lock(586214,1);
 select version into round_version from public.cup_rounds where round=p_round for update;
 if round_version is null then return jsonb_build_object('status',400,'error','请选择有效轮次'); end if;
 if round_version<>p_version then return jsonb_build_object('status',409,'error','本轮已被其他管理员提交，请载入最新数据。','conflict',true); end if;
 select sum(n/2)::integer into expected_count from (select count(*)::integer n from public.cup_teams group by data->>'group') team_counts;
 select count(*) into target_count from public.cup_matches where data->>'round'=p_round::text;
 if target_count<>expected_count or exists(
  select team from (select data->>'home' team from public.cup_matches where data->>'round'=p_round::text union all select data->>'away' from public.cup_matches where data->>'round'=p_round::text) teams group by team having count(*)>1
 ) then return jsonb_build_object('status',400,'error','本轮赛程应完整且每队最多一场，请先核对轮次安排。'); end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<>target_count then return jsonb_build_object('status',400,'error','必须一次提交本轮全部比赛'); end if;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_items))<>target_count then return jsonb_build_object('status',400,'error','提交中存在重复比赛'); end if;
 -- Validate the ENTIRE request before any updates, so one conflict cannot
 -- leave half a round submitted. The RPC is one PostgreSQL transaction.
 for item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(item->'version') is distinct from 'number' or (item->>'version') !~ '^\d+$' or jsonb_typeof(item->'homeScore') is distinct from 'number' or (item->>'homeScore') !~ '^\d+$' or jsonb_typeof(item->'awayScore') is distinct from 'number' or (item->>'awayScore') !~ '^\d+$' then return jsonb_build_object('status',400,'error','比分和版本必须为非负整数'); end if;
  if (item->>'homeScore')::numeric>1000000000 or (item->>'awayScore')::numeric>1000000000 then return jsonb_build_object('status',400,'error','比分超出允许范围'); end if;
  select data,version into previous,current_version from public.cup_matches where id=item->>'id' and data->>'round'=p_round::text;
  if previous is null then return jsonb_build_object('status',400,'error','比赛不属于所选轮次'); end if;
  if current_version<>(item->>'version')::numeric then return jsonb_build_object('status',409,'error','本轮有比赛已被修改，请载入最新数据后重试。','conflict',true); end if;
 end loop;
 for item in select value from jsonb_array_elements(p_items) loop
  select data,version into previous,current_version from public.cup_matches where id=item->>'id';
  next_data:=previous || jsonb_build_object('homeScore',(item->>'homeScore')::integer,'awayScore',(item->>'awayScore')::integer,'status','finished','demo',false,'version',current_version+1,'updatedAt',stamp);
  update public.cup_matches set data=next_data,version=current_version+1,locked=true,locked_at=stamp where id=item->>'id';
  insert into public.cup_history(entity_id,kind,before_data,after_data,at) values(item->>'id','match',previous,next_data,stamp);
 end loop;
 update public.cup_rounds set version=round_version+1,locked=true,submitted_at=stamp where round=p_round;
 return jsonb_build_object('status',200,'round',p_round,'lockedMatches',target_count);
end;
$$;
revoke execute on function public.cup_update_entity_secure(text,text,integer,jsonb,boolean) from public,anon,authenticated;
revoke execute on function public.cup_submit_round(integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.cup_update_entity_secure(text,text,integer,jsonb,boolean) to service_role;
grant execute on function public.cup_submit_round(integer,integer,jsonb) to service_role;
