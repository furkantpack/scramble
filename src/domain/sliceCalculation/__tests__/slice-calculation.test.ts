import { authorizeOverride } from "../authorization";
import { assertCompleteAttribution, assertFinalizedGoal, calculateSignalGroup } from "../calculate";
import { calculationInputHash } from "../canonical";
import { CalculationBlockedError, CalculationInvariantError } from "../errors";
import { normalizeCurrency } from "../fx";
import { bpsToFactor, d, goalWeightToFactor, money, units } from "../math";
import type {
  CompanyCalculationSettings,
  ContributorRiskProfile,
  FinalizedCalculationGoal,
  FxSnapshot,
  NormalizedCalculationSignal,
  RoleFmvRate,
  SignalContributor,
} from "../types";
import { valueCash, valueExpense, valueIdea, valueRelationship, valueTime } from "../valuation";
import assert from "node:assert/strict";
import { test } from "node:test";

const company = "20000000-0000-4000-8000-000000000001";
const alice = "10000000-0000-4000-8000-000000000001";
const bob = "10000000-0000-4000-8000-000000000002";
const occurredAt = "2026-09-08T10:00:00.000Z";
const settings: CompanyCalculationSettings = {
  companyId: company,
  baseCurrency: "EUR",
  weightClassFactors: { CORE: "1", SUPPORTING: "0.7", EXPERIMENTAL: "0.4" },
  cashRiskFactor: "1.2",
  revenueAttributionRate: "0.05",
  revenueSignalCapBase: "750",
  revenuePeriodCapBase: "10000",
  allowAtRiskExpenseMultiplier: true,
  revision: 0,
};
const signal = (overrides: Partial<NormalizedCalculationSignal> = {}): NormalizedCalculationSignal => ({
  id: "30000000-0000-4000-8000-000000000001",
  companyId: company,
  goalId: "40000000-0000-4000-8000-000000000001",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  source: "JIRA",
  sourceRef: "RSR-128",
  sourcePayload: {},
  occurredAt,
  revision: 0,
  contributionType: "TIME",
  domain: "DOMAIN-ENG",
  weightClass: "CORE",
  amount: null,
  currency: null,
  hours: "8",
  manualValuationAmount: null,
  manualValuationCurrency: null,
  manualValuationApproved: false,
  expenseApproved: false,
  expenseAtRiskCapital: false,
  expenseReimbursed: false,
  economicValueAmount: null,
  economicValueCurrency: null,
  ...overrides,
});
const goal = (overrides: Partial<FinalizedCalculationGoal> = {}): FinalizedCalculationGoal => ({
  id: "40000000-0000-4000-8000-000000000001",
  companyId: company,
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  name: "Payments expansion",
  status: "finalized",
  weight: "80",
  revision: 2,
  finalizedAt: "2026-09-02T00:00:00Z",
  finalizedBy: alice,
  ...overrides,
});
const fmv = (contributorId = alice): RoleFmvRate => ({
  id: crypto.randomUUID(),
  contributorId,
  hourlyRate: "80",
  currency: "EUR",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
});
const risk = (contributorId = alice): ContributorRiskProfile => ({
  id: crypto.randomUUID(),
  contributorId,
  timeRiskFactor: "1.5",
  cashRiskFactorOverride: "1.35",
  atRiskExpenseFactor: "1.4",
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
});
const fx: FxSnapshot = {
  fromCurrency: "USD",
  toCurrency: "EUR",
  rate: "0.92",
  rateDate: "2026-09-08",
  provider: "ECB archival",
  capturedAt: "2026-09-09T00:00:00Z",
};
const fxGetter = async ({ fromCurrency }: { fromCurrency: string }) => (fromCurrency === "USD" ? fx : null);
const blocked = async (fn: () => unknown | Promise<unknown>, state: string) => {
  await assert.rejects(
    async () => {
      await fn();
    },
    (error: unknown) => error instanceof CalculationBlockedError && error.state === state,
  );
};

