-- Apply after 202609010001_signal_engine.sql. All writes and their audit
-- records are atomic; browser roles cannot bypass lifecycle functions.
begin;
alter table public.goals add column if not exists consensus_method text not null default 'single';
alter table public.goals add column if not exists min_quorum integer not null default 1;
alter table public.goals add column if not exists voting_deadline timestamptz;
alter table public.goals add column if not exists finalized_at timestamptz;
alter table public.goals add column if not exists finalized_by uuid references public.app_users(id);
alter table public.goals add column if not exists consensus_result jsonb;
alter table public.goals add column if not exists voting_round integer not null default 1;
alter table public.goals add column if not exists revision integer not null default 0;
alter table public.goals alter column weight drop not null;
alter table public.goals alter column weight drop default;
alter table public.goals drop constraint if exists goals_status_check;

-- Legacy weights have no approval evidence. Preserve them in history, not
-- as finalized weights. Closed historical goals retain their stored weight.
insert into public.audit_log(company_id, action, entity_type, entity_id, before, after)
select company_id, 'goal.legacy_migrated', 'goal', id,
  jsonb_build_object('status',status,'weight',weight),
  jsonb_build_object('status','draft','weight',null)
from public.goals where status = 'active' or (status = 'draft' and weight is not null);
update public.goals set status = 'draft', weight = null
where status = 'active' or (status = 'draft' and weight is not null);
alter table public.goals alter column status set default 'draft';
alter table public.goals add constraint goals_status_check check(status in ('draft','voting','finalized','closed'));
alter table public.goals drop constraint if exists goals_engine_check;
alter table public.goals add constraint goals_engine_check check (
  consensus_method in ('single','median_consensus') and min_quorum between 1 and 100
  and (consensus_method <> 'single' or min_quorum = 1)
  and period_end >= period_start and voting_round > 0 and revision >= 0
  and (weight is null or weight between 0 and 100)
  and (status not in ('draft','voting') or weight is null)
  and (status <> 'finalized' or (weight is not null and finalized_by is not null and finalized_at is not null))
);
alter table public.goals drop constraint if exists goals_company_id_goal_code_key;
create unique index if not exists goals_company_code_period_unique on public.goals(company_id, goal_code, period_start);

create table if not exists public.goal_weight_votes (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references public.goals(id) on delete cascade,
  voter_app_user_id uuid not null references public.app_users(id),
  weight_value numeric(5,2) not null check(weight_value between 0 and 100),
  voted_at timestamptz not null default now(),
  round integer not null default 1 check(round > 0),
  unique(goal_id, voter_app_user_id, round)
);
create table if not exists public.goal_creation_requests (
  request_id uuid not null,
  actor_id uuid not null references public.app_users(id),
  payload jsonb not null,
  result jsonb not null,
  primary key(actor_id, request_id)
);
alter table public.goal_weight_votes enable row level security;
alter table public.goal_creation_requests enable row level security;
drop policy if exists goal_votes_select on public.goal_weight_votes;
create policy goal_votes_select on public.goal_weight_votes for select to authenticated using (
  exists(select 1 from public.goals g join public.app_users u on u.company_id=g.company_id
    where g.id=goal_id and u.auth_user_id=auth.uid() and u.status='active')
);
-- Remove legacy write policies so direct REST writes cannot skip audit/quorum.
do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies where schemaname='public'
    and tablename in ('goals','goal_weight_votes') and cmd <> 'SELECT'
  loop execute format('drop policy %I on public.%I',p.policyname,p.tablename); end loop;
end $$;
revoke insert, update, delete on public.goals, public.goal_weight_votes from anon, authenticated;
revoke all on public.goal_creation_requests from anon, authenticated;
grant select on public.goal_weight_votes to authenticated;

