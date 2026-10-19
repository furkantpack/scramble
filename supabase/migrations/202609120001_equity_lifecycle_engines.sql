-- Engines 04-08: calibration, vesting, settlement, benchmark,
-- recommendation, export and coach read models.
-- Apply after 202609100001_slice_calculation_engine.sql.
begin;

alter table public.app_users add column if not exists current_ownership_percent numeric(15,8)
  check(current_ownership_percent is null or current_ownership_percent between 0 and 100);
alter table public.app_users add column if not exists benchmark_role text;

create table if not exists public.calibration_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  calculation_id uuid not null references public.contribution_calculations(id) on delete restrict,
  actor_id uuid not null references public.app_users(id) on delete restrict,
  action text not null check(action in ('accept','dispute','adjust','resolve')),
  resulting_state text not null check(resulting_state in ('disputed','confirmed')),
  previous_units numeric(30,8) not null check(previous_units>=0),
  confirmed_units numeric(30,8) check(confirmed_units is null or confirmed_units>=0),
  reason text,
  authorization_scope_type text not null check(authorization_scope_type in ('SELF','COMPANY','TEAM','DOMAIN')),
  authorization_scope_id text,
  created_at timestamptz not null default now(),
  check((action='accept' and confirmed_units is not null)
    or (action='dispute' and confirmed_units is null and length(trim(reason)) between 5 and 1000)
    or (action in ('adjust','resolve') and confirmed_units is not null and length(trim(reason)) between 5 and 1000))
);
create index if not exists calibration_reviews_calculation_idx
  on public.calibration_reviews(calculation_id,created_at desc);
create index if not exists calibration_reviews_company_state_idx
  on public.calibration_reviews(company_id,resulting_state,created_at desc);

create table if not exists public.vesting_schedules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  calculation_id uuid not null references public.contribution_calculations(id) on delete restrict,
  calibration_review_id uuid not null references public.calibration_reviews(id) on delete restrict,
  contributor_id uuid not null references public.app_users(id) on delete restrict,
  total_confirmed_units numeric(30,8) not null check(total_confirmed_units>=0),
  start_date date not null,
  duration_months integer not null default 48 check(duration_months>0),
  cliff_months integer not null default 12 check(cliff_months>=0 and cliff_months<=duration_months),
  frequency text not null default 'monthly' check(frequency in ('monthly','quarterly')),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  unique(calculation_id)
);
create index if not exists vesting_schedules_contributor_idx
  on public.vesting_schedules(company_id,contributor_id,start_date);

create table if not exists public.vesting_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vesting_schedule_id uuid not null references public.vesting_schedules(id) on delete restrict,
  event_type text not null check(event_type='forfeited'),
  effective_date date not null,
  reason text not null check(length(trim(reason)) between 5 and 1000),
  actor_id uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  unique(vesting_schedule_id,event_type)
);

create table if not exists public.period_settlements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  as_of_date date not null,
  version integer not null check(version>0),
  status text not null default 'settled' check(status='settled'),
  input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
  total_eligible_units numeric(30,8) not null check(total_eligible_units>=0),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  check(period_end>=period_start),
  unique(company_id,period_start,period_end,version)
);
create unique index if not exists period_settlement_hash_uidx
  on public.period_settlements(company_id,period_start,period_end,input_hash);

