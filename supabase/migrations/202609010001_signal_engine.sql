-- Rising Signal Engine compatibility migration.
-- Safe to run after the supplied schema.sql and safe to rerun.

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
