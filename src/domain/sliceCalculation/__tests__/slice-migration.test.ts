import { PGlite } from "@electric-sql/pglite";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

const db = new PGlite();
const founder = "10000000-0000-4000-8000-000000000001";
const lead = "10000000-0000-4000-8000-000000000002";
const contributor = "10000000-0000-4000-8000-000000000003";
const company = "20000000-0000-4000-8000-000000000001";
const otherCompany = "20000000-0000-4000-8000-000000000002";
const integration = "30000000-0000-4000-8000-000000000001";
const goal = "40000000-0000-4000-8000-000000000001";
const signal = "50000000-0000-4000-8000-000000000001";
let migration = "";

before(async () => {
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  const base = (await readFile("supabase/migrations/202609010001_signal_engine.sql", "utf8")).replace(
    "create extension if not exists pgcrypto;",
    "",
  );
  await db.exec(base);
  await db.exec(`insert into companies(id,name) values('${company}','Rising'),('${otherCompany}','Other');`);
  for (const [id, role, co] of [
    [founder, "founder_admin", company],
    [lead, "team_lead", company],
    [contributor, "contributor", company],
  ]) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query(
      "insert into app_users(id,auth_user_id,company_id,name,email,role,status) values($1,$1,$2,$3,$4,$5,'active')",
      [id, co, role, `${id}@example.test`, role],
    );
  }
  await db.query("insert into integrations(id,company_id,tool,status) values($1,$2,'jira','connected')", [
    integration,
    company,
  ]);
  const goalMigration = await readFile("supabase/migrations/202609040001_goal_weighting_engine.sql", "utf8");
  await db.exec(goalMigration);
  await db.query(
    `insert into goals(id,company_id,goal_code,name,weight,owning_team,period_start,period_end,status,finalized_at,finalized_by)
     values($1,$2,'G1','Growth',80,'Growth','2026-09-01','2026-09-30','finalized',now(),$3)`,
    [goal, company, founder],
  );
  await db.query(
    `insert into signals(id,company_id,integration_id,source_tool,external_id,event_type,occurred_at,dedupe_hash,goal_id)
     values($1,$2,$3,'jira','J1','updated','2026-09-08T10:00:00Z','hash-1',$4)`,
    [signal, company, integration, goal],
  );
  migration = await readFile("supabase/migrations/202609100001_slice_calculation_engine.sql", "utf8");
  await db.exec(migration);
});

after(async () => db.close());

test("Engine 03 migration applies and initializes settings", async () => {
  const result = await db.query<{ count: number }>(
    "select count(*)::int count from contribution_engine_settings where company_id=$1",
    [company],
  );
  assert.equal(result.rows[0].count, 1);
});

test("signal contributor totals above 100 percent cannot commit", async () => {
  await db.query(
    "insert into signal_contributors(company_id,signal_id,contributor_id,attribution_bps) values($1,$2,$3,8000)",
    [company, signal, founder],
  );
  await assert.rejects(
    db.query(
      "insert into signal_contributors(company_id,signal_id,contributor_id,attribution_bps) values($1,$2,$3,3000)",
      [company, signal, contributor],
    ),
    /attribution_exceeds_100_percent/,
  );
});

test("cross-tenant contributor allocation cannot commit", async () => {
  const outsider = "10000000-0000-4000-8000-000000000004";
  await db.query("insert into auth.users(id) values($1)", [outsider]);
  await db.query(
    "insert into app_users(id,auth_user_id,company_id,name,email,role,status) values($1,$1,$2,'Out','out@test','contributor','active')",
    [outsider, otherCompany],
  );
  await assert.rejects(
    db.query(
      "insert into signal_contributors(company_id,signal_id,contributor_id,attribution_bps) values($1,$2,$3,2000)",
      [company, signal, outsider],
    ),
    /invalid_signal_contributor/,
  );
});

const row = (group: string, contributorId = founder, units = "768.00000000") => ({
  companyId: company,
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  signalId: signal,
  goalId: goal,
  contributorId,
  calculationGroupId: group,
  strategy: "TIME",
  valuationMode: "time_fmv",
  companyBaseCurrency: "EUR",
  originalBaseValue: "640.00000000",
  originalCurrency: "EUR",
  normalizedBaseValue: "640.00000000",
  strategyRiskFactor: "1.50000000",
  goalFactor: "0.80000000",
  weightClass: "CORE",
  weightClassFactor: "1.00000000",
  contributorAttributionBps: 8000,
  contributionUnits: units,
  revenueRawAttributableValue: null,
  revenueSignalCappedValue: null,
  revenuePeriodRemainingBefore: null,
  fxSnapshot: null,
  inputSnapshot: { revision: 0 },
  explanation: { formula: "deterministic" },
});

