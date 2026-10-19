-- SCRAMBLE / READ-ONLY VERIFICATION
-- Run AFTER manually applying 20261009_full_scramble_existing_project.sql.
-- All statements below are SELECT. No migration, RPC or test write is invoked.
-- Run section-by-section in Supabase SQL Editor to see every result set.

-- 1. Expected application tables: 48 rows, all exists=true.
with expected(group_name, table_name) as (values
  ('core', 'scrape_snapshots'),
  ('core', 'usage_counters'),
  ('core', 'profiles'),
  ('core', 'workspaces'),
  ('core', 'workspace_members'),
  ('core', 'founder_profiles'),
  ('core', 'companies'),
  ('core', 'founder_needs'),
  ('core', 'company_assets'),
  ('core', 'accelerator_programs'),
  ('core', 'accelerator_applications'),
  ('core', 'application_questions'),
  ('core', 'application_answers'),
  ('core', 'knowledge_base_entries'),
  ('core', 'knowledge_sources'),
  ('core', 'notifications'),
  ('core', 'audit_logs'),
  ('core', 'browser_agent_runs'),
  ('core', 'browser_agent_artifacts'),
  ('domain', 'app_users'),
  ('domain', 'goals'),
  ('domain', 'integrations'),
  ('domain', 'tag_mapping_rules'),
  ('domain', 'goal_link_rules'),
  ('domain', 'signals'),
  ('domain', 'sync_logs'),
  ('domain', 'audit_log'),
  ('domain', 'goal_weight_votes'),
  ('domain', 'goal_creation_requests'),
  ('domain', 'contribution_engine_settings'),
  ('domain', 'contributor_fmv_rates'),
  ('domain', 'contributor_risk_profiles'),
  ('domain', 'signal_contributors'),
  ('domain', 'fx_rate_snapshots'),
  ('domain', 'contribution_calculations'),
  ('domain', 'calculation_override_scopes'),
  ('domain', 'contribution_calculation_overrides'),
  ('domain', 'calibration_reviews'),
  ('domain', 'vesting_schedules'),
  ('domain', 'vesting_events'),
  ('domain', 'period_settlements'),
  ('domain', 'period_settlement_members'),
  ('domain', 'benchmark_rules'),
  ('domain', 'equity_recommendations'),
  ('domain', 'equity_exports'),
  ('jobs', 'application_submit_authorizations'),
  ('jobs', 'application_dispatch_jobs'),
  ('jobs', 'source_analysis_jobs')
)
select group_name, table_name,
       to_regclass(format('public.%I', table_name)) is not null as exists_now
from expected order by group_name, table_name;

-- 2. Critical columns and physical types: every row should match.
with expected(table_name, column_name, expected_type) as (values
  ('companies','sector','text'),
  ('companies','unified_analysis','jsonb'),
  ('companies','canonical_profile','jsonb'),
  ('companies','profile_confirmed_at','timestamp with time zone'),
  ('companies','profile_confirmed_by','uuid'),
  ('company_assets','analysis_status','text'),
  ('company_assets','extracted_text','text'),
  ('company_assets','extracted_json','jsonb'),
  ('company_assets','extracted_pages','jsonb'),
  ('company_assets','analysis_error','text'),
  ('company_assets','processed_at','timestamp with time zone'),
  ('company_assets','content_sha256','text'),
  ('app_users','auth_user_id','uuid'),
  ('app_users','company_id','uuid'),
  ('application_dispatch_jobs','application_id','uuid'),
  ('source_analysis_jobs','company_id','uuid'),
  ('application_submit_authorizations','application_id','uuid')
)
select e.*, format_type(a.atttypid,a.atttypmod) as actual_type,
       format_type(a.atttypid,a.atttypmod) = e.expected_type as matches
from expected e
left join pg_class c on c.oid = to_regclass(format('public.%I',e.table_name))
left join pg_attribute a on a.attrelid = c.oid
  and a.attname = e.column_name and a.attnum > 0 and not a.attisdropped
order by e.table_name,e.column_name;