create table if not exists public.period_settlement_members (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.period_settlements(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  contributor_id uuid not null references public.app_users(id) on delete restrict,
  confirmed_units numeric(30,8) not null check(confirmed_units>=0),
  vested_units numeric(30,8) not null check(vested_units>=0 and vested_units<=confirmed_units),
  eligible_units numeric(30,8) not null check(eligible_units>=0),
  relative_share numeric(15,8) not null check(relative_share between 0 and 100),
  created_at timestamptz not null default now(),
  unique(settlement_id,contributor_id)
);

create table if not exists public.benchmark_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  stage text not null,
  sector text not null default '*',
  role text not null,
  minimum_percent numeric(8,4) not null check(minimum_percent between 0 and 100),
  maximum_percent numeric(8,4) not null check(maximum_percent between 0 and 100 and maximum_percent>=minimum_percent),
  source_label text not null,
  version integer not null default 1 check(version>0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists benchmark_rules_active_uidx
  on public.benchmark_rules(coalesce(company_id,'00000000-0000-0000-0000-000000000000'::uuid),stage,sector,role)
  where active=true;

insert into public.benchmark_rules(stage,sector,role,minimum_percent,maximum_percent,source_label)
values
  ('Idea','*','Founder',30,60,'Rising configurable baseline'),
  ('Pre-seed','*','Founder',25,50,'Rising configurable baseline'),
  ('Pre-seed','*','Technical Co-founder',20,40,'Rising configurable baseline'),
  ('Pre-seed','*','Early employee',0.5,5,'Rising configurable baseline'),
  ('Seed','*','Founder',15,35,'Rising configurable baseline'),
  ('Seed','*','Early employee',0.25,3,'Rising configurable baseline'),
  ('Series A','*','Early employee',0.1,1.5,'Rising configurable baseline'),
  ('Series B+','*','Early employee',0.05,0.75,'Rising configurable baseline'),
  ('Growth','*','Advisor',0.05,0.5,'Rising configurable baseline')
on conflict do nothing;

create table if not exists public.equity_recommendations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  settlement_id uuid not null references public.period_settlements(id) on delete restrict,
  settlement_member_id uuid not null references public.period_settlement_members(id) on delete restrict,
  contributor_id uuid not null references public.app_users(id) on delete restrict,
  benchmark_rule_id uuid not null references public.benchmark_rules(id) on delete restrict,
  contribution_share numeric(15,8) not null check(contribution_share between 0 and 100),
  current_ownership numeric(15,8) check(current_ownership is null or current_ownership between 0 and 100),
  benchmark_snapshot jsonb not null,
  recommended_minimum numeric(15,8) not null check(recommended_minimum between 0 and 100),
  recommended_maximum numeric(15,8) not null check(recommended_maximum between 0 and 100 and recommended_maximum>=recommended_minimum),
  rationale text not null,
  status text not null default 'draft' check(status in ('draft','approved','exported')),
  approved_allocation numeric(15,8) check(approved_allocation is null or approved_allocation between 0 and 100),
  approved_by uuid references public.app_users(id),
  approved_at timestamptz,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  unique(settlement_member_id)
);
create index if not exists equity_recommendations_company_status_idx
  on public.equity_recommendations(company_id,status,created_at desc);

create table if not exists public.equity_exports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  recommendation_id uuid not null references public.equity_recommendations(id) on delete restrict,
  destination text not null check(destination in ('csv','json','manual_legal','carta','cake_equity')),
  status text not null default 'ready' check(status in ('ready','downloaded','delivered','failed')),
  payload jsonb not null,
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique(recommendation_id,destination,payload_hash)
);

create or replace function public.auth_app_user_id() returns uuid
language sql stable security definer set search_path=public,pg_temp
as $$ select id from public.app_users where auth_user_id=auth.uid() limit 1 $$;
revoke all on function public.auth_app_user_id() from public;
grant execute on function public.auth_app_user_id() to authenticated;

