import { PGlite } from "@electric-sql/pglite";

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

const db = new PGlite();
const company = "20000000-0000-4000-8000-000000000001";
const otherCompany = "20000000-0000-4000-8000-000000000002";
const founder = "10000000-0000-4000-8000-000000000001";
const lead = "10000000-0000-4000-8000-000000000002";
const contributor = "10000000-0000-4000-8000-000000000003";
const outsider = "10000000-0000-4000-8000-000000000004";
const integration = "30000000-0000-4000-8000-000000000001";
const goal = "40000000-0000-4000-8000-000000000001";
const signals = [
  "50000000-0000-4000-8000-000000000001",
  "50000000-0000-4000-8000-000000000002",
  "50000000-0000-4000-8000-000000000003",
];
const calculations = [
  "60000000-0000-4000-8000-000000000001",
  "60000000-0000-4000-8000-000000000002",
  "60000000-0000-4000-8000-000000000003",
];
let migration = "";

before(async () => {
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  for (const file of [
    "supabase/migrations/202609010001_signal_engine.sql",
    "supabase/migrations/202609040001_goal_weighting_engine.sql",
  ]) {
    const sql = (await readFile(file, "utf8")).replace("create extension if not exists pgcrypto;", "");
    if (file.includes("signal_engine")) {
      await db.exec(sql);
      await db.exec(
        `insert into companies(id,name,stage,sector) values('${company}','Rising','Pre-seed','SaaS'),('${otherCompany}','Other','Seed','AI');`,
      );
      for (const [id, role, co] of [
        [founder, "founder_admin", company],
        [lead, "team_lead", company],
        [contributor, "contributor", company],
        [outsider, "founder_admin", otherCompany],
      ]) {
        await db.query("insert into auth.users(id) values($1)", [id]);
        await db.query(
          "insert into app_users(id,auth_user_id,company_id,name,email,role,status) values($1,$1,$2,$3,$4,$5,'active')",
          [id, co, role, `${id}@test`, role],
        );
      }
      await db.query("insert into integrations(id,company_id,tool,status) values($1,$2,'jira','connected')", [
        integration,
        company,
      ]);
    } else await db.exec(sql);
  }
  await db.query(
    `insert into goals(id,company_id,goal_code,name,weight,owning_team,period_start,period_end,status,finalized_at,finalized_by)
    values($1,$2,'G1','Growth',80,'Core','2026-09-01','2026-09-30','finalized',now(),$3)`,
    [goal, company, founder],
  );
  for (const [index, signal] of signals.entries()) {
    await db.query(
      `insert into signals(id,company_id,integration_id,source_tool,external_id,event_type,occurred_at,dedupe_hash,goal_id,contrib_tag,domain_tag,weight_tag)
      values($1,$2,$3,'jira',$4,'updated','2026-09-08',$5,$6,'CONTRIB-TIME','DOMAIN-ENG','WEIGHT-CORE')`,
      [signal, company, integration, `J${index + 1}`, `lifecycle-hash-${index + 1}`, goal],
    );
  }
  const engine3 = await readFile("supabase/migrations/202609100001_slice_calculation_engine.sql", "utf8");
  await db.exec(engine3);
  for (const [index, id] of calculations.entries()) {
    await db.query(
      `insert into contribution_calculations(id,company_id,period_start,period_end,signal_id,goal_id,contributor_id,
      calculation_group_id,calculation_version,input_hash,engine_version,strategy,valuation_mode,status,company_base_currency,
      original_base_value,original_currency,normalized_base_value,strategy_risk_factor,goal_factor,weight_class,
      weight_class_factor,contributor_attribution_bps,contribution_units,input_snapshot,explanation,created_by)
      values($1,$2,'2026-09-01','2026-09-30',$3,$4,$5,$6,$7,$8,'v3','TIME','time_fmv','provisional','EUR',
      100,'EUR',100,1,0.8,'CORE',1,10000,$9,'{}','{}',$10)`,
      [
        id,
        company,
        signals[index],
        goal,
        contributor,
        crypto.randomUUID(),
        index + 1,
        String(index + 1)
          .repeat(64)
          .slice(0, 64),
        100 * (index + 1),
        founder,
      ],
    );
  }
  migration = await readFile("supabase/migrations/202609120001_equity_lifecycle_engines.sql", "utf8");
  await db.exec(migration);
});

