-- SCRAMBLE / EXISTING SUPABASE PROJECT / MANUAL FULL-SCHEMA MIGRATION
-- Review before use. Do not run through db push. Run once in SQL Editor only after backup.
-- No tables/rows are dropped. This script deliberately aborts if the observed
-- baseline differs; a second run aborts before changing anything.
-- Sources: four 202609 domain migrations, followed by the reviewed Phase 2
-- consolidation of five 202610 migrations. Do not run those sources separately.
-- One outer transaction: all work commits together or rolls back together.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $scramble_preflight$
declare
  object_name text;
begin
  if current_setting('server_version_num')::integer < 150000 then
    raise exception 'PostgreSQL 15+ required for security_invoker views';
  end if;
  if has_schema_privilege('anon', 'public', 'CREATE')
    or has_schema_privilege('authenticated', 'public', 'CREATE') then
    raise exception 'Untrusted role can CREATE in public schema; unsafe for legacy SECURITY DEFINER functions';
  end if;
  foreach object_name in array array[
    'auth.users', 'public.profiles', 'public.workspaces', 'public.workspace_members',
    'public.founder_profiles', 'public.founder_needs', 'public.companies', 'public.company_assets',
    'public.accelerator_programs', 'public.accelerator_applications',
    'public.application_questions', 'public.application_answers',
    'public.knowledge_base_entries', 'public.knowledge_sources',
    'public.scrape_snapshots', 'public.browser_agent_runs',
    'public.browser_agent_artifacts', 'public.usage_counters',
    'public.notifications', 'public.audit_logs',
    'storage.buckets', 'storage.objects'
  ] loop
    if to_regclass(object_name) is null then
      raise exception 'Required baseline table % missing; stop for manual review', object_name;
    end if;
  end loop;
  foreach object_name in array array[
    'public.app_users',
    'public.goals',
    'public.integrations',
    'public.tag_mapping_rules',
    'public.goal_link_rules',
    'public.signals',
    'public.sync_logs',
    'public.audit_log',
    'public.goal_weight_votes',
    'public.goal_creation_requests',
    'public.contribution_engine_settings',
    'public.contributor_fmv_rates',
    'public.contributor_risk_profiles',
    'public.signal_contributors',
    'public.fx_rate_snapshots',
    'public.contribution_calculations',
    'public.calculation_override_scopes',
    'public.contribution_calculation_overrides',
    'public.calibration_reviews',
    'public.vesting_schedules',
    'public.vesting_events',
    'public.period_settlements',
    'public.period_settlement_members',
    'public.benchmark_rules',
    'public.equity_recommendations',
    'public.equity_exports',
    'public.application_submit_authorizations',
    'public.application_dispatch_jobs',
    'public.source_analysis_jobs'
  ] loop
    if to_regclass(object_name) is not null then
      raise exception 'Domain table % already exists; script is for the verified blank domain schema only', object_name;
    end if;
  end loop;
  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.companies'::regclass
      and attname = 'sector' and attnum > 0 and not attisdropped
      and atttypid <> 'text'::regtype
  ) then
    raise exception 'companies.sector exists with an incompatible type';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array[
      'auth_company_id', 'auth_role', 'auth_app_user_id',
      'goal_consensus', 'mutate_weighted_goal', 'create_weighted_goals',
      'ensure_contribution_settings', 'enforce_signal_attribution_cap',
      'persist_contribution_calculation', 'override_contribution_calculation',
      'calibrate_contribution_calculation', 'create_vesting_schedule',
      'forfeit_vesting_schedule', 'persist_period_settlement',
      'persist_equity_recommendation', 'approve_equity_recommendation',
      'create_equity_export', 'claim_application_dispatch_jobs',
      'begin_application_dispatch', 'claim_source_analysis_jobs'
    ])
  ) or to_regclass('public.unlinked_signal_queue') is not null
    or exists (select 1 from pg_trigger
      where tgrelid = 'public.companies'::regclass
        and tgname = 'companies_contribution_settings' and not tgisinternal) then
    raise exception 'An existing domain function/view/trigger would be replaced; inspect it before migrating';
  end if;
end
$scramble_preflight$;

-- The core companies table already exists. The old Signal migration's
-- CREATE TABLE IF NOT EXISTS therefore cannot add this required column.
alter table public.companies add column if not exists sector text;


-- BEGIN SOURCE: 202609010001_signal_engine.sql
-- Rising Signal Engine compatibility migration (historical source body).
-- The enclosing manual script is deliberately run-once and fail-closed.

create extension if not exists pgcrypto;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  stage text,
  sector text,
  created_at timestamptz not null default now()
);

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  email text not null,
  role text not null default 'contributor'
    check (role in ('founder_admin','team_lead','contributor','viewer_investor')),
  status text not null default 'active',
  created_at timestamptz not null default now()
);
alter table public.app_users add column if not exists external_jira_account_id text;
create unique index if not exists app_users_company_jira_uidx
  on public.app_users(company_id, external_jira_account_id)
  where external_jira_account_id is not null;

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  goal_code text not null,
  name text not null,
  weight numeric(5,2) not null default 0,
  owning_team text,
  period_start date not null default current_date,
  period_end date not null default (current_date + 90),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (company_id, goal_code)
);

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tool text not null,
  status text not null default 'not_connected',
  auth_method text not null default 'api_token',
  external_workspace_name text,
  external_account_email text,
  encrypted_credentials bytea,
  credentials_nonce bytea,
  scope text,
  webhook_secret text,
  connected_by uuid references public.app_users(id),
  last_sync_at timestamptz,
  last_sync_cursor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, tool)
);
alter table public.integrations add column if not exists display_name text not null default 'Jira';
alter table public.integrations add column if not exists base_url text;
alter table public.integrations add column if not exists account_label text;
alter table public.integrations add column if not exists credentials_encrypted text;
alter table public.integrations add column if not exists webhook_secret_hash text;
alter table public.integrations add column if not exists sync_frequency text not null default 'hourly';
alter table public.integrations add column if not exists last_successful_sync_at timestamptz;
alter table public.integrations add column if not exists last_error text;
alter table public.integrations add column if not exists created_by uuid references public.app_users(id) on delete set null;
update public.integrations
set
  base_url = coalesce(base_url, case when external_workspace_name is not null then 'https://' || trim(both '/' from external_workspace_name) end),
  account_label = coalesce(account_label, external_account_email),
  last_successful_sync_at = coalesce(last_successful_sync_at, last_sync_at)
where base_url is null or account_label is null or last_successful_sync_at is null;
-- Legacy webhook secrets were stored in plaintext. New connections keep only a SHA-256 hash.
update public.integrations set webhook_secret = null where webhook_secret is not null;

create table if not exists public.tag_mapping_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  source_field text not null,
  source_value text not null,
  target_tag_type text not null,
  target_tag_value text not null,
  priority integer not null default 100,
  is_default boolean not null default false,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  unique (company_id, integration_id, source_field, source_value, target_tag_type)
);
alter table public.tag_mapping_rules add column if not exists contribution_type text;
alter table public.tag_mapping_rules add column if not exists normalized_domain_tag text;
alter table public.tag_mapping_rules add column if not exists weight_class text;
alter table public.tag_mapping_rules add column if not exists is_active boolean not null default true;
alter table public.tag_mapping_rules add column if not exists updated_at timestamptz not null default now();
update public.tag_mapping_rules set
  contribution_type = coalesce(contribution_type, case target_tag_value
    when 'CONTRIB-TIME' then 'TIME' when 'CONTRIB-CASH' then 'MONEY'
    when 'CONTRIB-EXPENSE' then 'MONEY' when 'CONTRIB-IDEA' then 'IP'
    when 'CONTRIB-RELATIONSHIP' then 'IP' end),
  normalized_domain_tag = coalesce(normalized_domain_tag, case target_tag_value
    when 'DOMAIN-ENG' then 'ENG' when 'DOMAIN-PRODUCT' then 'DESIGN'
    when 'DOMAIN-MKT' then 'GROWTH' when 'DOMAIN-SALES' then 'SALES'
    when 'DOMAIN-OPS' then 'OPS' when 'DOMAIN-CS' then 'OPS'
    when 'DOMAIN-LEADERSHIP' then 'OPS' end),
  weight_class = coalesce(weight_class, case target_tag_value
    when 'WEIGHT-CORE' then 'CORE' when 'WEIGHT-SUPPORTING' then 'SUPPORTING'
    when 'WEIGHT-EXPERIMENTAL' then 'SUPPORTING' end);