do $$ declare t text; begin
  foreach t in array array['calibration_reviews','vesting_schedules','vesting_events','period_settlements',
    'period_settlement_members','equity_recommendations','equity_exports'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('drop policy if exists %I on public.%I',t||'_select',t);
  end loop;
end $$;

create policy calibration_reviews_select on public.calibration_reviews for select to authenticated using(
  company_id=public.auth_company_id() and (
    public.auth_role()<>'contributor' or exists(
      select 1 from public.contribution_calculations c
      where c.id=calculation_id and c.contributor_id=public.auth_app_user_id()
    )
  )
);
create policy vesting_schedules_select on public.vesting_schedules for select to authenticated using(
  company_id=public.auth_company_id() and (public.auth_role()<>'contributor' or contributor_id=public.auth_app_user_id())
);
create policy vesting_events_select on public.vesting_events for select to authenticated using(
  company_id=public.auth_company_id() and (
    public.auth_role()<>'contributor' or exists(
      select 1 from public.vesting_schedules v
      where v.id=vesting_schedule_id and v.contributor_id=public.auth_app_user_id()
    )
  )
);
create policy period_settlements_select on public.period_settlements for select to authenticated
  using(company_id=public.auth_company_id());
create policy period_settlement_members_select on public.period_settlement_members for select to authenticated using(
  company_id=public.auth_company_id() and (public.auth_role()<>'contributor' or contributor_id=public.auth_app_user_id())
);
create policy equity_recommendations_select on public.equity_recommendations for select to authenticated using(
  company_id=public.auth_company_id() and (public.auth_role()<>'contributor' or contributor_id=public.auth_app_user_id())
);
create policy equity_exports_select on public.equity_exports for select to authenticated using(
  company_id=public.auth_company_id() and (
    public.auth_role()<>'contributor' or exists(
      select 1 from public.equity_recommendations r
      where r.id=recommendation_id and r.contributor_id=public.auth_app_user_id()
    )
  )
);
alter table public.benchmark_rules enable row level security;
drop policy if exists benchmark_rules_select on public.benchmark_rules;
create policy benchmark_rules_select on public.benchmark_rules for select to authenticated
  using(company_id is null or company_id=public.auth_company_id());

revoke insert,update,delete on public.calibration_reviews,public.vesting_schedules,public.vesting_events,
  public.period_settlements,public.period_settlement_members,public.benchmark_rules,
  public.equity_recommendations,public.equity_exports from anon,authenticated;
grant select on public.calibration_reviews,public.vesting_schedules,public.vesting_events,
  public.period_settlements,public.period_settlement_members,public.benchmark_rules,
  public.equity_recommendations,public.equity_exports to authenticated;

create or replace function public.calibrate_contribution_calculation(
  p_actor uuid,p_calculation uuid,p_action text,p_new_units numeric default null,p_reason text default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.app_users; c public.contribution_calculations; s public.signals; g public.goals;
  current_units numeric; current_state text:='provisional'; scope_type text; scope_id text; confirmed numeric; saved public.calibration_reviews;
begin
  select * into a from public.app_users where id=p_actor and status='active' for share;
  if a.id is null then raise exception 'forbidden'; end if;
  select * into c from public.contribution_calculations where id=p_calculation and company_id=a.company_id and status='provisional' for share;
  if c.id is null then raise exception 'calculation_not_found'; end if;
  select * into s from public.signals where id=c.signal_id;
  select * into g from public.goals where id=c.goal_id;
  select coalesce((select new_units from public.contribution_calculation_overrides where calculation_id=c.id order by created_at desc limit 1),c.contribution_units) into current_units;
  select resulting_state into current_state from public.calibration_reviews where calculation_id=c.id order by created_at desc limit 1;
  current_state:=coalesce(current_state,'provisional');
  if current_state='confirmed' then raise exception 'already_confirmed'; end if;
  if p_action not in ('accept','dispute','adjust','resolve') then raise exception 'invalid_action'; end if;
  if a.role='contributor' then
    if c.contributor_id<>a.id or p_action not in ('accept','dispute') then raise exception 'forbidden'; end if;
    scope_type:='SELF'; scope_id:=a.id::text;
  elsif a.role='founder_admin' then scope_type:='COMPANY'; scope_id:=null;
  elsif a.role='team_lead' then
    select os.scope_type,os.scope_value into scope_type,scope_id from public.calculation_override_scopes os
      where os.actor_id=a.id and os.company_id=a.company_id and os.effective_from<=now()
        and (os.effective_to is null or os.effective_to>now())
        and ((os.scope_type='TEAM' and os.scope_value=g.owning_team)
          or (os.scope_type='DOMAIN' and os.scope_value=coalesce(s.calculation_domain,s.domain_tag))) limit 1;
    if scope_type is null then raise exception 'calibration_scope_forbidden'; end if;
  else raise exception 'forbidden'; end if;
  if current_state='disputed' and p_action not in ('resolve','adjust') then raise exception 'dispute_requires_resolution'; end if;
  if p_action in ('dispute','adjust','resolve') and (p_reason is null or length(trim(p_reason)) not between 5 and 1000) then raise exception 'reason_required'; end if;
  if p_action='dispute' then confirmed:=null;
  elsif p_action='accept' then confirmed:=current_units;
  else
    if p_new_units is null or p_new_units<0 then raise exception 'invalid_units'; end if; confirmed:=p_new_units;
  end if;
  insert into public.calibration_reviews(company_id,calculation_id,actor_id,action,resulting_state,
    previous_units,confirmed_units,reason,authorization_scope_type,authorization_scope_id)
  values(a.company_id,c.id,a.id,p_action,case when p_action='dispute' then 'disputed' else 'confirmed' end,
    current_units,confirmed,nullif(trim(p_reason),''),scope_type,scope_id) returning * into saved;
  insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,before,after)
    values(a.company_id,a.id,'calibration.'||p_action,'contribution_calculation',c.id,
      jsonb_build_object('state',current_state,'units',current_units),to_jsonb(saved));
  return to_jsonb(saved);
end $$;

create or replace function public.create_vesting_schedule(
  p_actor uuid,p_calculation uuid,p_start date,p_duration integer,p_cliff integer,p_frequency text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.app_users; c public.contribution_calculations; review public.calibration_reviews; saved public.vesting_schedules;
begin
  select * into a from public.app_users where id=p_actor and status='active' and role='founder_admin' for share;
  if a.id is null then raise exception 'forbidden'; end if;
  select * into c from public.contribution_calculations where id=p_calculation and company_id=a.company_id for share;
  if c.id is null then raise exception 'calculation_not_found'; end if;
  select * into review from public.calibration_reviews where calculation_id=c.id order by created_at desc limit 1;
  if review.id is null or review.resulting_state<>'confirmed' then raise exception 'calculation_not_confirmed'; end if;
  if p_start is null or p_duration<=0 or p_cliff<0 or p_cliff>p_duration or p_frequency not in ('monthly','quarterly') then raise exception 'invalid_vesting'; end if;
  insert into public.vesting_schedules(company_id,calculation_id,calibration_review_id,contributor_id,
    total_confirmed_units,start_date,duration_months,cliff_months,frequency,created_by)
  values(a.company_id,c.id,review.id,c.contributor_id,review.confirmed_units,p_start,p_duration,p_cliff,p_frequency,a.id)
  on conflict(calculation_id) do nothing returning * into saved;
  if saved.id is null then select * into saved from public.vesting_schedules where calculation_id=c.id; end if;
  insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,after)
    values(a.company_id,a.id,'vesting.created','vesting_schedule',saved.id,to_jsonb(saved));
  return to_jsonb(saved);
end $$;

create or replace function public.forfeit_vesting_schedule(
  p_actor uuid,p_schedule uuid,p_effective date,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.app_users; v public.vesting_schedules; saved public.vesting_events;
begin
  select * into a from public.app_users where id=p_actor and status='active' and role='founder_admin' for share;
  if a.id is null then raise exception 'forbidden'; end if;
  select * into v from public.vesting_schedules where id=p_schedule and company_id=a.company_id for share;
  if v.id is null then raise exception 'vesting_not_found'; end if;
  if p_effective<v.start_date or p_reason is null or length(trim(p_reason)) not between 5 and 1000 then raise exception 'invalid_forfeiture'; end if;
  insert into public.vesting_events(company_id,vesting_schedule_id,event_type,effective_date,reason,actor_id)
    values(a.company_id,v.id,'forfeited',p_effective,trim(p_reason),a.id) returning * into saved;
  insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,after)
    values(a.company_id,a.id,'vesting.forfeited','vesting_schedule',v.id,to_jsonb(saved));
  return to_jsonb(saved);
end $$;

create or replace function public.persist_period_settlement(
  p_actor uuid,p_start date,p_end date,p_as_of date,p_hash text,p_members jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.app_users; saved public.period_settlements; prior uuid; next_version integer; item jsonb; total numeric:=0; share_total numeric:=0;
begin
  select * into a from public.app_users where id=p_actor and status='active' and role='founder_admin' for share;
  if a.id is null then raise exception 'forbidden'; end if;
  if p_end<p_start or p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_members)<>'array' or jsonb_array_length(p_members)=0 then raise exception 'invalid_settlement'; end if;
  perform pg_advisory_xact_lock(hashtextextended(a.company_id::text||':'||p_start::text||':'||p_end::text||':settlement',0));
  select id into prior from public.period_settlements where company_id=a.company_id and period_start=p_start and period_end=p_end and input_hash=p_hash;
  if prior is not null then return (select jsonb_build_object('idempotent',true,'settlement',to_jsonb(x)) from public.period_settlements x where id=prior); end if;
  select coalesce(max(version),0)+1 into next_version from public.period_settlements where company_id=a.company_id and period_start=p_start and period_end=p_end;
  select coalesce(sum((value->>'eligibleUnits')::numeric),0),coalesce(sum((value->>'relativeShare')::numeric),0)
    into total,share_total from jsonb_array_elements(p_members);
  if total>0 and abs(share_total-100)>0.0001 then raise exception 'share_total_invalid'; end if;
  insert into public.period_settlements(company_id,period_start,period_end,as_of_date,version,input_hash,total_eligible_units,created_by)
    values(a.company_id,p_start,p_end,p_as_of,next_version,p_hash,total,a.id) returning * into saved;
  for item in select value from jsonb_array_elements(p_members) loop
    if not exists(select 1 from public.app_users where id=(item->>'contributorId')::uuid and company_id=a.company_id) then raise exception 'invalid_member'; end if;
    insert into public.period_settlement_members(settlement_id,company_id,contributor_id,confirmed_units,vested_units,eligible_units,relative_share)
    values(saved.id,a.company_id,(item->>'contributorId')::uuid,(item->>'confirmedUnits')::numeric,
      (item->>'vestedUnits')::numeric,(item->>'eligibleUnits')::numeric,(item->>'relativeShare')::numeric);
  end loop;
  insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,after)
    values(a.company_id,a.id,'settlement.created','period_settlement',saved.id,to_jsonb(saved));
  return jsonb_build_object('idempotent',false,'settlement',to_jsonb(saved));