test("first persistence creates immutable version one", async () => {
  const group = "60000000-0000-4000-8000-000000000001";
  const result = await db.query<{
    value: { idempotent: boolean; calculations: Array<{ calculation_version: number }> };
  }>("select persist_contribution_calculation($1,$2,$3,$4,$5::jsonb,null) value", [
    founder,
    signal,
    "a".repeat(64),
    "slice-engine-3.0.0",
    JSON.stringify([row(group)]),
  ]);
  assert.equal(result.rows[0].value.idempotent, false);
  assert.equal(result.rows[0].value.calculations[0].calculation_version, 1);
});

test("identical input hash retry is idempotent", async () => {
  const result = await db.query<{ value: { idempotent: boolean; calculations: unknown[] } }>(
    "select persist_contribution_calculation($1,$2,$3,$4,$5::jsonb,null) value",
    [
      founder,
      signal,
      "a".repeat(64),
      "slice-engine-3.0.0",
      JSON.stringify([row("60000000-0000-4000-8000-000000000099")]),
    ],
  );
  assert.equal(result.rows[0].value.idempotent, true);
  assert.equal(result.rows[0].value.calculations.length, 1);
});

test("changed input creates v2 and supersedes v1", async () => {
  await db.query("update signal_contributors set attribution_bps=10000 where signal_id=$1 and contributor_id=$2", [
    signal,
    founder,
  ]);
  const group = "60000000-0000-4000-8000-000000000002";
  await db.query("select persist_contribution_calculation($1,$2,$3,$4,$5::jsonb,null)", [
    founder,
    signal,
    "b".repeat(64),
    "slice-engine-3.0.0",
    JSON.stringify([{ ...row(group), contributorAttributionBps: 10000, contributionUnits: "960.00000000" }]),
  ]);
  const rows = await db.query<{ calculation_version: number; status: string }>(
    "select calculation_version,status from contribution_calculations where signal_id=$1 order by calculation_version",
    [signal],
  );
  assert.deepEqual(rows.rows, [
    { calculation_version: 1, status: "superseded" },
    { calculation_version: 2, status: "provisional" },
  ]);
});

test("founder override stores mandatory immutable audit", async () => {
  const current = await db.query<{ id: string }>(
    "select id from contribution_calculations where signal_id=$1 and status='provisional'",
    [signal],
  );
  const result = await db.query<{
    value: { actor_role: string; previous_units: number; new_units: number; reason: string };
  }>("select override_contribution_calculation($1,$2,812.5,'Shared economic contribution') value", [
    founder,
    current.rows[0].id,
  ]);
  assert.equal(result.rows[0].value.actor_role, "Founder/Admin");
  assert.equal(Number(result.rows[0].value.previous_units), 960);
  assert.equal(Number(result.rows[0].value.new_units), 812.5);
  assert.equal(result.rows[0].value.reason, "Shared economic contribution");
});

test("team lead outside explicit scope cannot override", async () => {
  const current = await db.query<{ id: string }>(
    "select id from contribution_calculations where signal_id=$1 and status='provisional'",
    [signal],
  );
  await assert.rejects(
    db.query("select override_contribution_calculation($1,$2,800,'Reviewed value')", [lead, current.rows[0].id]),
    /override_scope_forbidden/,
  );
});

test("authorized team lead override succeeds", async () => {
  await db.query(
    "insert into calculation_override_scopes(company_id,actor_id,scope_type,scope_value,granted_by) values($1,$2,'TEAM','Growth',$3)",
    [company, lead, founder],
  );
  const current = await db.query<{ id: string }>(
    "select id from contribution_calculations where signal_id=$1 and status='provisional'",
    [signal],
  );
  const result = await db.query<{ value: { actor_role: string; scope_type: string } }>(
    "select override_contribution_calculation($1,$2,800,'Team scope review') value",
    [lead, current.rows[0].id],
  );
  assert.equal(result.rows[0].value.actor_role, "Team Lead");
  assert.equal(result.rows[0].value.scope_type, "TEAM");
});

test("authenticated browser role cannot write engine tables or call trusted RPC", async () => {
  await db.exec("set role authenticated");
  try {
    await assert.rejects(db.exec("update contribution_engine_settings set core_factor=99"), /permission denied/);
    await assert.rejects(
      db.exec(`select persist_contribution_calculation('${founder}','${signal}','${"c".repeat(64)}','x','[]',null)`),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
});

test("migration is rerunnable without duplicating settings", async () => {
  await db.exec(migration);
  const result = await db.query<{ count: number }>(
    "select count(*)::int count from contribution_engine_settings where company_id=$1",
    [company],
  );
  assert.equal(result.rows[0].count, 1);
});