create table if not exists public.goal_link_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  match_type text not null,
  match_value text not null,
  priority integer not null default 100,
  created_at timestamptz not null default now()
);
alter table public.goal_link_rules add column if not exists integration_id uuid references public.integrations(id) on delete cascade;
alter table public.goal_link_rules add column if not exists source_project_key text;
alter table public.goal_link_rules add column if not exists source_label text;
alter table public.goal_link_rules add column if not exists source_keyword text;
alter table public.goal_link_rules add column if not exists is_active boolean not null default true;
alter table public.goal_link_rules add column if not exists created_by uuid references public.app_users(id) on delete set null;
alter table public.goal_link_rules add column if not exists updated_at timestamptz not null default now();
update public.goal_link_rules r set
  integration_id = coalesce(r.integration_id, (
    select i.id from public.integrations i where i.company_id = r.company_id and i.tool = 'jira' limit 1
  )),
  source_project_key = coalesce(source_project_key, case when match_type = 'project_key' then match_value end),
  source_label = coalesce(source_label, case when match_type = 'label' then match_value end),
  source_keyword = coalesce(source_keyword, case when match_type = 'keyword' then match_value end);

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  integration_id uuid not null references public.integrations(id) on delete cascade,
  source_tool text not null,
  external_id text not null,
  external_key text,
  external_url text,
  event_type text not null,
  actor_external_id text,
  actor_app_user_id uuid references public.app_users(id),
  raw_payload jsonb not null default '{}',
  occurred_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  contrib_tag text,
  domain_tag text,
  weight_tag text,
  tag_confidence numeric(4,3) not null default 0,
  applied_rule_ids uuid[] default '{}',
  goal_id uuid references public.goals(id),
  goal_link_confidence numeric(4,3),
  goal_link_method text,
  status text not null default 'unlinked',
  dedupe_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.signals alter column status set default 'unlinked';
alter table public.signals add column if not exists source_event_id text;
alter table public.signals add column if not exists source_event_type text;
alter table public.signals add column if not exists source_fingerprint text;
alter table public.signals add column if not exists source_url text;
alter table public.signals add column if not exists actor_user_id uuid references public.app_users(id) on delete set null;
alter table public.signals add column if not exists summary text;
alter table public.signals add column if not exists contribution_type text;
alter table public.signals add column if not exists normalized_domain_tag text;
alter table public.signals add column if not exists weight_class text;
alter table public.signals add column if not exists tag_source text not null default 'automated';
alter table public.signals add column if not exists applied_tag_rule_ids uuid[] not null default '{}';
alter table public.signals add column if not exists goal_link_reason text not null default 'no_match';
alter table public.signals add column if not exists goal_link_source text not null default 'automated';
alter table public.signals add column if not exists updated_at timestamptz not null default now();
create unique index if not exists signals_integration_fingerprint_uidx
  on public.signals(integration_id, source_fingerprint) where source_fingerprint is not null;
create index if not exists signals_company_status_idx on public.signals(company_id, status, occurred_at desc);

create table if not exists public.sync_logs (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid not null references public.integrations(id) on delete cascade,
  trigger_type text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  signals_ingested_count integer not null default 0,
  signals_failed_count integer not null default 0,
  error_detail text
);
alter table public.sync_logs add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.sync_logs add column if not exists completed_at timestamptz;
alter table public.sync_logs add column if not exists fetched_count integer not null default 0;
alter table public.sync_logs add column if not exists created_count integer not null default 0;
alter table public.sync_logs add column if not exists duplicate_count integer not null default 0;
alter table public.sync_logs add column if not exists error_message text;
update public.sync_logs l set company_id = i.company_id
from public.integrations i where l.integration_id = i.id and l.company_id is null;

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid references public.app_users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.auth_company_id() returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$ select company_id from public.app_users where auth_user_id = auth.uid() limit 1 $$;
create or replace function public.auth_role() returns text
language sql stable security definer set search_path = public, pg_temp
as $$ select role from public.app_users where auth_user_id = auth.uid() limit 1 $$;
revoke all on function public.auth_company_id() from public;
revoke all on function public.auth_role() from public;
grant execute on function public.auth_company_id() to authenticated;
grant execute on function public.auth_role() to authenticated;

alter table public.integrations enable row level security;
alter table public.tag_mapping_rules enable row level security;
alter table public.goal_link_rules enable row level security;
alter table public.signals enable row level security;
alter table public.sync_logs enable row level security;
alter table public.audit_log enable row level security;
alter table public.goals enable row level security;

drop policy if exists signals_select on public.signals;
drop policy if exists signals_write on public.signals;
drop policy if exists signals_update on public.signals;
create policy signals_select on public.signals for select to authenticated
  using (company_id = public.auth_company_id());
create policy signals_update on public.signals for update to authenticated
  using (company_id = public.auth_company_id() and public.auth_role() in ('founder_admin','team_lead'))
  with check (company_id = public.auth_company_id() and public.auth_role() in ('founder_admin','team_lead'));

drop policy if exists integrations_select on public.integrations;
drop policy if exists integrations_write on public.integrations;
create policy integrations_select on public.integrations for select to authenticated
  using (company_id = public.auth_company_id());

drop policy if exists tag_rules_select on public.tag_mapping_rules;
drop policy if exists tag_rules_write on public.tag_mapping_rules;
create policy tag_rules_select on public.tag_mapping_rules for select to authenticated
  using (company_id = public.auth_company_id());

drop policy if exists goal_link_rules_select on public.goal_link_rules;
drop policy if exists goal_link_rules_write on public.goal_link_rules;
create policy goal_link_rules_select on public.goal_link_rules for select to authenticated
  using (company_id = public.auth_company_id());

drop policy if exists sync_logs_select on public.sync_logs;
create policy sync_logs_select on public.sync_logs for select to authenticated
  using (company_id = public.auth_company_id());

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log for select to authenticated
  using (company_id = public.auth_company_id() and public.auth_role() = 'founder_admin');

drop policy if exists goals_select on public.goals;
create policy goals_select on public.goals for select to authenticated
  using (company_id = public.auth_company_id());

create or replace view public.unlinked_signal_queue
with (security_invoker = true)
as select * from public.signals where status in ('unlinked','manual_review') order by occurred_at desc;
grant select on public.unlinked_signal_queue to authenticated;
-- END SOURCE: 202609010001_signal_engine.sql

-- BEGIN SOURCE: 202609040001_goal_weighting_engine.sql
-- Apply after 202609010001_signal_engine.sql. All writes and their audit
-- records are atomic; browser roles cannot bypass lifecycle functions.
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
-- END SOURCE: 202609040001_goal_weighting_engine.sql

-- BEGIN SOURCE: 202609100001_slice_calculation_engine.sql
-- Engine 03: deterministic provisional Contribution Units.
-- Apply after 202609040001_goal_weighting_engine.sql.

