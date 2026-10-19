-- READ-ONLY PRODUCTION PREFLIGHT. Run separately and review every result before applying
-- 202610100001_canonical_profile_owner_enforcement.sql. This script performs no writes.

select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced, pg_catalog.pg_get_userbyid(c.relowner) as table_owner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname in ('companies', 'workspace_members')
 order by c.relname;

select table_name, column_name, data_type, udt_name, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and ((table_name = 'companies' and column_name in (
          'workspace_id', 'canonical_profile', 'profile_confirmed_at', 'profile_confirmed_by'))
     or (table_name = 'workspace_members' and column_name in ('workspace_id', 'user_id', 'role')))
 order by table_name, ordinal_position;

-- UPDATE should restrict both the existing row (USING) and resulting workspace (WITH CHECK).
-- INSERT should restrict workspace membership.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
  from pg_catalog.pg_policies
 where schemaname = 'public' and tablename in ('companies', 'workspace_members')
 order by tablename, policyname;

select grantee, table_name, privilege_type
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name in ('companies', 'workspace_members')
   and grantee in ('anon', 'authenticated', 'service_role')
 order by table_name, grantee, privilege_type;

select role, count(*) as membership_count
  from public.workspace_members group by role order by role;

select count(*) as companies_without_workspace_owner
  from public.companies c
 where not exists (
   select 1 from public.workspace_members wm
    where wm.workspace_id = c.workspace_id and wm.role = 'owner'
 );

-- Non-zero partial_state_rows are supported legacy rows. They are not modified by the migration.
select count(*) filter (
         where canonical_profile is null and profile_confirmed_at is null and profile_confirmed_by is null
       ) as unconfirmed_rows,
       count(*) filter (
         where canonical_profile is not null and profile_confirmed_at is not null and profile_confirmed_by is not null
       ) as confirmed_rows,
       count(*) filter (
         where not (
           (canonical_profile is null and profile_confirmed_at is null and profile_confirmed_by is null)
           or (canonical_profile is not null and profile_confirmed_at is not null and profile_confirmed_by is not null)
         )
       ) as partial_state_rows
  from public.companies;

select c.conname, c.contype, pg_catalog.pg_get_constraintdef(c.oid) as definition
  from pg_catalog.pg_constraint c
 where c.conrelid = 'public.companies'::regclass and c.contype = 'f'
   and pg_catalog.pg_get_constraintdef(c.oid) ilike '%profile_confirmed_by%';

select indexname, indexdef
  from pg_catalog.pg_indexes
 where schemaname = 'public' and tablename = 'workspace_members'
 order by indexname;

select n.nspname as schema_name, p.proname,
       pg_catalog.pg_get_userbyid(p.proowner) as function_owner,
       p.prosecdef as security_definer,
       pg_catalog.pg_get_functiondef(p.oid) as definition
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'enforce_canonical_profile_owner';

select t.tgname as trigger_name, pg_catalog.pg_get_triggerdef(t.oid) as definition
  from pg_catalog.pg_trigger t
 where t.tgrelid = 'public.companies'::regclass and not t.tgisinternal
   and t.tgname in ('companies_canonical_profile_owner', 'companies_canonical_profile_owner_insert')
 order by t.tgname;
