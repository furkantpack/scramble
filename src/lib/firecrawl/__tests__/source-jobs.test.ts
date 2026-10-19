import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync("supabase/migrations/202610090002_source_analysis_jobs.sql", "utf8");

test("source analysis claim is durable, exclusive and retries an expired lease with backoff", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table public.workspaces(id uuid primary key);
      create table public.companies(id uuid primary key);
      create table public.company_assets(id uuid primary key);
    `);
    await db.exec(migration);
    await db.exec(`
      insert into auth.users values ('00000000-0000-4000-8000-000000000001');
      insert into public.workspaces values ('00000000-0000-4000-8000-000000000002');
      insert into public.companies values ('00000000-0000-4000-8000-000000000003');
      insert into public.company_assets values ('00000000-0000-4000-8000-000000000004');
      insert into public.source_analysis_jobs
        (workspace_id,company_id,asset_id,requested_by,kind,idempotency_key)
      values ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',
        '00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','pitch_deck','deck:one');
    `);
    const first = await db.query<{ id: string }>("select id from public.claim_source_analysis_jobs(1)");
    assert.equal(first.rows.length, 1);
    assert.equal((await db.query("select id from public.claim_source_analysis_jobs(1)")).rows.length, 0);
    await db.query("update public.source_analysis_jobs set lease_until = now() - interval '1 second' where id = $1", [first.rows[0].id]);
    assert.equal((await db.query("select id from public.claim_source_analysis_jobs(1)")).rows.length, 0);
    const state = await db.query<{ status: string; attempts: number; delayed: boolean }>(
      "select status,attempts,next_attempt_at > now() as delayed from public.source_analysis_jobs where id = $1", [first.rows[0].id]);
    assert.equal(state.rows[0].status, "queued");
    assert.equal(state.rows[0].attempts, 1);
    assert.equal(state.rows[0].delayed, true);
  } finally { await db.close(); }
});