after(async () => db.close());

test("lifecycle migration creates benchmark baselines", async () => {
  const result = await db.query<{ count: number }>(
    "select count(*)::int count from benchmark_rules where company_id is null",
  );
  assert.ok(result.rows[0].count >= 8);
});
test("contributor can accept their own provisional calculation", async () => {
  const result = await db.query<{
    value: { resulting_state: string; confirmed_units: number; authorization_scope_type: string };
  }>("select calibrate_contribution_calculation($1,$2,'accept',null,null) value", [contributor, calculations[0]]);
  assert.equal(result.rows[0].value.resulting_state, "confirmed");
  assert.equal(Number(result.rows[0].value.confirmed_units), 100);
  assert.equal(result.rows[0].value.authorization_scope_type, "SELF");
});
test("contributor can dispute their own calculation with reason", async () => {
  const result = await db.query<{ value: { resulting_state: string } }>(
    "select calibrate_contribution_calculation($1,$2,'dispute',null,'Attribution evidence is missing') value",
    [contributor, calculations[1]],
  );
  assert.equal(result.rows[0].value.resulting_state, "disputed");
});
test("contributor cannot adjust units", async () => {
  await assert.rejects(
    db.query("select calibrate_contribution_calculation($1,$2,'adjust',10,'Trying adjustment')", [
      contributor,
      calculations[2],
    ]),
    /forbidden/,
  );
});
test("founder resolves a dispute with full audit", async () => {
  const result = await db.query<{ value: { resulting_state: string; confirmed_units: number } }>(
    "select calibrate_contribution_calculation($1,$2,'resolve',180,'Reviewed supporting evidence') value",
    [founder, calculations[1]],
  );
  assert.equal(result.rows[0].value.resulting_state, "confirmed");
  assert.equal(Number(result.rows[0].value.confirmed_units), 180);
  const audit = await db.query<{ count: number }>(
    "select count(*)::int count from audit_log where entity_id=$1 and action='calibration.resolve'",
    [calculations[1]],
  );
  assert.equal(audit.rows[0].count, 1);
});
test("team lead requires explicit scope", async () => {
  await assert.rejects(
    db.query("select calibrate_contribution_calculation($1,$2,'adjust',250,'Reviewed scope')", [lead, calculations[2]]),
    /calibration_scope_forbidden/,
  );
  await db.query(
    "insert into calculation_override_scopes(company_id,actor_id,scope_type,scope_value,granted_by) values($1,$2,'TEAM','Core',$3)",
    [company, lead, founder],
  );
  const result = await db.query<{ value: { confirmed_units: number } }>(
    "select calibrate_contribution_calculation($1,$2,'adjust',250,'Reviewed within Core team') value",
    [lead, calculations[2]],
  );
  assert.equal(Number(result.rows[0].value.confirmed_units), 250);
});
test("founder attaches standard vesting only to confirmed units", async () => {
  const result = await db.query<{ value: { duration_months: number; cliff_months: number; frequency: string } }>(
    "select create_vesting_schedule($1,$2,'2026-01-01',48,12,'monthly') value",
    [founder, calculations[0]],
  );
  assert.deepEqual(
    [result.rows[0].value.duration_months, result.rows[0].value.cliff_months, result.rows[0].value.frequency],
    [48, 12, "monthly"],
  );
});
test("forfeiture is a separate immutable event", async () => {
  const schedule = await db.query<{ id: string }>("select id from vesting_schedules where calculation_id=$1", [
    calculations[0],
  ]);
  const result = await db.query<{ value: { event_type: string; effective_date: string } }>(
    "select forfeit_vesting_schedule($1,$2,'2027-07-01','Contributor departure recorded') value",
    [founder, schedule.rows[0].id],
  );
  assert.equal(result.rows[0].value.event_type, "forfeited");
  assert.equal(result.rows[0].value.effective_date, "2027-07-01");
});
test("settlement snapshot requires shares totaling 100 percent", async () => {
  const members = [
    {
      contributorId: contributor,
      confirmedUnits: "530",
      vestedUnits: "530",
      eligibleUnits: "530",
      relativeShare: "100",
    },
  ];
  const result = await db.query<{ value: { idempotent: boolean; settlement: { version: number } } }>(
    "select persist_period_settlement($1,'2026-09-01','2026-09-30','2027-09-30',$2,$3::jsonb) value",
    [founder, "a".repeat(64), JSON.stringify(members)],
  );
  assert.equal(result.rows[0].value.idempotent, false);
  assert.equal(result.rows[0].value.settlement.version, 1);
});
test("identical settlement is idempotent and changed snapshot versions", async () => {
  const members = [
    {
      contributorId: contributor,
      confirmedUnits: "530",
      vestedUnits: "530",
      eligibleUnits: "530",
      relativeShare: "100",
    },
  ];
  const retry = await db.query<{ value: { idempotent: boolean } }>(
    "select persist_period_settlement($1,'2026-09-01','2026-09-30','2027-09-30',$2,$3::jsonb) value",
    [founder, "a".repeat(64), JSON.stringify(members)],
  );
  assert.equal(retry.rows[0].value.idempotent, true);
  const next = await db.query<{ value: { settlement: { version: number } } }>(
    "select persist_period_settlement($1,'2026-09-01','2026-09-30','2028-09-30',$2,$3::jsonb) value",
    [founder, "b".repeat(64), JSON.stringify(members)],
  );
  assert.equal(next.rows[0].value.settlement.version, 2);
});
test("recommendation approval and export require founder workflow", async () => {
  const member = await db.query<{ id: string; settlement_id: string }>(
    "select id,settlement_id from period_settlement_members order by created_at limit 1",
  );
  const benchmark = await db.query<{ id: string }>(
    "select id from benchmark_rules where stage='Pre-seed' and role='Early employee' limit 1",
  );
  const rec = await db.query<{ value: { id: string; status: string } }>(
    "select persist_equity_recommendation($1,$2,$3,null,20,25,'Within configured benchmark',$4::jsonb) value",
    [founder, member.rows[0].id, benchmark.rows[0].id, JSON.stringify({ stage: "Pre-seed" })],
  );
  assert.equal(rec.rows[0].value.status, "draft");
  await assert.rejects(
    db.query("select approve_equity_recommendation($1,$2,23)", [outsider, rec.rows[0].value.id]),
    /recommendation_not_approvable/,
  );
  const approved = await db.query<{ value: { status: string } }>(
    "select approve_equity_recommendation($1,$2,23) value",
    [founder, rec.rows[0].value.id],
  );
  assert.equal(approved.rows[0].value.status, "approved");
  const exported = await db.query<{ value: { destination: string } }>(
    "select create_equity_export($1,$2,'csv',$3::jsonb,$4) value",
    [founder, rec.rows[0].value.id, JSON.stringify({ legalEffect: "none" }), "c".repeat(64)],
  );
  assert.equal(exported.rows[0].value.destination, "csv");
});
test("authenticated browser clients cannot bypass lifecycle RPCs", async () => {
  await db.exec("set role authenticated");
  try {
    await assert.rejects(db.exec("delete from calibration_reviews"), /permission denied/);
    await assert.rejects(
      db.exec(`select calibrate_contribution_calculation('${contributor}','${calculations[0]}','accept',null,null)`),
      /permission denied/,
    );
  } finally {
    await db.exec("reset role");
  }
});
test("contributor-facing lifecycle policies enforce own-data filters", async () => {
  const result = await db.query<{ count: number }>(`select count(*)::int count from pg_policies
    where schemaname='public' and tablename in ('calibration_reviews','vesting_schedules','vesting_events',
      'period_settlement_members','equity_recommendations','equity_exports')
      and qual like '%auth_app_user_id%'`);
  assert.equal(result.rows[0].count, 6);
});
test("lifecycle migration is rerunnable", async () => {
  await db.exec(migration);
  const result = await db.query<{ count: number }>(
    "select count(*)::int count from benchmark_rules where company_id is null",
  );
  assert.equal(result.rows[0].count, 9);
});