end $$;

create or replace function public.persist_equity_recommendation(
  p_actor uuid,p_member uuid,p_benchmark uuid,p_current numeric,p_min numeric,p_max numeric,p_rationale text,p_snapshot jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.app_users; m public.period_settlement_members; saved public.equity_recommendations;
begin
  select * into a from public.app_users where id=p_actor and status='active' and role='founder_admin' for share;
  if a.id is null then raise exception 'forbidden'; end if;
  select * into m from public.period_settlement_members where id=p_member and company_id=a.company_id for share;
  if m.id is null or not exists(select 1 from public.benchmark_rules where id=p_benchmark and active and (company_id is null or company_id=a.company_id)) then raise exception 'invalid_recommendation'; end if;
  insert into public.equity_recommendations(company_id,settlement_id,settlement_member_id,contributor_id,
    benchmark_rule_id,contribution_share,current_ownership,benchmark_snapshot,recommended_minimum,recommended_maximum,rationale,created_by)
  values(a.company_id,m.settlement_id,m.id,m.contributor_id,p_benchmark,m.relative_share,p_current,p_snapshot,p_min,p_max,p_rationale,a.id)
  on conflict(settlement_member_id) do update set benchmark_rule_id=excluded.benchmark_rule_id,current_ownership=excluded.current_ownership,
    benchmark_snapshot=excluded.benchmark_snapshot,recommended_minimum=excluded.recommended_minimum,
    recommended_maximum=excluded.recommended_maximum,rationale=excluded.rationale
    where equity_recommendations.status='draft' returning * into saved;
  if saved.id is null then raise exception 'recommendation_locked'; end if;
  insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,after)
    values(a.company_id,a.id,'recommendation.generated','equity_recommendation',saved.id,to_jsonb(saved));
  return to_jsonb(saved);