alter table public.signals add column if not exists calculation_strategy text;
alter table public.signals add column if not exists calculation_weight_class text;
alter table public.signals add column if not exists calculation_domain text;
alter table public.signals add column if not exists calculation_revision integer not null default 0;
alter table public.signals add column if not exists calculation_period_start date;
alter table public.signals add column if not exists calculation_period_end date;
alter table public.signals add column if not exists hours numeric(24,8);
alter table public.signals add column if not exists amount numeric(24,8);
alter table public.signals add column if not exists currency text;
alter table public.signals add column if not exists manual_valuation_amount numeric(24,8);
alter table public.signals add column if not exists manual_valuation_currency text;
alter table public.signals add column if not exists manual_valuation_approved boolean not null default false;
alter table public.signals add column if not exists expense_approved boolean not null default false;
alter table public.signals add column if not exists expense_at_risk_capital boolean not null default false;
alter table public.signals add column if not exists expense_reimbursed boolean not null default false;
alter table public.signals add column if not exists economic_value_amount numeric(24,8);
alter table public.signals add column if not exists economic_value_currency text;
alter table public.signals drop constraint if exists signals_calculation_strategy_check;
alter table public.signals add constraint signals_calculation_strategy_check check (
  calculation_strategy is null or calculation_strategy in ('TIME','CASH','EXPENSE','IDEA','RELATIONSHIP')
);
alter table public.signals drop constraint if exists signals_calculation_weight_class_check;
alter table public.signals add constraint signals_calculation_weight_class_check check (
  calculation_weight_class is null or calculation_weight_class in ('CORE','SUPPORTING','EXPERIMENTAL')
);
alter table public.signals drop constraint if exists signals_calculation_values_check;
alter table public.signals add constraint signals_calculation_values_check check (
  calculation_revision >= 0 and (hours is null or hours >= 0) and (amount is null or amount >= 0)
  and (manual_valuation_amount is null or manual_valuation_amount >= 0)
  and (economic_value_amount is null or economic_value_amount >= 0)
  and (currency is null or currency ~ '^[A-Z]{3}$')
  and (manual_valuation_currency is null or manual_valuation_currency ~ '^[A-Z]{3}$')
  and (economic_value_currency is null or economic_value_currency ~ '^[A-Z]{3}$')
  and (calculation_period_start is null or calculation_period_end is null or calculation_period_end>=calculation_period_start)
);

update public.signals set
  calculation_strategy = coalesce(calculation_strategy, case contrib_tag
    when 'CONTRIB-TIME' then 'TIME' when 'CONTRIB-CASH' then 'CASH'
    when 'CONTRIB-EXPENSE' then 'EXPENSE' when 'CONTRIB-IDEA' then 'IDEA'
    when 'CONTRIB-RELATIONSHIP' then 'RELATIONSHIP' end),
  calculation_weight_class = coalesce(calculation_weight_class, case weight_tag
    when 'WEIGHT-CORE' then 'CORE' when 'WEIGHT-SUPPORTING' then 'SUPPORTING'
    when 'WEIGHT-EXPERIMENTAL' then 'EXPERIMENTAL' end),
  calculation_domain = coalesce(calculation_domain, domain_tag),
  calculation_period_start = coalesce(calculation_period_start,(select period_start from public.goals where id=signals.goal_id)),
  calculation_period_end = coalesce(calculation_period_end,(select period_end from public.goals where id=signals.goal_id));

create table if not exists public.contribution_engine_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  base_currency text not null default 'EUR' check(base_currency ~ '^[A-Z]{3}$'),
  core_factor numeric(12,8) not null default 1 check(core_factor >= 0),
  supporting_factor numeric(12,8) not null default 0.7 check(supporting_factor >= 0),
  experimental_factor numeric(12,8) not null default 0.4 check(experimental_factor >= 0),
  cash_risk_factor numeric(12,8) not null default 1 check(cash_risk_factor >= 0),
  revenue_attribution_rate numeric(12,8) not null default 0.05 check(revenue_attribution_rate between 0 and 1),
  revenue_signal_cap_base numeric(24,8) check(revenue_signal_cap_base is null or revenue_signal_cap_base >= 0),
  revenue_period_cap_base numeric(24,8) check(revenue_period_cap_base is null or revenue_period_cap_base >= 0),
  allow_at_risk_expense_multiplier boolean not null default true,
  revision integer not null default 0 check(revision >= 0),
  updated_at timestamptz not null default now()
);
insert into public.contribution_engine_settings(company_id)
select id from public.companies on conflict(company_id) do nothing;

create or replace function public.ensure_contribution_settings() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin insert into public.contribution_engine_settings(company_id) values(new.id) on conflict do nothing; return new; end $$;
drop trigger if exists companies_contribution_settings on public.companies;
create trigger companies_contribution_settings after insert on public.companies
for each row execute function public.ensure_contribution_settings();

create table if not exists public.contributor_fmv_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contributor_id uuid not null references public.app_users(id) on delete cascade,
  hourly_rate numeric(24,8) not null check(hourly_rate > 0),
  currency text not null check(currency ~ '^[A-Z]{3}$'),
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  check(effective_to is null or effective_to > effective_from)
);
create index if not exists contributor_fmv_lookup_idx
  on public.contributor_fmv_rates(company_id,contributor_id,effective_from desc);

create table if not exists public.contributor_risk_profiles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  contributor_id uuid not null references public.app_users(id) on delete cascade,
  time_risk_factor numeric(12,8) not null default 1 check(time_risk_factor >= 0),
  cash_risk_factor_override numeric(12,8) check(cash_risk_factor_override is null or cash_risk_factor_override >= 0),
  at_risk_expense_factor numeric(12,8) not null default 1 check(at_risk_expense_factor >= 0),
  effective_from timestamptz not null,
  effective_to timestamptz,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  check(effective_to is null or effective_to > effective_from)
);
create index if not exists contributor_risk_lookup_idx
  on public.contributor_risk_profiles(company_id,contributor_id,effective_from desc);

create table if not exists public.signal_contributors (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  signal_id uuid not null references public.signals(id) on delete cascade,
  contributor_id uuid not null references public.app_users(id) on delete cascade,
  attribution_bps integer not null check(attribution_bps between 1 and 10000),
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(signal_id,contributor_id)
);
create index if not exists signal_contributors_signal_idx on public.signal_contributors(signal_id);

create or replace function public.enforce_signal_attribution_cap() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare total integer; expected_company uuid;
begin
  select company_id into expected_company from public.signals where id=new.signal_id;
  if expected_company is null or expected_company<>new.company_id
    or not exists(select 1 from public.app_users where id=new.contributor_id and company_id=new.company_id and status='active')
    then raise exception 'invalid_signal_contributor'; end if;
  select coalesce(sum(attribution_bps),0) into total from public.signal_contributors
    where signal_id=new.signal_id and id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid);
  if total+new.attribution_bps>10000 then raise exception 'attribution_exceeds_100_percent'; end if;
  new.updated_at:=now(); return new;
end $$;
drop trigger if exists signal_attribution_cap on public.signal_contributors;
create trigger signal_attribution_cap before insert or update on public.signal_contributors
for each row execute function public.enforce_signal_attribution_cap();

create table if not exists public.fx_rate_snapshots (
  id uuid primary key default gen_random_uuid(),
  from_currency text not null check(from_currency ~ '^[A-Z]{3}$'),
  to_currency text not null check(to_currency ~ '^[A-Z]{3}$'),
  rate_date date not null,
  rate numeric(24,12) not null check(rate > 0),
  provider text not null,
  captured_at timestamptz not null default now(),
  unique(from_currency,to_currency,rate_date,provider)
);