const mathCases: Array<[string, () => unknown, unknown]> = [
  ["money keeps eight deterministic decimals", () => money("0.1"), "0.10000000"],
  ["decimal addition avoids binary drift", () => money(d("0.1").plus("0.2")), "0.30000000"],
  ["units round half up", () => units("1.234567895"), "1.23456790"],
  ["zero basis points map to zero", () => bpsToFactor(0).toString(), "0"],
  ["full basis points map to one", () => bpsToFactor(10000).toString(), "1"],
  ["basis-point precision is exact", () => bpsToFactor(3333).toString(), "0.3333"],
  ["zero goal weight maps to zero", () => goalWeightToFactor(0).toString(), "0"],
  ["full goal weight maps to one", () => goalWeightToFactor(100).toString(), "1"],
];
for (const [name, run, expected] of mathCases) test(name, () => assert.deepEqual(run(), expected));
test("invalid attribution basis points are rejected", () => assert.throws(() => bpsToFactor(10001)));
test("invalid goal weight is rejected", () => assert.throws(() => goalWeightToFactor(101)));

test("single contributor at 100 percent succeeds", () =>
  assert.doesNotThrow(() => assertCompleteAttribution([{ contributorId: alice, attributionBps: 10000 }])));
test("60/40 attribution succeeds", () =>
  assert.doesNotThrow(() =>
    assertCompleteAttribution([
      { contributorId: alice, attributionBps: 6000 },
      { contributorId: bob, attributionBps: 4000 },
    ]),
  ));
test("80 percent attribution blocks", () =>
  assert.throws(
    () => assertCompleteAttribution([{ contributorId: alice, attributionBps: 8000 }]),
    CalculationBlockedError,
  ));
test("empty attribution blocks", () => assert.throws(() => assertCompleteAttribution([]), CalculationBlockedError));
test("over-allocation is an invariant violation", () =>
  assert.throws(
    () => assertCompleteAttribution([{ contributorId: alice, attributionBps: 12000 }]),
    CalculationInvariantError,
  ));

test("finalized goal is eligible", () => assert.doesNotThrow(() => assertFinalizedGoal(signal(), goal())));
for (const status of ["draft", "voting", "closed", "reopened"]) {
  test(`${status} goal waits`, () =>
    assert.throws(() => assertFinalizedGoal(signal(), goal({ status })), CalculationBlockedError));
}
test("missing goal waits", () =>
  assert.throws(() => assertFinalizedGoal(signal({ goalId: null }), null), CalculationBlockedError));
test("cross-company goal is rejected", () =>
  assert.throws(
    () => assertFinalizedGoal(signal(), goal({ companyId: crypto.randomUUID() })),
    CalculationInvariantError,
  ));
test("cross-period goal is rejected", () =>
  assert.throws(() => assertFinalizedGoal(signal(), goal({ periodEnd: "2026-10-31" })), CalculationInvariantError));

test("TIME computes hours times FMV and risk", async () => {
  const value = await valueTime({ signal: signal(), settings, fmv: fmv(), risk: risk(), getFxRate: fxGetter });
  assert.equal(value.normalizedBaseValue, "640.00000000");
  assert.equal(value.riskFactor, "1.5");
});
test("TIME missing hours blocks", () =>
  blocked(
    () => valueTime({ signal: signal({ hours: null }), settings, fmv: fmv(), risk: null, getFxRate: fxGetter }),
    "needs_input",
  ));
test("TIME zero hours blocks", () =>
  blocked(
    () => valueTime({ signal: signal({ hours: "0" }), settings, fmv: fmv(), risk: null, getFxRate: fxGetter }),
    "needs_input",
  ));
test("TIME missing FMV blocks", () =>
  blocked(() => valueTime({ signal: signal(), settings, fmv: null, risk: null, getFxRate: fxGetter }), "needs_input"));
test("TIME defaults risk to one", async () =>
  assert.equal(
    (await valueTime({ signal: signal(), settings, fmv: fmv(), risk: null, getFxRate: fxGetter })).riskFactor,
    "1",
  ));
