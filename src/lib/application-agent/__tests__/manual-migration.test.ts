import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const sql = readFileSync("supabase/manual/20261009_safe_scramble_phase2.sql", "utf8");

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create table public.workspaces(id uuid primary key);
    create table public.workspace_members(id uuid primary key, workspace_id uuid, user_id uuid, role text);
    create table public.companies(id uuid primary key, workspace_id uuid);
    create table public.company_assets(id uuid primary key, company_id uuid, created_at timestamptz default now(), type text);
    create table public.accelerator_programs(id uuid primary key);
    create type public.application_status as enum ('draft','submitted');
    create table public.accelerator_applications(id uuid primary key, status public.application_status);
    create table public.browser_agent_runs(id uuid primary key, status text, error_code text);
    create table public.signals(id uuid primary key);
    create table public.goals(id uuid primary key);
    create table public.goal_weight_votes(id uuid primary key);
    create table public.contribution_calculations(id uuid primary key);
    create table public.calibration_reviews(id uuid primary key);
    create table storage.buckets(id text primary key, name text, public boolean);
    create table storage.objects(id uuid primary key, bucket_id text, name text);
    alter table public.companies enable row level security;
    alter table public.company_assets enable row level security;
    alter table storage.objects enable row level security;
    insert into storage.buckets values ('pitch-decks','pitch-decks',false);
    insert into public.companies values ('00000000-0000-4000-8000-000000000001',null);
    insert into public.company_assets(id,company_id,type)
      values ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','pitch_deck');
  `);
  return db;
}

test("manual Phase 2 SQL is additive and rerunnable without losing existing rows", async () => {
  const db = await fixture();
  try {
    await db.exec(sql);
    await db.exec(sql);
    const assets = await db.query<{ id: string; analysis_status: string | null }>(
      "select id,analysis_status from public.company_assets",
    );
    assert.equal(assets.rows.length, 1);
    assert.equal(assets.rows[0].analysis_status, null);
    const columns = await db.query<{ count: number }>(`select count(*)::integer as count
      from information_schema.columns where table_schema='public' and table_name='companies'
      and column_name in ('unified_analysis','canonical_profile','profile_confirmed_at','profile_confirmed_by')`);
    assert.equal(columns.rows[0].count, 4);
    const enumValue = await db.query("select 'submission_unverified'::public.application_status");
    assert.equal(enumValue.rows.length, 1);
    const jobs = await db.query("select id from public.application_dispatch_jobs union all select id from public.source_analysis_jobs");
    assert.equal(jobs.rows.length, 0);
  } finally {
    await db.close();
  }
});

test("manual Phase 2 SQL refuses a public pre-existing pitch-decks bucket", async () => {
  const db = await fixture();
  try {
    await db.exec("update storage.buckets set public=true where id='pitch-decks'");
    await assert.rejects(db.exec(sql), /Existing pitch-decks bucket is public/);
    await db.exec("rollback");
    const columns = await db.query<{ count: number }>(`select count(*)::integer as count
      from information_schema.columns where table_schema='public' and table_name='company_assets'
      and column_name='analysis_status'`);
    assert.equal(columns.rows[0].count, 0);
  } finally {
    await db.close();
  }
});