create table if not exists public.contribution_calculations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  signal_id uuid not null references public.signals(id) on delete restrict,
  goal_id uuid not null references public.goals(id) on delete restrict,
  contributor_id uuid not null references public.app_users(id) on delete restrict,
  calculation_group_id uuid not null,
  calculation_version integer not null check(calculation_version > 0),
  input_hash text not null check(input_hash ~ '^[a-f0-9]{64}$'),
  engine_version text not null,
  strategy text not null check(strategy in ('TIME','CASH','EXPENSE','IDEA','RELATIONSHIP')),
  valuation_mode text not null,
  status text not null check(status in ('provisional','superseded','error')),
  company_base_currency text not null,
  original_base_value numeric(24,8) not null,
  original_currency text not null,
  normalized_base_value numeric(24,8) not null,
  strategy_risk_factor numeric(12,8) not null,
  goal_factor numeric(12,8) not null,
  weight_class text not null check(weight_class in ('CORE','SUPPORTING','EXPERIMENTAL')),
  weight_class_factor numeric(12,8) not null,
  contributor_attribution_bps integer not null check(contributor_attribution_bps between 1 and 10000),
  contribution_units numeric(30,8) not null check(contribution_units >= 0),
  revenue_raw_attributable_value numeric(24,8),
  revenue_signal_capped_value numeric(24,8),
  revenue_period_remaining_before numeric(24,8),
  fx_snapshot jsonb,
  input_snapshot jsonb not null,
  explanation jsonb not null,
  created_by uuid references public.app_users(id),
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  check(period_end>=period_start)
);
create index if not exists contribution_calculations_signal_idx
  on public.contribution_calculations(company_id,signal_id,calculation_version desc);
create unique index if not exists contribution_calculations_active_contributor_uidx
  on public.contribution_calculations(signal_id,contributor_id) where status='provisional';
create unique index if not exists contribution_calculations_group_contributor_uidx
  on public.contribution_calculations(calculation_group_id,contributor_id);

create table if not exists public.calculation_override_scopes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_id uuid not null references public.app_users(id) on delete cascade,
  scope_type text not null check(scope_type in ('TEAM','DOMAIN')),
  scope_value text not null,
  granted_by uuid not null references public.app_users(id),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id,actor_id,scope_type,scope_value),
  check(effective_to is null or effective_to>effective_from)
);

