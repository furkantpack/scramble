import { benchmarkContext, classifyBenchmark } from "../benchmark";
import { calibrate } from "../calibration";
import { summarizeContributionStates } from "../coach";
import { buildExportPayload, exportCsv } from "../export";
import { recommendEquity } from "../recommendation";
import { settleContributions } from "../settlement";
import type { BenchmarkRule } from "../types";
import { calculateVesting, wholeMonthsBetween } from "../vesting";
import assert from "node:assert/strict";
import { test } from "node:test";

const rule: BenchmarkRule = {
  id: "benchmark-1",
  stage: "Pre-seed",
  sector: "*",
  role: "Technical Co-founder",
  minimum: "20",
  maximum: "40",
  sourceLabel: "Rising baseline",
  version: 1,
};

test("Engine 04 accepts provisional units without recalculation", () => {
  assert.deepEqual(calibrate({ action: "accept", currentUnits: "768" }), {
    state: "confirmed",
    previousUnits: "768.00000000",
    confirmedUnits: "768.00000000",
    reason: null,
  });
});
test("Engine 04 dispute keeps units unconfirmed", () => {
  assert.equal(
    calibrate({ action: "dispute", currentUnits: "768", reason: "Attribution is incomplete" }).state,
    "disputed",
  );
});
test("Engine 04 adjustment records new confirmed units", () => {
  assert.equal(
    calibrate({ action: "adjust", currentUnits: "768", newUnits: "700", reason: "Shared with another team" })
      .confirmedUnits,
    "700.00000000",
  );
});
test("Engine 04 resolution records explicit units", () => {
  assert.equal(
    calibrate({ action: "resolve", currentUnits: "768", newUnits: "812.5", reason: "Evidence reviewed" })
      .confirmedUnits,
    "812.50000000",
  );
});
test("Engine 04 adjustment requires a reason", () =>
  assert.throws(() => calibrate({ action: "adjust", currentUnits: "1", newUnits: "2" }), /reason_required/));
test("Engine 04 dispute requires a reason", () =>
  assert.throws(() => calibrate({ action: "dispute", currentUnits: "1" }), /reason_required/));
test("Engine 04 rejects negative adjusted units", () =>
  assert.throws(
    () => calibrate({ action: "adjust", currentUnits: "1", newUnits: "-1", reason: "Invalid decrease" }),
    /invalid_new_units/,
  ));

test("whole month calculation respects day boundaries", () => {
  assert.equal(wholeMonthsBetween("2026-01-15", "2026-02-14"), 0);
  assert.equal(wholeMonthsBetween("2026-01-15", "2026-02-15"), 1);
});
test("vesting is zero before the cliff", () =>
  assert.equal(
    calculateVesting(
      { totalUnits: "4800", startDate: "2026-01-01", durationMonths: 48, cliffMonths: 12, frequency: "monthly" },
      "2026-12-31",
    ).vestedUnits,
    "0.00000000",
  ));
test("one year cliff releases 25 percent", () =>
  assert.equal(
    calculateVesting(
      { totalUnits: "4800", startDate: "2026-01-01", durationMonths: 48, cliffMonths: 12, frequency: "monthly" },
      "2027-01-01",
    ).vestedUnits,
    "1200.00000000",
  ));
test("monthly vesting progresses after cliff", () =>
  assert.equal(
    calculateVesting(
      { totalUnits: "4800", startDate: "2026-01-01", durationMonths: 48, cliffMonths: 12, frequency: "monthly" },
      "2027-07-01",
    ).vestedUnits,
    "1800.00000000",
  ));
test("quarterly vesting uses quarterly installments", () =>
  assert.equal(
    calculateVesting(
      { totalUnits: "4800", startDate: "2026-01-01", durationMonths: 48, cliffMonths: 12, frequency: "quarterly" },
      "2027-07-01",
    ).vestedInstallments,
    6,
  ));
test("vesting becomes fully vested at duration", () =>
  assert.equal(
    calculateVesting(
      { totalUnits: "4800", startDate: "2026-01-01", durationMonths: 48, cliffMonths: 12, frequency: "monthly" },
      "2030-01-01",
    ).state,
    "vested",
  ));
test("forfeiture freezes unvested units at departure", () => {
  const result = calculateVesting(
    {
      totalUnits: "4800",
      startDate: "2026-01-01",
      durationMonths: 48,
      cliffMonths: 12,
      frequency: "monthly",
      forfeitedAt: "2027-07-01",
    },
    "2028-07-01",
  );
  assert.equal(result.vestedUnits, "1800.00000000");
  assert.equal(result.unvestedUnits, "3000.00000000");
  assert.equal(result.state, "forfeited");
});
test("invalid cliff is rejected", () =>
  assert.throws(
    () =>
      calculateVesting(
        { totalUnits: "1", startDate: "2026-01-01", durationMonths: 12, cliffMonths: 13, frequency: "monthly" },
        "2026-01-01",
      ),
    /invalid_cliff/,
  ));