test("TIME never infers hours from payload", () =>
  blocked(
    () =>
      valueTime({
        signal: signal({ hours: null, sourcePayload: { storyPoints: 8 } }),
        settings,
        fmv: fmv(),
        risk: null,
        getFxRate: fxGetter,
      }),
    "needs_input",
  ));
test("TIME normalizes historical FX", async () =>
  assert.equal(
    (
      await valueTime({
        signal: signal(),
        settings,
        fmv: { ...fmv(), currency: "USD" },
        risk: null,
        getFxRate: fxGetter,
      })
    ).normalizedBaseValue,
    "588.80000000",
  ));

test("CASH normalizes through FX", async () =>
  assert.equal(
    (
      await valueCash({
        signal: signal({ contributionType: "CASH", amount: "1000", currency: "USD" }),
        settings,
        risk: null,
        getFxRate: fxGetter,
      })
    ).normalizedBaseValue,
    "920.00000000",
  ));
test("CASH applies company risk", async () =>
  assert.equal(
    (
      await valueCash({
        signal: signal({ contributionType: "CASH", amount: "100", currency: "EUR" }),
        settings,
        risk: null,
        getFxRate: fxGetter,
      })
    ).riskFactor,
    "1.2",
  ));
test("CASH contributor override wins", async () =>
  assert.equal(
    (
      await valueCash({
        signal: signal({ contributionType: "CASH", amount: "100", currency: "EUR" }),
        settings,
        risk: risk(),
        getFxRate: fxGetter,
      })
    ).riskFactor,
    "1.35",
  ));
test("CASH missing amount blocks", () =>
  blocked(
    () => valueCash({ signal: signal({ contributionType: "CASH" }), settings, risk: null, getFxRate: fxGetter }),
    "needs_input",
  ));
test("CASH missing currency blocks", () =>
  blocked(
    () =>
      valueCash({
        signal: signal({ contributionType: "CASH", amount: "100" }),
        settings,
        risk: null,
        getFxRate: fxGetter,
      }),
    "needs_input",
  ));

test("approved EXPENSE uses normal risk one", async () =>
  assert.equal(
    (
      await valueExpense({
        signal: signal({ contributionType: "EXPENSE", amount: "100", currency: "EUR", expenseApproved: true }),
        settings,
        risk: risk(),
        getFxRate: fxGetter,
      })
    ).riskFactor,
    "1",
  ));
test("unapproved EXPENSE blocks", () =>
  blocked(
    () =>
      valueExpense({
        signal: signal({ contributionType: "EXPENSE", amount: "100", currency: "EUR" }),
        settings,
        risk: null,
        getFxRate: fxGetter,
      }),
    "needs_input",
  ));
test("reimbursed EXPENSE blocks", () =>
  blocked(
    () =>
      valueExpense({
        signal: signal({
          contributionType: "EXPENSE",
          amount: "100",
          currency: "EUR",
          expenseApproved: true,
          expenseReimbursed: true,
        }),
        settings,
        risk: null,
        getFxRate: fxGetter,
      }),
    "needs_input",
  ));
test("at-risk EXPENSE applies contributor factor", async () =>
  assert.equal(
    (
      await valueExpense({
        signal: signal({
          contributionType: "EXPENSE",
          amount: "100",
          currency: "EUR",
          expenseApproved: true,
          expenseAtRiskCapital: true,
        }),
        settings,
        risk: risk(),
        getFxRate: fxGetter,
      })
    ).riskFactor,
    "1.4",
  ));
test("at-risk EXPENSE defaults safely to one", async () =>
  assert.equal(
    (
      await valueExpense({
        signal: signal({
          contributionType: "EXPENSE",
          amount: "100",
          currency: "EUR",
          expenseApproved: true,
          expenseAtRiskCapital: true,
        }),
        settings,
        risk: null,
        getFxRate: fxGetter,
      })
    ).riskFactor,
    "1",
  ));
