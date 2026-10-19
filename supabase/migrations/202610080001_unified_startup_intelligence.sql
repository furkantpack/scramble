-- Keep source evidence in scrape_snapshots and company_assets. Store synthesis and
-- founder confirmation on the existing company, not in a parallel startup table.
alter table public.company_assets
  add column if not exists extracted_pages jsonb;

alter table public.companies
  add column if not exists unified_analysis jsonb,
  add column if not exists canonical_profile jsonb,
  add column if not exists profile_confirmed_at timestamptz,
  add column if not exists profile_confirmed_by uuid references auth.users(id);

-- Existing companies/company_assets workspace RLS policies continue to apply.
-- This migration grants no service-role or public read access to private deck data.