-- 3. Application status enum; submission_unverified must appear.
select e.enumlabel, e.enumsortorder
from pg_type t join pg_namespace n on n.oid=t.typnamespace
join pg_enum e on e.enumtypid=t.oid
where n.nspname='public' and t.typname='application_status'
order by e.enumsortorder;

-- 4. RLS on all domain/job tables; all should be true.
with expected(table_name) as (values
  ('app_users'),
  ('goals'),
  ('integrations'),
  ('tag_mapping_rules'),
  ('goal_link_rules'),
  ('signals'),
  ('sync_logs'),
  ('audit_log'),
  ('goal_weight_votes'),
  ('goal_creation_requests'),
  ('contribution_engine_settings'),
  ('contributor_fmv_rates'),
  ('contributor_risk_profiles'),
  ('signal_contributors'),
  ('fx_rate_snapshots'),
  ('contribution_calculations'),
  ('calculation_override_scopes'),
  ('contribution_calculation_overrides'),
  ('calibration_reviews'),
  ('vesting_schedules'),
  ('vesting_events'),
  ('period_settlements'),
  ('period_settlement_members'),
  ('benchmark_rules'),
  ('equity_recommendations'),
  ('equity_exports'),
  ('application_submit_authorizations'),
  ('application_dispatch_jobs'),
  ('source_analysis_jobs')
)
select e.table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as forced
from expected e left join pg_class c on c.oid=to_regclass(format('public.%I',e.table_name))
order by e.table_name;

-- 5. All public table policies, including original core policies for review.
select schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public'
order by tablename,policyname;

-- 6. Private pitch deck bucket and exact Storage policy definitions.
select id,name,public
from storage.buckets where id='pitch-decks';
select policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='storage' and tablename='objects'
order by policyname;

-- 7. Foreign keys, ON DELETE actions, and check constraints for all app tables.
select n.nspname,c.relname as table_name,con.conname,
       con.contype,pg_get_constraintdef(con.oid) as definition
from pg_constraint con join pg_class c on c.oid=con.conrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and con.contype in ('f','c','p','u')
order by c.relname,con.contype,con.conname;

-- 8. Index definitions; review partial unique job indexes and lookup indexes.
select tablename,indexname,indexdef
from pg_indexes where schemaname='public'
order by tablename,indexname;

-- 9. SECURITY DEFINER functions, ownership, search_path and effective grants.
-- Any anon/authenticated EXECUTE on a mutation function requires manual review.
select p.proname, pg_get_function_identity_arguments(p.oid) as args,
       pg_get_userbyid(p.proowner) as owner,p.prosecdef as security_definer,
       p.proconfig as settings,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.prosecdef
order by p.proname,pg_get_function_identity_arguments(p.oid);

-- 10. Trigger definitions relevant to auth/company creation.
select n.nspname,c.relname as table_name,t.tgname,
       pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','auth') and not t.tgisinternal
order by n.nspname,c.relname,t.tgname;

-- 11. Service-role grants and schema CREATE privileges.
select
  has_schema_privilege('anon','public','CREATE') as anon_can_create_public,
  has_schema_privilege('authenticated','public','CREATE') as authenticated_can_create_public,
  has_table_privilege('service_role','public.app_users','SELECT') as service_reads_app_users,
  has_table_privilege('anon','public.app_users','SELECT') as anon_reads_app_users,
  has_table_privilege('authenticated','public.app_users','SELECT') as authenticated_reads_app_users;

-- 12. Supabase migration-history catalog presence. Because this is a manual
-- SQL Editor script, SQL objects (not migration-history entries) are authoritative.
select to_regclass('supabase_migrations.schema_migrations') as migration_history_table,
       to_regclass('public.unlinked_signal_queue') as domain_view;

-- 13. Optional read-only counts after table checks are green.
select (select count(*) from public.app_users) as app_users,
       (select count(*) from public.application_dispatch_jobs) as application_jobs,
       (select count(*) from public.source_analysis_jobs) as source_jobs;