create table if not exists public.contribution_calculation_overrides (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  calculation_id uuid not null references public.contribution_calculations(id) on delete restrict,
  actor_id uuid not null references public.app_users(id) on delete restrict,
  actor_role text not null check(actor_role in ('Founder/Admin','Team Lead')),
  scope_type text not null check(scope_type in ('COMPANY','TEAM','DOMAIN')),
  scope_id text,
  previous_units numeric(30,8) not null,
  new_units numeric(30,8) not null check(new_units >= 0),
  reason text not null check(length(trim(reason)) between 5 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists calculation_overrides_calc_idx
  on public.contribution_calculation_overrides(calculation_id,created_at desc);

alter table public.contribution_engine_settings enable row level security;
alter table public.contributor_fmv_rates enable row level security;
alter table public.contributor_risk_profiles enable row level security;
alter table public.signal_contributors enable row level security;
alter table public.fx_rate_snapshots enable row level security;
alter table public.contribution_calculations enable row level security;
alter table public.calculation_override_scopes enable row level security;
alter table public.contribution_calculation_overrides enable row level security;

do $$ declare t text; begin
  foreach t in array array['contribution_engine_settings','contributor_fmv_rates','contributor_risk_profiles','signal_contributors','contribution_calculations','calculation_override_scopes','contribution_calculation_overrides'] loop
    execute format('drop policy if exists %I on public.%I',t||'_select',t);
    execute format('create policy %I on public.%I for select to authenticated using(company_id=public.auth_company_id())',t||'_select',t);
  end loop;
end $$;
drop policy if exists fx_rate_snapshots_select on public.fx_rate_snapshots;
create policy fx_rate_snapshots_select on public.fx_rate_snapshots for select to authenticated using(true);

revoke insert,update,delete on public.contribution_engine_settings,public.contributor_fmv_rates,
  public.contributor_risk_profiles,public.signal_contributors,public.fx_rate_snapshots,
  public.contribution_calculations,public.calculation_override_scopes,
  public.contribution_calculation_overrides from anon,authenticated;
grant select on public.contribution_engine_settings,public.contributor_fmv_rates,
  public.contributor_risk_profiles,public.signal_contributors,public.fx_rate_snapshots,
  public.contribution_calculations,public.calculation_override_scopes,
  public.contribution_calculation_overrides to authenticated;

create or replace function public.persist_contribution_calculation(
  p_actor uuid, p_signal uuid, p_input_hash text, p_engine_version text,
  p_rows jsonb, p_expected_revenue_consumed numeric default null
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.app_users; s public.signals; existing_group uuid; next_version integer;
  actual_consumed numeric:=0; row_item jsonb; inserted jsonb:='[]'::jsonb; saved_calc public.contribution_calculations;
begin
  select * into a from public.app_users where id=p_actor and status='active' for share;
  if a.id is null then raise exception 'forbidden'; end if;
  select * into s from public.signals where id=p_signal and company_id=a.company_id for update;
  if s.id is null then raise exception 'signal_not_found'; end if;
  if p_input_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)=0 then raise exception 'invalid_calculation'; end if;
  perform pg_advisory_xact_lock(hashtextextended(a.company_id::text||':'||p_signal::text||':calculation',0));
  select calculation_group_id into existing_group from public.contribution_calculations
    where company_id=a.company_id and signal_id=p_signal and status='provisional' and input_hash=p_input_hash limit 1;
  if existing_group is not null then
    return jsonb_build_object('idempotent',true,'calculations',(
      select jsonb_agg(to_jsonb(c) order by c.contributor_id) from public.contribution_calculations c where c.calculation_group_id=existing_group));
  end if;
  if p_expected_revenue_consumed is not null then
    perform pg_advisory_xact_lock(hashtextextended(a.company_id::text||':'||(p_rows->0->>'periodStart')||':'||(p_rows->0->>'periodEnd')||':revenue-cap',0));
    select coalesce(sum(x.revenue_signal_capped_value),0) into actual_consumed from (
      select distinct on(c.signal_id) c.signal_id,c.revenue_signal_capped_value
      from public.contribution_calculations c where c.company_id=a.company_id and c.status='provisional'
        and c.signal_id<>p_signal and c.valuation_mode='revenue_attribution'
        and c.period_start=(p_rows->0->>'periodStart')::date and c.period_end=(p_rows->0->>'periodEnd')::date
      order by c.signal_id,c.calculation_version desc
    ) x;
    if actual_consumed<>p_expected_revenue_consumed then raise exception 'revenue_cap_changed'; end if;
  end if;
  select coalesce(max(calculation_version),0)+1 into next_version from public.contribution_calculations where signal_id=p_signal;
  update public.contribution_calculations set status='superseded',superseded_at=now()
    where signal_id=p_signal and status='provisional';
  for row_item in select value from jsonb_array_elements(p_rows) loop
    if row_item->>'companyId'<>a.company_id::text or row_item->>'signalId'<>p_signal::text then raise exception 'invalid_calculation'; end if;
    insert into public.contribution_calculations(
      company_id,period_start,period_end,signal_id,goal_id,contributor_id,calculation_group_id,
      calculation_version,input_hash,engine_version,strategy,valuation_mode,status,company_base_currency,
      original_base_value,original_currency,normalized_base_value,strategy_risk_factor,goal_factor,
      weight_class,weight_class_factor,contributor_attribution_bps,contribution_units,
      revenue_raw_attributable_value,revenue_signal_capped_value,revenue_period_remaining_before,
      fx_snapshot,input_snapshot,explanation,created_by)
    values(a.company_id,(row_item->>'periodStart')::date,(row_item->>'periodEnd')::date,p_signal,
      (row_item->>'goalId')::uuid,(row_item->>'contributorId')::uuid,(row_item->>'calculationGroupId')::uuid,
      next_version,p_input_hash,p_engine_version,row_item->>'strategy',row_item->>'valuationMode','provisional',
      row_item->>'companyBaseCurrency',(row_item->>'originalBaseValue')::numeric,row_item->>'originalCurrency',
      (row_item->>'normalizedBaseValue')::numeric,(row_item->>'strategyRiskFactor')::numeric,
      (row_item->>'goalFactor')::numeric,row_item->>'weightClass',(row_item->>'weightClassFactor')::numeric,
      (row_item->>'contributorAttributionBps')::integer,(row_item->>'contributionUnits')::numeric,
      nullif(row_item->>'revenueRawAttributableValue','')::numeric,
      nullif(row_item->>'revenueSignalCappedValue','')::numeric,
      nullif(row_item->>'revenuePeriodRemainingBefore','')::numeric,
      row_item->'fxSnapshot',row_item->'inputSnapshot',row_item->'explanation',a.id)
    returning * into saved_calc;
    inserted:=inserted||jsonb_build_array(to_jsonb(saved_calc));
  end loop;
  insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,after)
    values(a.company_id,a.id,'calculation.created','signal',p_signal,
      jsonb_build_object('inputHash',p_input_hash,'version',next_version,'rows',jsonb_array_length(p_rows)));
  return jsonb_build_object('idempotent',false,'calculations',inserted);
end $$;

create or replace function public.override_contribution_calculation(
  p_actor uuid,p_calculation uuid,p_new_units numeric,p_reason text
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.app_users; c public.contribution_calculations; s public.signals; g public.goals;
  prior numeric; st text; sid text; role_label text; saved public.contribution_calculation_overrides;
begin
  select * into a from public.app_users where id=p_actor and status='active' for share;
  if a.id is null or a.role not in ('founder_admin','team_lead') then raise exception 'forbidden'; end if;
  select * into c from public.contribution_calculations where id=p_calculation and company_id=a.company_id and status='provisional' for share;
  if c.id is null then raise exception 'calculation_not_found'; end if;
  if p_new_units is null or p_new_units<0 or p_reason is null or length(trim(p_reason)) not between 5 and 1000 then raise exception 'invalid_override'; end if;
  select * into s from public.signals where id=c.signal_id;
  select * into g from public.goals where id=c.goal_id;
  if a.role='founder_admin' then st:='COMPANY'; sid:=null; role_label:='Founder/Admin';
  else
    select scope_type,scope_value into st,sid from public.calculation_override_scopes os
      where os.actor_id=a.id and os.company_id=a.company_id and os.effective_from<=now()
        and (os.effective_to is null or os.effective_to>now()) and
        ((os.scope_type='TEAM' and os.scope_value=g.owning_team) or
         (os.scope_type='DOMAIN' and os.scope_value=coalesce(s.calculation_domain,s.domain_tag)))
      order by case when os.scope_type='TEAM' then 0 else 1 end limit 1;
    if st is null then raise exception 'override_scope_forbidden'; end if;
    role_label:='Team Lead';
  end if;
  select coalesce((select new_units from public.contribution_calculation_overrides where calculation_id=c.id order by created_at desc limit 1),c.contribution_units) into prior;
  insert into public.contribution_calculation_overrides(company_id,calculation_id,actor_id,actor_role,scope_type,scope_id,previous_units,new_units,reason)
    values(a.company_id,c.id,a.id,role_label,st,sid,prior,p_new_units,trim(p_reason)) returning * into saved;
  insert into public.audit_log(company_id,actor_id,action,entity_type,entity_id,before,after)
    values(a.company_id,a.id,'calculation.overridden','contribution_calculation',c.id,
      jsonb_build_object('units',prior),jsonb_build_object('units',p_new_units,'reason',trim(p_reason),'scopeType',st,'scopeId',sid));
  return to_jsonb(saved);
end $$;

revoke all on function public.persist_contribution_calculation(uuid,uuid,text,text,jsonb,numeric) from public,anon,authenticated;
revoke all on function public.override_contribution_calculation(uuid,uuid,numeric,text) from public,anon,authenticated;
grant execute on function public.persist_contribution_calculation(uuid,uuid,text,text,jsonb,numeric) to service_role;
grant execute on function public.override_contribution_calculation(uuid,uuid,numeric,text) to service_role;
-- END SOURCE: 202609100001_slice_calculation_engine.sql

-- BEGIN SOURCE: 202609120001_equity_lifecycle_engines.sql
-- Engines 04-08: calibration, vesting, settlement, benchmark,
-- recommendation, export and coach read models.
-- Apply after 202609100001_slice_calculation_engine.sql.

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
-- END SOURCE: 202609120001_equity_lifecycle_engines.sql

-- Correct a missing RLS boundary in the original Signal migration.
-- app_users is accessed server-side; only SECURITY DEFINER helpers resolve
-- auth_user_id for authenticated clients.
alter table public.app_users enable row level security;
revoke all on public.app_users from public, anon, authenticated;
grant select, insert, update, delete on public.app_users to service_role;

-- BEGIN SOURCE: reviewed Phase 2 patch (pitch deck, unified profile,
-- submission authorization, application dispatch, source analysis).
-- Reviewed additive Phase 2 consolidation for the existing Supabase project.
-- This section is embedded in the outer transaction; do not run it separately.
-- The script does not delete rows/tables, reset auth, or replace existing policies.
-- On error, the transaction is aborted; do not continue or rerun blindly.
-- If SQL Editor keeps the session open, issue ROLLBACK and inspect the error.

set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $preflight$
declare object_name text; has_active boolean;
begin
  if current_setting('server_version_num')::integer < 120000 then
    raise exception 'PostgreSQL 12+ required for transactional ALTER TYPE ADD VALUE';
  end if;
  -- Older Signal/Goal/Slice/Equity migrations have live sentinel objects. Their
  -- destructive/rewriting DDL must not be replayed as part of this patch.
  foreach object_name in array array[
    'public.workspaces', 'public.workspace_members', 'public.companies',
    'public.company_assets', 'public.accelerator_programs',
    'public.accelerator_applications', 'public.browser_agent_runs',
    'public.signals', 'public.goals', 'public.goal_weight_votes',
    'public.contribution_calculations', 'public.calibration_reviews',
    'storage.buckets', 'storage.objects'
  ] loop
    if to_regclass(object_name) is null then
      raise exception 'Required existing table % is missing; stop and inspect migration history', object_name;
    end if;
  end loop;
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'application_status' and t.typtype = 'e'
  ) then
    raise exception 'public.application_status enum is missing or has a different type';
  end if;
  if not exists (
    select 1 from pg_attribute a
    where a.attrelid = 'public.accelerator_applications'::regclass
      and a.attname = 'status' and a.atttypid = 'public.application_status'::regtype
      and a.attnum > 0 and not a.attisdropped
  ) then
    raise exception 'accelerator_applications.status does not use public.application_status';
  end if;
  if exists (select 1 from storage.buckets where id = 'pitch-decks' and public) then
    raise exception 'Existing pitch-decks bucket is public; do not silently change access. Review manually.';
  end if;
  if exists (select 1 from storage.buckets where id = 'pitch-decks' and name <> 'pitch-decks') then
    raise exception 'Existing pitch-decks bucket has an unexpected name; inspect it first';
  end if;
  if to_regclass('public.application_dispatch_jobs') is not null then
    execute 'select exists (select 1 from public.application_dispatch_jobs where status in
      (''queued'',''claimed'',''dispatching'',''dispatched'',''unknown_dispatch''))' into has_active;
    if has_active then raise exception 'Active application jobs exist; reconcile before replacing dispatcher functions'; end if;
  end if;
  if to_regclass('public.source_analysis_jobs') is not null then
    execute 'select exists (select 1 from public.source_analysis_jobs where status in
      (''queued'',''running''))' into has_active;
    if has_active then raise exception 'Active source jobs exist; let them finish before migration'; end if;
  end if;
  if exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.company_assets'::regclass
      and c.conname = 'company_assets_analysis_status_check'
      and (
        position('uploaded' in pg_get_constraintdef(c.oid)) = 0 or
        position('processing' in pg_get_constraintdef(c.oid)) = 0 or
        position('processed' in pg_get_constraintdef(c.oid)) = 0 or
        position('failed' in pg_get_constraintdef(c.oid)) = 0
      )
  ) then
    raise exception 'Existing deck analysis status constraint differs; inspect it before migrating';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.companies'::regclass)
     or not (select c.relrowsecurity from pg_class c where c.oid = 'public.company_assets'::regclass)
     or not (select c.relrowsecurity from pg_class c where c.oid = 'storage.objects'::regclass)
  then
    raise exception 'Expected RLS is not enabled on a pre-existing company/asset/storage table';
  end if;