create or replace function public.goal_consensus(vals numeric[]) returns jsonb
language plpgsql immutable set search_path=public,pg_temp as $$
declare med numeric; mad numeric; used numeric[]; excluded numeric[]; method text; result numeric;
begin
  if coalesce(cardinality(vals),0)=0 then
    return jsonb_build_object('weight',null,'method','no_votes','votesUsed','[]'::jsonb,'votesExcludedAsOutliers','[]'::jsonb,'totalVoters',0);
  end if;
  if exists(select 1 from unnest(vals) v where v is null or v < 0 or v > 100) then raise exception 'invalid_weight'; end if;
  select percentile_cont(0.5) within group(order by v) into med from unnest(vals) v;
  select percentile_cont(0.5) within group(order by abs(v-med)) into mad from unnest(vals) v;
  select coalesce(array_agg(v),'{}') into used from unnest(vals) v where mad=0 or abs(v-med)<=mad*2.5;
  select coalesce(array_agg(v),'{}') into excluded from unnest(vals) v where mad<>0 and abs(v-med)>mad*2.5;
  method := case when cardinality(vals)=1 then 'single' else 'median' end;
  if cardinality(used)<cardinality(vals)/2.0 then used:=vals; excluded:='{}'; method:='median_fallback'; end if;
  select percentile_cont(0.5) within group(order by v) into result from unnest(used) v;
  return jsonb_build_object('weight',round(result,2),'method',method,'votesUsed',to_jsonb(used),
    'votesExcludedAsOutliers',to_jsonb(excluded),'totalVoters',cardinality(vals));
end $$;

create or replace function public.mutate_weighted_goal(
  p_actor uuid, p_goal uuid, p_action text, p_revision integer,
  p_weight numeric default null, p_reason text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.app_users; g public.goals; old_vote numeric; vals numeric[]; result jsonb; old_goal jsonb;
begin
  select * into a from public.app_users where id=p_actor and status='active' for share;
  if a.id is null or a.role not in ('founder_admin','team_lead') then raise exception 'forbidden'; end if;
  select * into g from public.goals where id=p_goal and company_id=a.company_id for update;
  if g.id is null then raise exception 'goal_not_found'; end if;
  if p_revision is null or p_revision<>g.revision then raise exception 'stale_goal'; end if;
  if p_weight is not null and (p_weight<0 or p_weight>100 or p_weight<>round(p_weight,2)) then raise exception 'invalid_weight'; end if;
  old_goal:=to_jsonb(g);
  if p_action='vote' then
    if g.consensus_method<>'median_consensus' or g.status not in ('draft','voting') then raise exception 'voting_closed'; end if;
    if g.voting_deadline is not null and g.voting_deadline<=now() then raise exception 'deadline_passed'; end if;
    if p_weight is null then raise exception 'invalid_weight'; end if;
    select weight_value into old_vote from public.goal_weight_votes
      where goal_id=g.id and voter_app_user_id=a.id and round=g.voting_round;
    insert into public.goal_weight_votes(goal_id,voter_app_user_id,weight_value,round)
      values(g.id,a.id,p_weight,g.voting_round)
      on conflict(goal_id,voter_app_user_id,round) do update set weight_value=excluded.weight_value,voted_at=now();
    update public.goals set status='voting',revision=revision+1 where id=g.id;
    insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,before,after)
    values(a.company_id,a.id,case when old_vote is null then 'goal.vote.cast' else 'goal.vote.updated' end,'goal',g.id,
      jsonb_build_object('weight',old_vote),jsonb_build_object('weight',p_weight,'round',g.voting_round));
  else
    if a.role<>'founder_admin' then raise exception 'forbidden'; end if;
    if p_action='finalize' then
      if g.status not in ('draft','voting') then raise exception 'invalid_transition'; end if;
      if g.consensus_method='single' then
        if p_weight is null then raise exception 'invalid_weight'; end if;
        vals:=array[p_weight];
        insert into public.goal_weight_votes(goal_id,voter_app_user_id,weight_value,round)
          values(g.id,a.id,p_weight,g.voting_round);
      else
        if p_weight is not null then raise exception 'consensus_weight_is_computed'; end if;
        select array_agg(v.weight_value order by v.voter_app_user_id) into vals from public.goal_weight_votes v
          join public.app_users u on u.id=v.voter_app_user_id
          where v.goal_id=g.id and v.round=g.voting_round and u.status='active'
            and u.company_id=g.company_id and u.role in ('founder_admin','team_lead');
        if coalesce(cardinality(vals),0)<g.min_quorum then raise exception 'quorum_not_met'; end if;
      end if;
      result:=public.goal_consensus(vals);
      update public.goals set status='finalized', weight=(result->>'weight')::numeric,
        consensus_result=result, finalized_by=a.id,finalized_at=now(),revision=revision+1 where id=g.id;
    elsif p_action='reopen' then
      if g.status<>'finalized' then raise exception 'invalid_transition'; end if;
      if p_reason is null or length(trim(p_reason))<5 or length(p_reason)>1000 then raise exception 'reason_required'; end if;
      -- A new round keeps previous votes, but requires fresh consent.
      update public.goals set status='voting',weight=null,consensus_result=null,finalized_at=null,finalized_by=null,
        voting_round=voting_round+1,voting_deadline=null,revision=revision+1 where id=g.id;
    elsif p_action='close' then
      if g.status<>'finalized' then raise exception 'invalid_transition'; end if;
      update public.goals set status='closed',revision=revision+1 where id=g.id;
    else raise exception 'invalid_action'; end if;
    insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,before,after)
    select a.company_id,a.id,'goal.'||case p_action when 'finalize' then 'finalized' when 'reopen' then 'reopened' else 'closed' end,
      'goal',g.id,old_goal,to_jsonb(updated)||jsonb_build_object('reason',p_reason)
      from public.goals updated where id=g.id;
  end if;
  return (select to_jsonb(updated) from public.goals updated where id=g.id);