test("company may disable at-risk multiplier", async () =>
  assert.equal(
    (
      await valueExpense({
        signal: signal({
          contributionType: "EXPENSE",
          amount: "100",
          currency: "EUR",
          expenseApproved: true,
          expenseAtRiskCapital: true,
        }),
        settings: { ...settings, allowAtRiskExpenseMultiplier: false },
        risk: risk(),
        getFxRate: fxGetter,
      })
    ).riskFactor,
    "1",
  ));
test("EXPENSE needs a positive amount", () =>
  blocked(
    () =>
      valueExpense({
        signal: signal({ contributionType: "EXPENSE", amount: "0", currency: "EUR", expenseApproved: true }),
        settings,
        risk: null,
        getFxRate: fxGetter,
      }),
    "needs_input",
  ));

test("approved IDEA manual valuation works", async () =>
  assert.equal(
    (
      await valueIdea({
        signal: signal({
          contributionType: "IDEA",
          manualValuationAmount: "500",
          manualValuationCurrency: "EUR",
          manualValuationApproved: true,
        }),
        settings,
        getFxRate: fxGetter,
      })
    ).normalizedBaseValue,
    "500.00000000",
  ));
test("unapproved IDEA blocks", () =>
  blocked(
    () =>
      valueIdea({
        signal: signal({ contributionType: "IDEA", manualValuationAmount: "500", manualValuationCurrency: "EUR" }),
        settings,
        getFxRate: fxGetter,
      }),
    "needs_input",
  ));
test("IDEA missing amount blocks", () =>
  blocked(
    () =>
      valueIdea({
        signal: signal({ contributionType: "IDEA", manualValuationApproved: true, manualValuationCurrency: "EUR" }),
        settings,
        getFxRate: fxGetter,
      }),
    "needs_input",
  ));
test("IDEA never derives value from prose", () =>
  blocked(
    () =>
      valueIdea({
        signal: signal({ contributionType: "IDEA", sourcePayload: { aiEstimate: 999999 } }),
        settings,
        getFxRate: fxGetter,
      }),
    "needs_input",
  ));

test("RELATIONSHIP explicit economic value is direct", async () =>
  assert.equal(
    (
      await valueRelationship({
        signal: signal({ contributionType: "RELATIONSHIP", economicValueAmount: "700", economicValueCurrency: "EUR" }),
        settings,
        getFxRate: fxGetter,
        alreadyConsumedPeriodBase: "0",
      })
    ).normalizedBaseValue,
    "700.00000000",
  ));
test("RELATIONSHIP rate works", async () =>
  assert.equal(
    (
      await valueRelationship({
        signal: signal({ contributionType: "RELATIONSHIP", amount: "10000", currency: "EUR" }),
        settings,
        getFxRate: fxGetter,
        alreadyConsumedPeriodBase: "0",
      })
    ).revenue?.rawAttributableValue,
    "500.00000000",
  ));
test("RELATIONSHIP signal cap works", async () =>
  assert.equal(
    (
      await valueRelationship({
        signal: signal({ contributionType: "RELATIONSHIP", amount: "20000", currency: "EUR" }),
        settings,
        getFxRate: fxGetter,
        alreadyConsumedPeriodBase: "0",
      })
    ).normalizedBaseValue,
    "750.00000000",
  ));
test("RELATIONSHIP period cap works", async () =>
  assert.equal(
    (
      await valueRelationship({
        signal: signal({ contributionType: "RELATIONSHIP", amount: "20000", currency: "EUR" }),
        settings,
        getFxRate: fxGetter,
        alreadyConsumedPeriodBase: "9400",
      })
    ).normalizedBaseValue,
    "600.00000000",
  ));
test("RELATIONSHIP exhausted period yields zero", async () =>
  assert.equal(
    (
      await valueRelationship({
        signal: signal({ contributionType: "RELATIONSHIP", amount: "20000", currency: "EUR" }),
        settings,
        getFxRate: fxGetter,
        alreadyConsumedPeriodBase: "10000",
      })
    ).normalizedBaseValue,
    "0.00000000",
  ));
