-- Engine 03: deterministic provisional Contribution Units.
-- Apply after 202609040001_goal_weighting_engine.sql.
begin;

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

commit;