end
$preflight$;

-- 202610070001: add deck extraction fields without dropping an existing constraint.
alter table public.company_assets
  add column if not exists analysis_status text,
  add column if not exists extracted_text text,
  add column if not exists extracted_json jsonb,
  add column if not exists analysis_error text,
  add column if not exists processed_at timestamptz;

-- 202610080001 and 202610090002: unified profile and content fingerprint.
alter table public.company_assets
  add column if not exists extracted_pages jsonb,
  add column if not exists content_sha256 text;
alter table public.companies
  add column if not exists unified_analysis jsonb,
  add column if not exists canonical_profile jsonb,
  add column if not exists profile_confirmed_at timestamptz,
  add column if not exists profile_confirmed_by uuid references auth.users(id);

do $validate_columns$
declare bad text;
begin
  select string_agg(format('%s.%s expected %s, found %s', v.tbl, v.col, v.typ,
                           coalesce(format_type(a.atttypid, a.atttypmod), '<missing>')), '; ')
    into bad
  from (values
    ('company_assets','analysis_status','text'),
    ('company_assets','extracted_text','text'),
    ('company_assets','extracted_json','jsonb'),
    ('company_assets','analysis_error','text'),
    ('company_assets','processed_at','timestamp with time zone'),
    ('company_assets','extracted_pages','jsonb'),
    ('company_assets','content_sha256','text'),
    ('companies','unified_analysis','jsonb'),
    ('companies','canonical_profile','jsonb'),
    ('companies','profile_confirmed_at','timestamp with time zone'),
    ('companies','profile_confirmed_by','uuid')
  ) as v(tbl,col,typ)
  left join pg_attribute a on a.attrelid = format('public.%I',v.tbl)::regclass
    and a.attname = v.col and a.attnum > 0 and not a.attisdropped
  where a.attname is null or format_type(a.atttypid,a.atttypmod) <> v.typ;
  if bad is not null then raise exception 'Column type conflict: %', bad; end if;
end
$validate_columns$;

do $deck_constraint$
begin
  if not exists (select 1 from pg_constraint
    where conrelid = 'public.company_assets'::regclass
      and conname = 'company_assets_analysis_status_check') then
    alter table public.company_assets add constraint company_assets_analysis_status_check
      check (analysis_status is null or analysis_status in
        ('uploaded','processing','processed','failed'));
  end if;
end
$deck_constraint$;

create index if not exists company_assets_pitch_deck_latest_idx
  on public.company_assets (company_id, created_at desc) where type = 'pitch_deck';
create index if not exists company_assets_processed_fingerprint_idx
  on public.company_assets (company_id, content_sha256)
  where type = 'pitch_deck' and analysis_status = 'processed' and content_sha256 is not null;

insert into storage.buckets (id, name, public)
values ('pitch-decks', 'pitch-decks', false)
on conflict (id) do nothing;

-- PostgreSQL combines permissive policies with OR. An owner-only permissive
-- policy would NOT tighten an existing broad policy. This restrictive ALL-role
-- guard is ANDed with every policy for pitch-decks, including legacy ones.
-- Other buckets pass the guard unchanged. Service-role access bypasses RLS.
do $storage_guard$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage'
    and tablename = 'objects' and policyname = 'pitch_decks_owner_guard_phase2') then
    create policy pitch_decks_owner_guard_phase2 on storage.objects
      as restrictive for all to public
      using (
        bucket_id is distinct from 'pitch-decks' or exists (
          select 1 from public.workspace_members wm
          join public.companies c on c.workspace_id = wm.workspace_id
          where wm.user_id = (select auth.uid()) and wm.role = 'owner'
            and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
            and c.id::text = split_part(storage.objects.name, '/', 2)
        )
      )
      with check (
        bucket_id is distinct from 'pitch-decks' or exists (
          select 1 from public.workspace_members wm
          join public.companies c on c.workspace_id = wm.workspace_id
          where wm.user_id = (select auth.uid()) and wm.role = 'owner'
            and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
            and c.id::text = split_part(storage.objects.name, '/', 2)
        )
      );
  end if;
end
$storage_guard$;

-- These policies add the required positive permission for authenticated owners.
-- Existing policies remain untouched but cannot bypass the restrictive guard.
do $storage_policies$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage'
    and tablename = 'objects' and policyname = 'pitch_decks_owner_select_phase2') then
    create policy pitch_decks_owner_select_phase2 on storage.objects
      for select to authenticated using (
        bucket_id = 'pitch-decks' and exists (
          select 1 from public.workspace_members wm
          join public.companies c on c.workspace_id = wm.workspace_id
          where wm.user_id = (select auth.uid()) and wm.role = 'owner'
            and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
            and c.id::text = split_part(storage.objects.name, '/', 2)
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage'
    and tablename = 'objects' and policyname = 'pitch_decks_owner_insert_phase2') then
    create policy pitch_decks_owner_insert_phase2 on storage.objects
      for insert to authenticated with check (
        bucket_id = 'pitch-decks' and exists (
          select 1 from public.workspace_members wm
          join public.companies c on c.workspace_id = wm.workspace_id
          where wm.user_id = (select auth.uid()) and wm.role = 'owner'
            and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
            and c.id::text = split_part(storage.objects.name, '/', 2)
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage'
    and tablename = 'objects' and policyname = 'pitch_decks_owner_delete_phase2') then
    create policy pitch_decks_owner_delete_phase2 on storage.objects
      for delete to authenticated using (
        bucket_id = 'pitch-decks' and exists (
          select 1 from public.workspace_members wm
          join public.companies c on c.workspace_id = wm.workspace_id
          where wm.user_id = (select auth.uid()) and wm.role = 'owner'
            and wm.workspace_id::text = split_part(storage.objects.name, '/', 1)
            and c.id::text = split_part(storage.objects.name, '/', 2)
        )
      );
  end if;
end
$storage_policies$;

-- 202610080002: conservative submission status and scoped authorization.
alter type public.application_status add value if not exists 'submission_unverified';
create table if not exists public.application_submit_authorizations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  company_id uuid not null references public.companies(id),
  application_id uuid not null unique references public.accelerator_applications(id),
  program_id uuid not null references public.accelerator_programs(id),
  approved_fill_run_id uuid not null references public.browser_agent_runs(id),
  authorized_by uuid not null references auth.users(id),
  authorized_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  dispatched_at timestamptz,
  constraint application_submit_authorizations_expiry_check check (expires_at > authorized_at)
);
create index if not exists application_submit_authorizations_dispatch_idx
  on public.application_submit_authorizations (expires_at, authorized_at)
  where revoked_at is null and dispatched_at is null;
alter table public.application_submit_authorizations enable row level security;
revoke all on public.application_submit_authorizations from public, anon, authenticated;
grant select, insert, update on public.application_submit_authorizations to service_role;

-- 202610090001: durable, private Skyvern dispatch outbox.
create table if not exists public.application_dispatch_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  company_id uuid not null references public.companies(id),
  application_id uuid not null references public.accelerator_applications(id),
  requested_by uuid not null references auth.users(id),
  kind text not null check (kind in ('fill', 'submit')),
  request_intent jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  status text not null default 'queued' check (status in
    ('queued','claimed','dispatching','dispatched','completed','failed','cancelled','unknown_dispatch')),
  attempts integer not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  correlation_id uuid not null default gen_random_uuid(),
  browser_run_id uuid references public.browser_agent_runs(id),
  external_run_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_dispatch_jobs_intent_object check (jsonb_typeof(request_intent) = 'object')
);
create unique index if not exists application_dispatch_jobs_one_active_kind
  on public.application_dispatch_jobs(application_id, kind)
  where status in ('queued','claimed','dispatching','dispatched','unknown_dispatch');
