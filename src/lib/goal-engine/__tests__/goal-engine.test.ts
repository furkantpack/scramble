import { PGlite } from "@electric-sql/pglite";

import { calculationWeight, computeConsensusWeight } from "../consensus";
import { emptyOnboardingGoal, onboardingGoalInput, recommendedMethod } from "../onboarding";
import { createGoalsSchema, mutationSchema } from "../validation";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";

const founder = "10000000-0000-4000-8000-000000000001";
const lead1 = "10000000-0000-4000-8000-000000000002";
const lead2 = "10000000-0000-4000-8000-000000000003";
const contributor = "10000000-0000-4000-8000-000000000004";
const outsider = "10000000-0000-4000-8000-000000000005";
const inactive = "10000000-0000-4000-8000-000000000006";
const viewer = "10000000-0000-4000-8000-000000000007";
const company = "20000000-0000-4000-8000-000000000001";
const otherCompany = "20000000-0000-4000-8000-000000000002";
const db = new PGlite();
let migration: string;
type Row = {
  id: string;
  weight: number | null;
  status: string;
  revision: number;
  voting_round: number;
  consensus_result: ReturnType<typeof computeConsensusWeight>;
};
const goalInput = (code: string, overrides = {}) => ({
  name: "Revenue growth",
  goal_code: code,
  owning_team: "Revenue",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  consensus_method: "median_consensus",
  min_quorum: 3,
  ...overrides,
});
async function create(actor: string, goals: unknown[], request = crypto.randomUUID()) {
  const result = await db.query<{ result: Row[] }>("select public.create_weighted_goals($1,$2,$3::jsonb) as result", [
    actor,
    request,
    JSON.stringify(goals),
  ]);
  return result.rows[0].result;
}
async function mutate(
  actor: string,
  g: Row,
  action: string,
  weight: number | null = null,
  reason: string | null = null,
) {
  const result = await db.query<{ result: Row }>("select public.mutate_weighted_goal($1,$2,$3,$4,$5,$6) as result", [
    actor,
    g.id,
    action,
    g.revision,
    weight,
    reason,
  ]);
  return result.rows[0].result;
}