test("RELATIONSHIP missing economic input blocks", () =>
  blocked(
    () =>
      valueRelationship({
        signal: signal({ contributionType: "RELATIONSHIP" }),
        settings,
        getFxRate: fxGetter,
        alreadyConsumedPeriodBase: "0",
      }),
    "needs_input",
  ));
test("RELATIONSHIP FX precedes attribution rate", async () =>
  assert.equal(
    (
      await valueRelationship({
        signal: signal({ contributionType: "RELATIONSHIP", amount: "1000", currency: "USD" }),
        settings: { ...settings, revenueSignalCapBase: null },
        getFxRate: fxGetter,
        alreadyConsumedPeriodBase: "0",
      })
    ).normalizedBaseValue,
    "46.00000000",
  ));

test("same currency needs no FX snapshot", async () =>
  assert.equal(
    (
      await normalizeCurrency({
        amount: "10",
        fromCurrency: "EUR",
        toCurrency: "EUR",
        occurredAt,
        getFxRate: async () => {
          throw new Error("must not call");
        },
      })
    ).fxSnapshot,
    null,
  ));
test("cross-currency stores exact FX snapshot", async () =>
  assert.deepEqual(
    (await normalizeCurrency({ amount: "10", fromCurrency: "USD", toCurrency: "EUR", occurredAt, getFxRate: fxGetter }))
      .fxSnapshot,
    fx,
  ));
test("historical FX request uses signal date", async () => {
  let date = "";
  await normalizeCurrency({
    amount: "10",
    fromCurrency: "USD",
    toCurrency: "EUR",
    occurredAt,
    getFxRate: async (args) => {
      date = args.occurredAt.slice(0, 10);
      return fx;
    },
  });
  assert.equal(date, "2026-09-08");
});
test("missing historical FX blocks", () =>
  blocked(
    () =>
      normalizeCurrency({
        amount: "10",
        fromCurrency: "GBP",
        toCurrency: "EUR",
        occurredAt,
        getFxRate: async () => null,
      }),
    "needs_input",
  ));
test("invalid currency blocks", () =>
  blocked(
    () => normalizeCurrency({ amount: "10", fromCurrency: "US", toCurrency: "EUR", occurredAt, getFxRate: fxGetter }),
    "needs_input",
  ));

async function calculate(
  overrides: Partial<NormalizedCalculationSignal> = {},
  contributors: SignalContributor[] = [{ contributorId: alice, attributionBps: 10000 }],
) {
  return calculateSignalGroup({
    signal: signal(overrides),
    goal: goal(),
    contributors,
    settings,
    fmvByContributor: new Map([
      [alice, fmv(alice)],
      [bob, fmv(bob)],
    ]),
    riskByContributor: new Map([
      [alice, risk(alice)],
      [bob, risk(bob)],
    ]),
    getFxRate: fxGetter,
    alreadyConsumedRevenuePeriodBase: "0",
    calculationGroupId: "50000000-0000-4000-8000-000000000001",
  });
}
test("full formula returns 768 units", async () =>
  assert.equal((await calculate())[0].contributionUnits, "768.00000000"));
test("60/40 split sums to signal total", async () => {
  const rows = await calculate({}, [
    { contributorId: alice, attributionBps: 6000 },
    { contributorId: bob, attributionBps: 4000 },
  ]);
  assert.equal(money(d(rows[0].contributionUnits).plus(rows[1].contributionUnits)), "768.00000000");
});
test("60 percent contributor receives 460.8", async () =>
  assert.equal(
    (
      await calculate({}, [
        { contributorId: alice, attributionBps: 6000 },
        { contributorId: bob, attributionBps: 4000 },
      ])
    )[0].contributionUnits,
    "460.80000000",
  ));
test("SUPPORTING factor applies", async () =>
  assert.equal((await calculate({ weightClass: "SUPPORTING" }))[0].contributionUnits, "537.60000000"));