create index if not exists application_dispatch_jobs_due
  on public.application_dispatch_jobs(next_attempt_at, created_at) where status = 'queued';
create index if not exists application_dispatch_jobs_lease
  on public.application_dispatch_jobs(lease_until) where status in ('claimed','dispatching');
alter table public.application_dispatch_jobs enable row level security;
revoke all on public.application_dispatch_jobs from public, anon, authenticated;
grant select, insert, update on public.application_dispatch_jobs to service_role;

create or replace function public.claim_application_dispatch_jobs(max_jobs integer default 2)
returns setof public.application_dispatch_jobs
language plpgsql security definer set search_path = '' as $application_claim$
declare active_dispatches integer;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(9210921) then return; end if;
  update public.application_dispatch_jobs
     set status = 'unknown_dispatch', lease_until = null,
         error_code = 'LEASE_EXPIRED_AFTER_DISPATCH', updated_at = now()
   where status = 'dispatching' and lease_until < now();
  update public.application_dispatch_jobs
     set status = case when attempts >= 3 then 'failed' else 'queued' end,
         next_attempt_at = now() + make_interval(secs => least(300, (15 * power(2, attempts))::integer)),
         lease_until = null, error_code = 'PRE_DISPATCH_LEASE_EXPIRED', updated_at = now()
   where status = 'claimed' and lease_until < now();
  update public.application_dispatch_jobs j
     set status = 'completed', updated_at = now()
    from public.browser_agent_runs r
   where j.status = 'dispatched' and j.browser_run_id = r.id and r.status = 'completed';
  update public.application_dispatch_jobs j
     set status = 'failed', updated_at = now(), error_code = coalesce(r.error_code,'BROWSER_RUN_FAILED')
    from public.browser_agent_runs r
   where j.status = 'dispatched' and j.browser_run_id = r.id and r.status in ('failed','cancelled');
  select count(*) into active_dispatches from public.application_dispatch_jobs
   where status in ('claimed','dispatching');
  return query with due as (
    select id from public.application_dispatch_jobs
     where status = 'queued' and next_attempt_at <= now() and attempts < 3
     order by created_at for update skip locked
     limit least(greatest(max_jobs,0),greatest(0,2-active_dispatches))
  ) update public.application_dispatch_jobs j
       set status = 'claimed', attempts = attempts + 1,
           lease_until = now() + interval '90 seconds', updated_at = now()
      from due where j.id = due.id returning j.*;
end
$application_claim$;

create or replace function public.begin_application_dispatch(target_job_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $application_begin$
declare changed integer;
begin
  update public.application_dispatch_jobs
     set status = 'dispatching', lease_until = now() + interval '90 seconds', updated_at = now()
   where id = target_job_id and status = 'claimed' and lease_until > now();
  get diagnostics changed = row_count;
  return changed = 1;
end
$application_begin$;
revoke all on function public.claim_application_dispatch_jobs(integer) from public, anon, authenticated;
revoke all on function public.begin_application_dispatch(uuid) from public, anon, authenticated;
grant execute on function public.claim_application_dispatch_jobs(integer) to service_role;
grant execute on function public.begin_application_dispatch(uuid) to service_role;

-- 202610090002: durable website/PDF analysis outbox.
create table if not exists public.source_analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  company_id uuid not null references public.companies(id),
  asset_id uuid references public.company_assets(id),
  requested_by uuid not null references auth.users(id),
  kind text not null check (kind in ('company', 'pitch_deck')),
  analysis_run_id uuid,
  status text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  idempotency_key text not null unique,
  attempts integer not null default 0 check (attempts between 0 and 3),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_analysis_jobs_target check
    ((kind = 'company' and asset_id is null and analysis_run_id is not null) or
     (kind = 'pitch_deck' and asset_id is not null and analysis_run_id is null))
);
create unique index if not exists source_analysis_jobs_one_active_target
  on public.source_analysis_jobs(company_id, kind, coalesce(asset_id, company_id))
  where status in ('queued','running');
create index if not exists source_analysis_jobs_due
  on public.source_analysis_jobs(next_attempt_at, created_at) where status = 'queued';
alter table public.source_analysis_jobs enable row level security;
revoke all on public.source_analysis_jobs from public, anon, authenticated;
grant select, insert, update on public.source_analysis_jobs to service_role;

create or replace function public.claim_source_analysis_jobs(max_jobs integer default 1)
returns setof public.source_analysis_jobs
language plpgsql security definer set search_path = '' as $source_claim$
begin
  update public.source_analysis_jobs
     set status = case when attempts >= 3 then 'failed' else 'queued' end,
         next_attempt_at = now() + make_interval(secs => least(300, (15 * power(2, attempts))::integer)),
         lease_until = null, error_code = 'WORKER_LEASE_EXPIRED', updated_at = now()
   where status = 'running' and lease_until < now();
  return query with due as (
    select id from public.source_analysis_jobs
     where status = 'queued' and next_attempt_at <= now() and attempts < 3
     order by created_at for update skip locked limit least(greatest(max_jobs,0),1)
  ) update public.source_analysis_jobs j
       set status = 'running', attempts = attempts + 1,
           lease_until = now() + interval '6 minutes', updated_at = now()
      from due where j.id = due.id returning j.*;
end
$source_claim$;
revoke all on function public.claim_source_analysis_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_source_analysis_jobs(integer) to service_role;