before(async () => {
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;`);
  const base = await readFile("supabase/migrations/202609010001_signal_engine.sql", "utf8");
  // PGlite has core gen_random_uuid; no pgcrypto extension is needed in tests.
  await db.exec(base.replace("create extension if not exists pgcrypto;", ""));
  await db.exec(`insert into companies(id,name) values('${company}','Rising'),('${otherCompany}','Other');`);
  for (const [id, role, co, status] of [
    [founder, "founder_admin", company, "active"],
    [lead1, "team_lead", company, "active"],
    [lead2, "team_lead", company, "active"],
    [contributor, "contributor", company, "active"],
    [outsider, "founder_admin", otherCompany, "active"],
    [inactive, "founder_admin", company, "deactivated"],
    [viewer, "viewer_investor", company, "active"],
  ]) {
    await db.query("insert into auth.users(id) values($1)", [id]);
    await db.query(
      "insert into app_users(id,auth_user_id,company_id,name,email,role,status) values($1,$1,$2,$3,$4,$5,$6)",
      [id, co, role, `${id}@example.test`, role, status],
    );
  }
  await db.query("insert into goals(company_id,name,goal_code,weight) values($1,'Legacy goal','LEGACY',42)", [company]);
  migration = await readFile("supabase/migrations/202609040001_goal_weighting_engine.sql", "utf8");
  await db.exec(migration);
});
after(async () => {
  await db.close();
});

test("consensus handles empty, zero, singleton, even votes, MAD outliers and zero MAD", () => {
  assert.equal(computeConsensusWeight([]).weight, null);
  assert.equal(computeConsensusWeight([0]).weight, 0);
  assert.equal(computeConsensusWeight([100]).weight, 100);
  assert.equal(computeConsensusWeight([20, 25]).weight, 22.5);
  assert.deepEqual(computeConsensusWeight([90, 20, 25]), {
    weight: 22.5,
    method: "median",
    votesUsed: [20, 25],
    votesExcludedAsOutliers: [90],
    totalVoters: 3,
  });
  assert.equal(computeConsensusWeight([20, 20, 90]).weight, 20);
  for (const value of [-1, 101, NaN, Infinity, -Infinity]) assert.throws(() => computeConsensusWeight([value]));
});
test("future calculation gate excludes all unfinalized goals, including closed", () => {
  for (const status of ["draft", "voting", "closed"] as const)
    assert.equal(calculationWeight({ status, weight: 42 }), null);
  assert.equal(calculationWeight({ status: "finalized", weight: 0 }), 0);
  assert.equal(calculationWeight({ status: "finalized", weight: null }), null);
});
test("API input validation rejects forged roles, invalid dates, fractional quorum and unsafe weights", () => {
  const body = { request_id: crypto.randomUUID(), goals: [goalInput("VALID")] };
  assert.equal(createGoalsSchema.safeParse(body).success, true);
  for (const override of [
    { period_end: "2026-02-30" },
    { period_end: "2026-08-01" },
    { min_quorum: 0 },
    { min_quorum: 1.5 },
    { consensus_method: "single", min_quorum: 2 },
    { initial_weight: 42 },
  ]) {
    assert.equal(createGoalsSchema.safeParse({ ...body, goals: [goalInput("INVALID", override)] }).success, false);
  }
  for (const weight of [-1, 101, NaN, Infinity, 1.234])
    assert.equal(mutationSchema.safeParse({ action: "vote", revision: 0, weight }).success, false);
  assert.equal(
    mutationSchema.safeParse({ action: "vote", revision: 0, weight: 0, role: "founder_admin" }).success,
    false,
  );
});
test("onboarding suggests consensus for larger teams and only founders finalize", () => {
  assert.equal(recommendedMethod("1-3"), "single");
  assert.equal(recommendedMethod("4-5"), "median_consensus");
  const g = {
    ...emptyOnboardingGoal(1),
    name: "Build",
    code: "BUILD",
    start: "2026-09-01",
    end: "2026-09-30",
    weight: 0,
  };
  assert.equal(onboardingGoalInput(g, "1-3", true).initial_weight, 0);
  assert.equal(onboardingGoalInput(g, "1-3", false).initial_weight, undefined);
  assert.equal(onboardingGoalInput(g, "6-15", true).initial_weight, undefined);
});
test("migration preserves legacy weights in audit and is rerunnable", async () => {
  const legacy = await db.query<{ weight: null; status: string }>(
    "select weight,status from goals where goal_code='LEGACY'",
  );
  assert.deepEqual(legacy.rows[0], { weight: null, status: "draft" });
  await db.exec(migration);
  const audit = await db.query<{ count: number }>(
    "select count(*)::int as count from audit_log where action='goal.legacy_migrated'",
  );
  assert.equal(audit.rows[0].count, 1);
});
test("single mode requires a founder, accepts zero, and finalizes atomically", async () => {
  let [g] = await create(lead1, [goalInput("SINGLE", { consensus_method: "single", min_quorum: 1 })]);
  await assert.rejects(mutate(lead1, g, "finalize", 50), /forbidden/);
  await assert.rejects(mutate(founder, g, "vote", 50), /voting_closed/);
  g = await mutate(founder, g, "finalize", 0);
  assert.equal(g.status, "finalized");
  assert.equal(g.weight, 0);
  await assert.rejects(mutate(founder, g, "finalize", 50), /invalid_transition/);
  await assert.rejects(mutate(lead1, g, "vote", 25), /voting_closed/);
});
test("quorum, cross-team votes, upserts, outliers, revisions and reopen rounds", async () => {
  let [g] = await create(founder, [goalInput("CONSENSUS")]);
  await assert.rejects(mutate(founder, g, "finalize"), /quorum_not_met/);
  const stale = g;
  g = await mutate(founder, g, "vote", 80);
  await assert.rejects(mutate(lead1, stale, "vote", 20), /stale_goal/);
  g = await mutate(founder, g, "vote", 90);
  g = await mutate(lead1, g, "vote", 20);
  await assert.rejects(mutate(founder, g, "finalize"), /quorum_not_met/);
  g = await mutate(lead2, g, "vote", 25);
  g = await mutate(founder, g, "finalize");
  assert.equal(g.weight, 22.5);
  assert.deepEqual(g.consensus_result.votesExcludedAsOutliers, [90]);
  await assert.rejects(mutate(founder, g, "reopen", null, ""), /reason_required/);
  g = await mutate(founder, g, "reopen", null, "Market conditions changed");
  assert.equal(g.status, "voting");
  assert.equal(g.weight, null);
  assert.equal(g.voting_round, 2);
  await assert.rejects(mutate(founder, g, "finalize"), /quorum_not_met/);
  const oldVotes = await db.query<{ count: number }>(
    "select count(*)::int as count from goal_weight_votes where goal_id=$1 and round=1",
    [g.id],
  );
  assert.equal(oldVotes.rows[0].count, 3);
  const audit = await db.query<{ before: { weight: number }; after: { weight: number } }>(
    "select before,after from audit_log where entity_id=$1 and action='goal.vote.updated'",
    [g.id],
  );
  assert.equal(audit.rows[0].before.weight, 80);
  assert.equal(audit.rows[0].after.weight, 90);
});
test("tenant isolation, inactive accounts, contributor/viewer restrictions", async () => {
  const [g] = await create(founder, [goalInput("ACCESS")]);
  for (const actor of [contributor, inactive, viewer]) {
    await assert.rejects(create(actor, [goalInput("DENIED")]), /forbidden/);
    await assert.rejects(mutate(actor, g, "vote", 50), /forbidden/);
  }
  await assert.rejects(mutate(outsider, g, "vote", 50), /goal_not_found/);
  await assert.rejects(mutate(lead1, g, "finalize"), /forbidden/);
});
test("same code can recur in new periods, batch rollback and idempotent retries", async () => {
  const request = crypto.randomUUID();
  const input = goalInput("RECUR");
  const [one] = await create(founder, [input], request);
  const [retry] = await create(founder, [input], request);
  assert.equal(retry.id, one.id);
  await assert.rejects(create(founder, [{ ...input, name: "Changed" }], request), /request_reused/);
  await assert.rejects(create(founder, [input]), /unique/);
  const [next] = await create(founder, [{ ...input, period_start: "2026-10-01", period_end: "2026-10-31" }]);
  assert.notEqual(next.id, one.id);
  await assert.rejects(create(founder, [goalInput("ROLLBACK"), input]), /unique/);
  const rows = await db.query("select id from goals where goal_code='ROLLBACK'");
  assert.equal(rows.rows.length, 0);
  const [single] = await create(founder, [
    goalInput("BATCH-SINGLE", { consensus_method: "single", min_quorum: 1, initial_weight: 37 }),
  ]);
  assert.equal(single.status, "finalized");
  assert.equal(single.weight, 37);
});
test("voting deadline is enforced; a quorum can be finalized after deadline", async () => {
  const [expired] = await create(founder, [goalInput("EXPIRED", { voting_deadline: "2020-01-01T00:00:00Z" })]);
  await assert.rejects(mutate(lead1, expired, "vote", 40), /deadline_passed/);
  let [g] = await create(founder, [goalInput("DEADLINE", { min_quorum: 1 })]);
  g = await mutate(lead1, g, "vote", 40);
  await db.query("update goals set voting_deadline='2020-01-01' where id=$1", [g.id]);
  g = await mutate(founder, g, "finalize");
  assert.equal(g.weight, 40);
  g = await mutate(founder, g, "close");
  assert.equal(g.status, "closed");
  await assert.rejects(mutate(founder, g, "reopen", null, "Changed priorities"), /invalid_transition/);
});
test("SQL consensus matches TypeScript over deterministic vote sets", async () => {
  for (let n = 0; n < 40; n++) {
    const votes = Array.from({ length: n % 9 }, (_, i) => (n * 17 + i * 31) % 101);
    const result = await db.query<{ value: ReturnType<typeof computeConsensusWeight> }>(
      "select goal_consensus($1::numeric[]) as value",
      [votes],
    );
    assert.deepEqual(result.rows[0].value, computeConsensusWeight(votes));
  }
});
test("authenticated clients cannot write tables or invoke privileged RPCs", async () => {
  await db.exec("set role authenticated");
  try {
    await assert.rejects(db.exec("update goals set weight=100"), /permission denied/);
    await assert.rejects(db.exec("delete from goal_weight_votes"), /permission denied/);
    await assert.rejects(create(founder, [goalInput("BYPASS")]), /permission denied/);
    await assert.rejects(db.exec("select * from goal_creation_requests"), /permission denied/);
  } finally {
    await db.exec("reset role");
  }
});