end $$;

create or replace function public.approve_equity_recommendation(
  p_actor uuid,p_recommendation uuid,p_allocation numeric
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.app_users; saved public.equity_recommendations;
begin
  select * into a from public.app_users where id=p_actor and status='active' and role='founder_admin' for share;
  if a.id is null then raise exception 'forbidden'; end if;
  if p_allocation<0 or p_allocation>100 then raise exception 'invalid_allocation'; end if;
  update public.equity_recommendations set status='approved',approved_allocation=p_allocation,approved_by=a.id,approved_at=now()
    where id=p_recommendation and company_id=a.company_id and status='draft' returning * into saved;
  if saved.id is null then raise exception 'recommendation_not_approvable'; end if;
  insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,after)
    values(a.company_id,a.id,'recommendation.approved','equity_recommendation',saved.id,to_jsonb(saved));
  return to_jsonb(saved);
end $$;

create or replace function public.create_equity_export(
  p_actor uuid,p_recommendation uuid,p_destination text,p_payload jsonb,p_hash text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.app_users; r public.equity_recommendations; saved public.equity_exports;
begin
  select * into a from public.app_users where id=p_actor and status='active' and role='founder_admin' for share;
  if a.id is null then raise exception 'forbidden'; end if;
  select * into r from public.equity_recommendations where id=p_recommendation and company_id=a.company_id and status in ('approved','exported') for update;
  if r.id is null or p_destination not in ('csv','json','manual_legal','carta','cake_equity') or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_export'; end if;
  insert into public.equity_exports(company_id,recommendation_id,destination,payload,payload_hash,created_by)
    values(a.company_id,r.id,p_destination,p_payload,p_hash,a.id)
    on conflict(recommendation_id,destination,payload_hash) do update set payload=excluded.payload returning * into saved;
  update public.equity_recommendations set status='exported' where id=r.id;
  insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,after)
    values(a.company_id,a.id,'recommendation.exported','equity_recommendation',r.id,to_jsonb(saved));
  return to_jsonb(saved);