-- Fail closed if an already-existing outbox has a partial/incompatible shape.
do $final_checks$
declare bad text;
begin
  select string_agg(format('%s.%s expected %s, found %s',v.tbl,v.col,v.typ,
                           coalesce(format_type(a.atttypid,a.atttypmod),'<missing>')), ', ') into bad
  from (values
    ('application_submit_authorizations','id','uuid'),
    ('application_submit_authorizations','workspace_id','uuid'),
    ('application_submit_authorizations','company_id','uuid'),
    ('application_submit_authorizations','application_id','uuid'),
    ('application_submit_authorizations','program_id','uuid'),
    ('application_submit_authorizations','approved_fill_run_id','uuid'),
    ('application_submit_authorizations','authorized_by','uuid'),
    ('application_submit_authorizations','authorized_at','timestamp with time zone'),
    ('application_submit_authorizations','expires_at','timestamp with time zone'),
    ('application_submit_authorizations','revoked_at','timestamp with time zone'),
    ('application_submit_authorizations','dispatched_at','timestamp with time zone'),
    ('application_dispatch_jobs','id','uuid'),
    ('application_dispatch_jobs','workspace_id','uuid'),
    ('application_dispatch_jobs','company_id','uuid'),
    ('application_dispatch_jobs','application_id','uuid'),
    ('application_dispatch_jobs','requested_by','uuid'),
    ('application_dispatch_jobs','kind','text'),
    ('application_dispatch_jobs','request_intent','jsonb'),
    ('application_dispatch_jobs','correlation_id','uuid'),
    ('application_dispatch_jobs','browser_run_id','uuid'),
    ('application_dispatch_jobs','external_run_id','text'),
    ('application_dispatch_jobs','idempotency_key','text'),
    ('application_dispatch_jobs','lease_until','timestamp with time zone'),
    ('application_dispatch_jobs','attempts','integer'),
    ('application_dispatch_jobs','status','text'),
    ('application_dispatch_jobs','next_attempt_at','timestamp with time zone'),
    ('application_dispatch_jobs','error_code','text'),
    ('application_dispatch_jobs','created_at','timestamp with time zone'),
    ('application_dispatch_jobs','updated_at','timestamp with time zone'),
    ('source_analysis_jobs','id','uuid'),
    ('source_analysis_jobs','workspace_id','uuid'),
    ('source_analysis_jobs','company_id','uuid'),
    ('source_analysis_jobs','requested_by','uuid'),
    ('source_analysis_jobs','kind','text'),
    ('source_analysis_jobs','analysis_run_id','uuid'),
    ('source_analysis_jobs','asset_id','uuid'),
    ('source_analysis_jobs','idempotency_key','text'),
    ('source_analysis_jobs','lease_until','timestamp with time zone'),
    ('source_analysis_jobs','attempts','integer'),
    ('source_analysis_jobs','status','text'),
    ('source_analysis_jobs','next_attempt_at','timestamp with time zone'),
    ('source_analysis_jobs','error_code','text'),
    ('source_analysis_jobs','created_at','timestamp with time zone'),
    ('source_analysis_jobs','updated_at','timestamp with time zone')
  ) as v(tbl,col,typ)
  left join pg_attribute a on a.attrelid = format('public.%I',v.tbl)::regclass
    and a.attname = v.col and a.attnum > 0 and not a.attisdropped
  where a.attname is null or format_type(a.atttypid,a.atttypmod) <> v.typ;
  if bad is not null then raise exception 'Existing outbox table has incompatible columns: %', bad; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.application_submit_authorizations'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.application_dispatch_jobs'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.source_analysis_jobs'::regclass)
  then
    raise exception 'Required RLS is disabled on an authorization/job table';
  end if;
  if not exists (
    select 1 from pg_index i join pg_attribute a
      on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = 'public.application_submit_authorizations'::regclass
      and i.indisunique and i.indnkeyatts = 1 and a.attname = 'application_id'
  ) or not exists (
    select 1 from pg_index i join pg_attribute a
      on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = 'public.application_dispatch_jobs'::regclass
      and i.indisunique and i.indnkeyatts = 1 and a.attname = 'idempotency_key'
  ) or not exists (
    select 1 from pg_index i join pg_attribute a
      on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
    where i.indrelid = 'public.source_analysis_jobs'::regclass
      and i.indisunique and i.indnkeyatts = 1 and a.attname = 'idempotency_key'
  ) then
    raise exception 'Required unique application/job key is missing';
  end if;
  if not exists (
    select 1 from pg_index i join pg_class idx on idx.oid = i.indexrelid
    where i.indrelid = 'public.application_dispatch_jobs'::regclass
      and idx.relname = 'application_dispatch_jobs_one_active_kind'
      and i.indisunique and i.indpred is not null
      and position('application_id' in pg_get_indexdef(idx.oid)) > 0
      and position('kind' in pg_get_indexdef(idx.oid)) > 0
  ) or not exists (
    select 1 from pg_index i join pg_class idx on idx.oid = i.indexrelid
    where i.indrelid = 'public.source_analysis_jobs'::regclass
      and idx.relname = 'source_analysis_jobs_one_active_target'
      and i.indisunique and i.indpred is not null
      and position('company_id' in pg_get_indexdef(idx.oid)) > 0
      and position('kind' in pg_get_indexdef(idx.oid)) > 0
  ) then
    raise exception 'Required partial unique job index is missing or incompatible';
  end if;
  if exists (
    select 1 from pg_proc p
    cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid in (
      'public.claim_application_dispatch_jobs(integer)'::regprocedure,
      'public.begin_application_dispatch(uuid)'::regprocedure,
      'public.claim_source_analysis_jobs(integer)'::regprocedure
    ) and acl.privilege_type = 'EXECUTE'
      and (acl.grantee = 0::oid or acl.grantee not in (p.proowner,'service_role'::regrole))
  ) then
    raise exception 'A SECURITY DEFINER job function has an unexpected EXECUTE grantee';
  end if;
  if exists (
    select 1 from pg_proc p
    where p.oid in (
      'public.claim_application_dispatch_jobs(integer)'::regprocedure,
      'public.begin_application_dispatch(uuid)'::regprocedure,
      'public.claim_source_analysis_jobs(integer)'::regprocedure
    ) and (not p.prosecdef or p.proowner in ('anon'::regrole,'authenticated'::regrole))
  ) then
    raise exception 'Job function SECURITY DEFINER owner/properties are unsafe';
  end if;
  if not has_function_privilege('service_role',
    'public.claim_application_dispatch_jobs(integer)', 'EXECUTE')
     or not has_function_privilege('service_role',
    'public.begin_application_dispatch(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role',
    'public.claim_source_analysis_jobs(integer)', 'EXECUTE') then
    raise exception 'Service role lacks job function EXECUTE';
  end if;
  if exists (select 1 from storage.buckets where id = 'pitch-decks' and public) then
    raise exception 'pitch-decks bucket unexpectedly public';
  end if;
  if not exists (
    select 1 from pg_policy p
    where p.polrelid = 'storage.objects'::regclass
      and p.polname = 'pitch_decks_owner_guard_phase2'
      and not p.polpermissive and p.polcmd = '*' and 0::oid = any(p.polroles)
      and position('pitch-decks' in pg_get_expr(p.polqual,p.polrelid)) > 0
      and position('workspace_members' in pg_get_expr(p.polqual,p.polrelid)) > 0
      and position('owner' in pg_get_expr(p.polqual,p.polrelid)) > 0
      and position('pitch-decks' in pg_get_expr(p.polwithcheck,p.polrelid)) > 0
      and position('workspace_members' in pg_get_expr(p.polwithcheck,p.polrelid)) > 0
      and position('owner' in pg_get_expr(p.polwithcheck,p.polrelid)) > 0
  ) then
    raise exception 'Pitch deck restrictive Storage guard is missing or incompatible';
  end if;
  if exists (
    select 1 from (values
      ('pitch_decks_owner_select_phase2','r'),
      ('pitch_decks_owner_insert_phase2','a'),
      ('pitch_decks_owner_delete_phase2','d')
    ) as expected(policy_name,command_code)
    left join pg_policy p on p.polrelid = 'storage.objects'::regclass
      and p.polname = expected.policy_name
    where p.oid is null or not p.polpermissive or p.polcmd <> expected.command_code
      or not ('authenticated'::regrole = any(p.polroles))
      or coalesce(position('pitch-decks' in pg_get_expr(
        case when expected.command_code = 'a' then p.polwithcheck else p.polqual end,
        p.polrelid)),0) = 0
      or coalesce(position('workspace_members' in pg_get_expr(
        case when expected.command_code = 'a' then p.polwithcheck else p.polqual end,
        p.polrelid)),0) = 0
      or coalesce(position('owner' in pg_get_expr(
        case when expected.command_code = 'a' then p.polwithcheck else p.polqual end,
        p.polrelid)),0) = 0
  ) then
    raise exception 'Pitch deck owner Storage policies are missing or incompatible';
  end if;
end
$final_checks$;
-- END SOURCE: reviewed Phase 2 patch

commit;


