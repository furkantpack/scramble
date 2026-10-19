import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync("supabase/migrations/202610090001_application_dispatch_jobs.sql", "utf8");

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create table public.workspaces(id uuid primary key);
    create table public.companies(id uuid primary key);
    create table public.accelerator_applications(id uuid primary key);
    create table public.browser_agent_runs(id uuid primary key, status text, error_code text);
  `);
  await db.exec(migration);
  await db.exec(`
    insert into auth.users values ('00000000-0000-4000-8000-000000000001');
    insert into public.workspaces values ('00000000-0000-4000-8000-000000000002');
    insert into public.companies values ('00000000-0000-4000-8000-000000000003');
    insert into public.accelerator_applications values ('00000000-0000-4000-8000-000000000004');
    insert into public.application_dispatch_jobs
      (workspace_id,company_id,application_id,requested_by,kind,idempotency_key)
    values
      ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',
       '00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001','fill','fill:one');
  `);
  return db;
}

test("database claim is exclusive and dispatch transition cannot repeat", async () => {
  const db = await fixture();
  try {
    const first = await db.query<{ id: string }>("select id from public.claim_application_dispatch_jobs(2)");
    const second = await db.query<{ id: string }>("select id from public.claim_application_dispatch_jobs(2)");
    assert.equal(first.rows.length, 1);
    assert.equal(second.rows.length, 0);
    const began = await db.query<{ begun: boolean }>("select public.begin_application_dispatch($1) as begun", [first.rows[0].id]);
    assert.equal(began.rows[0].begun, true);
    const repeated = await db.query<{ begun: boolean }>("select public.begin_application_dispatch($1) as begun", [first.rows[0].id]);
    assert.equal(repeated.rows[0].begun, false);
  } finally { await db.close(); }
});

test("expired dispatch becomes unknown and is never automatically claimed again", async () => {
  const db = await fixture();
  try {
    const first = await db.query<{ id: string }>("select id from public.claim_application_dispatch_jobs(1)");
    await db.query("select public.begin_application_dispatch($1)", [first.rows[0].id]);
    await db.query("update public.application_dispatch_jobs set lease_until = now() - interval '1 second' where id = $1", [first.rows[0].id]);
    const reclaimed = await db.query("select id from public.claim_application_dispatch_jobs(1)");
    const state = await db.query<{ status: string }>("select status from public.application_dispatch_jobs where id = $1", [first.rows[0].id]);
    assert.equal(reclaimed.rows.length, 0);
    assert.equal(state.rows[0].status, "unknown_dispatch");
  } finally { await db.close(); }
});

test("expired pre-dispatch lease backs off, while cancellation prevents claim", async () => {
  const db = await fixture();
  try {
    const first = await db.query<{ id: string }>("select id from public.claim_application_dispatch_jobs(1)");
    await db.query("update public.application_dispatch_jobs set lease_until = now() - interval '1 second' where id = $1", [first.rows[0].id]);
    const immediate = await db.query("select id from public.claim_application_dispatch_jobs(1)");
    const state = await db.query<{ status: string; attempts: number; delayed: boolean }>(
      "select status, attempts, next_attempt_at > now() as delayed from public.application_dispatch_jobs where id = $1", [first.rows[0].id]);
    assert.equal(immediate.rows.length, 0);
    assert.equal(state.rows[0].status, "queued");
    assert.equal(state.rows[0].attempts, 1);
    assert.equal(state.rows[0].delayed, true);
    await db.query("update public.application_dispatch_jobs set status = 'cancelled' where id = $1", [first.rows[0].id]);
    const afterCancel = await db.query("select id from public.claim_application_dispatch_jobs(1)");
    assert.equal(afterCancel.rows.length, 0);
  } finally { await db.close(); }
});