end $$;

revoke all on function public.calibrate_contribution_calculation(uuid,uuid,text,numeric,text) from public,anon,authenticated;
revoke all on function public.create_vesting_schedule(uuid,uuid,date,integer,integer,text) from public,anon,authenticated;
revoke all on function public.forfeit_vesting_schedule(uuid,uuid,date,text) from public,anon,authenticated;
revoke all on function public.persist_period_settlement(uuid,date,date,date,text,jsonb) from public,anon,authenticated;
revoke all on function public.persist_equity_recommendation(uuid,uuid,uuid,numeric,numeric,numeric,text,jsonb) from public,anon,authenticated;
revoke all on function public.approve_equity_recommendation(uuid,uuid,numeric) from public,anon,authenticated;
revoke all on function public.create_equity_export(uuid,uuid,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.calibrate_contribution_calculation(uuid,uuid,text,numeric,text) to service_role;
grant execute on function public.create_vesting_schedule(uuid,uuid,date,integer,integer,text) to service_role;
grant execute on function public.forfeit_vesting_schedule(uuid,uuid,date,text) to service_role;
grant execute on function public.persist_period_settlement(uuid,date,date,date,text,jsonb) to service_role;
grant execute on function public.persist_equity_recommendation(uuid,uuid,uuid,numeric,numeric,numeric,text,jsonb) to service_role;
grant execute on function public.approve_equity_recommendation(uuid,uuid,numeric) to service_role;
grant execute on function public.create_equity_export(uuid,uuid,text,jsonb,text) to service_role;

commit;