test("EXPERIMENTAL factor applies", async () =>
  assert.equal((await calculate({ weightClass: "EXPERIMENTAL" }))[0].contributionUnits, "307.20000000"));
test("zero finalized goal weight yields zero units", async () => {
  const rows = await calculateSignalGroup({
    signal: signal(),
    goal: goal({ weight: "0" }),
    contributors: [{ contributorId: alice, attributionBps: 10000 }],
    settings,
    fmvByContributor: new Map([[alice, fmv()]]),
    riskByContributor: new Map([[alice, risk()]]),
    getFxRate: fxGetter,
    alreadyConsumedRevenuePeriodBase: "0",
  });
  assert.equal(rows[0].contributionUnits, "0.00000000");
});
test("revenue split repeats cap snapshot but sums units once", async () => {
  const rows = await calculate({ contributionType: "RELATIONSHIP", amount: "20000", currency: "EUR" }, [
    { contributorId: alice, attributionBps: 6000 },
    { contributorId: bob, attributionBps: 4000 },
  ]);
  assert.equal(rows[0].revenueSignalCappedValue, "750.00000000");
  assert.equal(rows[1].revenueSignalCappedValue, "750.00000000");
  assert.equal(money(d(rows[0].contributionUnits).plus(rows[1].contributionUnits)), "600.00000000");
});

test("canonical hash ignores object key order", () =>
  assert.equal(calculationInputHash({ a: 1, b: 2 }), calculationInputHash({ b: 2, a: 1 })));
test("canonical hash changes on attribution", () =>
  assert.notEqual(calculationInputHash({ bps: 6000 }), calculationInputHash({ bps: 5000 })));
test("canonical hash changes on goal revision", () =>
  assert.notEqual(calculationInputHash({ goalRevision: 1 }), calculationInputHash({ goalRevision: 2 })));
test("canonical hash is a SHA-256 hex value", () =>
  assert.match(calculationInputHash({ input: true }), /^[a-f0-9]{64}$/));

test("founder can override own company", () =>
  assert.deepEqual(
    authorizeOverride(
      { id: alice, role: "founder_admin", companyId: company },
      { companyId: company, team: "Core", domain: "ENG" },
      [],
    ),
    { actorRole: "Founder/Admin", scopeType: "COMPANY", scopeId: null },
  ));
test("authorized team lead can override team", () =>
  assert.equal(
    authorizeOverride(
      { id: alice, role: "team_lead", companyId: company },
      { companyId: company, team: "Core", domain: "ENG" },
      [{ type: "TEAM", value: "Core" }],
    ).scopeType,
    "TEAM",
  ));
test("authorized team lead can override domain", () =>
  assert.equal(
    authorizeOverride(
      { id: alice, role: "team_lead", companyId: company },
      { companyId: company, team: "Core", domain: "ENG" },
      [{ type: "DOMAIN", value: "ENG" }],
    ).scopeType,
    "DOMAIN",
  ));
test("team lead outside scope is denied", () =>
  assert.throws(
    () =>
      authorizeOverride(
        { id: alice, role: "team_lead", companyId: company },
        { companyId: company, team: "Core", domain: "ENG" },
        [],
      ),
    CalculationInvariantError,
  ));
test("contributor override is denied", () =>
  assert.throws(
    () =>
      authorizeOverride(
        { id: alice, role: "contributor", companyId: company },
        { companyId: company, team: "Core", domain: "ENG" },
        [],
      ),
    CalculationInvariantError,
  ));
test("viewer override is denied", () =>
  assert.throws(
    () =>
      authorizeOverride(
        { id: alice, role: "viewer_investor", companyId: company },
        { companyId: company, team: "Core", domain: "ENG" },
        [],
      ),
    CalculationInvariantError,
  ));
test("cross-company override is denied", () =>
  assert.throws(
    () =>
      authorizeOverride(
        { id: alice, role: "founder_admin", companyId: company },
        { companyId: crypto.randomUUID(), team: "Core", domain: "ENG" },
        [],
      ),
    CalculationInvariantError,
  ));