test("settlement aggregates contributor units", () => {
  const result = settleContributions([
    { contributorId: "alice", confirmedUnits: "7000", vestedUnits: "5000" },
    { contributorId: "alice", confirmedUnits: "7000", vestedUnits: "7000" },
  ]);
  assert.equal(result[0].vestedUnits, "12000.00000000");
});
test("settlement produces expected relative shares", () => {
  const result = settleContributions([
    { contributorId: "alice", confirmedUnits: "12000", vestedUnits: "12000" },
    { contributorId: "bob", confirmedUnits: "8000", vestedUnits: "8000" },
    { contributorId: "furkan", confirmedUnits: "20000", vestedUnits: "20000" },
  ]);
  assert.deepEqual(
    result.map((item) => item.relativeShare),
    ["30.00000000", "20.00000000", "50.00000000"],
  );
});
test("settlement relative shares total 100 percent", () => {
  const result = settleContributions([
    { contributorId: "a", confirmedUnits: "1", vestedUnits: "1" },
    { contributorId: "b", confirmedUnits: "2", vestedUnits: "2" },
  ]);
  assert.ok(Math.abs(result.reduce((sum, item) => sum + Number(item.relativeShare), 0) - 100) < 0.0000001);
});
test("settlement rejects vested units above confirmed", () =>
  assert.throws(
    () => settleContributions([{ contributorId: "a", confirmedUnits: "1", vestedUnits: "2" }]),
    /invalid_settlement_units/,
  ));
test("zero-unit settlement is deterministic", () =>
  assert.equal(
    settleContributions([{ contributorId: "a", confirmedUnits: "0", vestedUnits: "0" }])[0].relativeShare,
    "0.00000000",
  ));

test("benchmark classifies below range", () => assert.equal(classifyBenchmark("19.9", rule), "below"));
test("benchmark classifies lower boundary within", () => assert.equal(classifyBenchmark("20", rule), "within"));
test("benchmark classifies upper boundary within", () => assert.equal(classifyBenchmark("40", rule), "within"));
test("benchmark classifies above range", () => assert.equal(classifyBenchmark("40.1", rule), "above"));
test("benchmark returns a short explanation", () =>
  assert.match(benchmarkContext("32", rule).explanation, /within.*20-40%/));

test("recommendation stays within benchmark", () => {
  const result = recommendEquity({ contributionShare: "32", currentOwnership: "20", benchmark: rule });
  assert.equal(result.recommendedMinimum, "29.50000000");
  assert.equal(result.recommendedMaximum, "34.50000000");
});
test("recommendation clamps a below-range contribution", () =>
  assert.equal(
    recommendEquity({ contributionShare: "10", currentOwnership: "5", benchmark: rule }).recommendedMinimum,
    "20.00000000",
  ));
test("recommendation clamps an above-range contribution", () =>
  assert.equal(
    recommendEquity({ contributionShare: "60", currentOwnership: "45", benchmark: rule }).recommendedMaximum,
    "40.00000000",
  ));
test("recommendation explains missing current ownership", () =>
  assert.match(
    recommendEquity({ contributionShare: "30", currentOwnership: null, benchmark: rule }).rationale,
    /No current ownership/,
  ));
test("recommendation rejects malformed ranges", () =>
  assert.throws(
    () =>
      recommendEquity({
        contributionShare: "30",
        currentOwnership: null,
        benchmark: { ...rule, minimum: "50", maximum: "40" },
      }),
    /invalid_recommendation_input/,
  ));

const exportRecommendation = {
  contributorName: "Alice",
  currentAllocation: "20",
  recommendedMinimum: "27",
  recommendedMaximum: "32",
  approvedAllocation: "30",
  rationale: "Contribution supports the range.",
  vesting: { durationMonths: 48 },
  benchmark: { stage: "Pre-seed" },
};
test("export payload explicitly has no legal effect", () =>
  assert.equal(buildExportPayload("json", exportRecommendation).legalEffect, "none"));
test("Carta export remains an adapter payload", () =>
  assert.equal(buildExportPayload("carta", exportRecommendation).destination, "carta"));
test("CSV export contains approved allocation", () => assert.match(exportCsv(exportRecommendation), /"30"/));
test("CSV export escapes rationale quotes", () =>
  assert.match(exportCsv({ ...exportRecommendation, rationale: 'Said "yes"' }), /"Said ""yes"""/));

test("Equity Coach aggregates lifecycle states without counting disputes as confirmed", () => {
  const result = summarizeContributionStates(
    [
      { id: "a", contributionUnits: "100" },
      { id: "b", contributionUnits: "200" },
      { id: "c", contributionUnits: "300" },
    ],
    new Map([
      ["b", { resultingState: "confirmed" as const, confirmedUnits: "180" }],
      ["c", { resultingState: "disputed" as const, confirmedUnits: null }],
    ]),
    "45",
  );
  assert.deepEqual(result, {
    provisionalUnits: "100.00000000",
    confirmedUnits: "180.00000000",
    vestedUnits: "45.00000000",
    pendingCalibration: 1,
    disputed: 1,
  });
});