end $$;

create or replace function public.create_weighted_goals(p_actor uuid,p_request uuid,p_goals jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.app_users; item jsonb; g public.goals; results jsonb:='[]'; prior public.goal_creation_requests; method text;
begin
  select * into a from public.app_users where id=p_actor and status='active' for share;
  if a.id is null or a.role not in ('founder_admin','team_lead') then raise exception 'forbidden'; end if;
  if p_request is null or jsonb_typeof(p_goals)<>'array' or jsonb_array_length(p_goals) not between 1 and 20 then raise exception 'invalid_goals'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor::text||p_request::text,0));
  select * into prior from public.goal_creation_requests where actor_id=p_actor and request_id=p_request;
  if prior.request_id is not null then
    if prior.payload<>p_goals then raise exception 'request_reused'; end if;
    return prior.result;
  end if;
  for item in select value from jsonb_array_elements(p_goals) loop
    if length(trim(item->>'name')) not between 1 and 160 or item->>'name' is null
      or item->>'goal_code' is null or (item->>'goal_code') !~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'
      or item->>'owning_team' is null or length(trim(item->>'owning_team')) not between 1 and 80
      then raise exception 'invalid_goals'; end if;
    method:=coalesce(item->>'consensus_method','single');
    if item ? 'initial_weight' and (method<>'single' or a.role<>'founder_admin' or item->>'initial_weight' is null) then raise exception 'forbidden'; end if;
    insert into public.goals(company_id,name,goal_code,owning_team,period_start,period_end,consensus_method,min_quorum,voting_deadline,status,weight)
    values(a.company_id,trim(item->>'name'),item->>'goal_code',trim(item->>'owning_team'),
      (item->>'period_start')::date,(item->>'period_end')::date,method,coalesce((item->>'min_quorum')::integer,1),
      (item->>'voting_deadline')::timestamptz,'draft',null) returning * into g;
    insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,after)
      values(a.company_id,a.id,'goal.created','goal',g.id,to_jsonb(g));
    if item ? 'initial_weight' then
      perform public.mutate_weighted_goal(a.id,g.id,'finalize',0,(item->>'initial_weight')::numeric);
      select * into g from public.goals where id=g.id;
    end if;
    results:=results||jsonb_build_array(to_jsonb(g));
  end loop;
  insert into public.goal_creation_requests values(p_request,p_actor,p_goals,results);
  return results;
end $$;
revoke all on function public.goal_consensus(numeric[]) from public,anon,authenticated;
revoke all on function public.mutate_weighted_goal(uuid,uuid,text,integer,numeric,text) from public,anon,authenticated;
revoke all on function public.create_weighted_goals(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.goal_consensus(numeric[]) to service_role;
grant execute on function public.mutate_weighted_goal(uuid,uuid,text,integer,numeric,text) to service_role;
grant execute on function public.create_weighted_goals(uuid,uuid,jsonb) to service_role;
commit;
