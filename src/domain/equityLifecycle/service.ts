import "server-only";

import type { ApiActor } from "@/lib/signal-engine/auth";
import { ApiError } from "@/lib/signal-engine/http";
import { createSignalEngineAdminClient } from "@/lib/signal-engine/supabase-admin";

import { calculationInputHash } from "../sliceCalculation/canonical";
import { d } from "../sliceCalculation/math";
import { benchmarkContext } from "./benchmark";
import { summarizeContributionStates } from "./coach";
import { buildExportPayload, exportCsv } from "./export";
import { recommendEquity } from "./recommendation";
import { settleContributions } from "./settlement";
import type { BenchmarkRule, SettlementInput } from "./types";
import {
  approvalSchema,
  calibrationSchema,
  exportSchema,
  forfeitureSchema,
  recommendationSchema,
  settlementSchema,
  vestingSchema,
} from "./validation";
import { calculateVesting } from "./vesting";

const db = () => createSignalEngineAdminClient();

type CalculationReviewRow = {
  calculation_id: string;
  confirmed_units: string | number;
  resulting_state: "confirmed" | "disputed";
  calculation?: {
    contributor_id: string;
    period_start: string;
    period_end: string;
  } | null;
};

type EffectiveCalculationRow = {
  contribution_units: string | number;
  contribution_calculation_overrides?: Array<{
    new_units: string | number;
    created_at: string;
  }> | null;
};

type BenchmarkDatabaseRow = {
  id?: string;
  stage: string;
  sector: string;
  role: string;
  minimum_percent: string | number;
  maximum_percent: string | number;
  source_label: string;
  version: number;
};

type SettlementMemberRow = {
  contributor_id: string;
};

export async function getCalibration(actor: ApiActor, calculationId: string) {
  const client = db();
  const calculation = await client
    .from("contribution_calculations")
    .select(
      "id,company_id,contributor_id,contribution_units,status,contribution_calculation_overrides(new_units,created_at)",
    )
    .eq("id", calculationId)
    .eq("company_id", actor.companyId)
    .maybeSingle();
  if (calculation.error) databaseError(calculation.error);
  if (!calculation.data || (actor.role === "contributor" && calculation.data.contributor_id !== actor.appUserId)) {
    throw new ApiError(404, "Contribution calculation not found.", "calculation_not_found");
  }
  const reviews = await client
    .from("calibration_reviews")
    .select("*")
    .eq("company_id", actor.companyId)
    .eq("calculation_id", calculationId)
    .order("created_at", { ascending: false });
  if (reviews.error) databaseError(reviews.error);
  const latest = reviews.data?.[0] ?? null;
  return {
    calculationId,
    actorRole: actor.role,
    state: latest?.resulting_state ?? "provisional",
    currentUnits: latest?.confirmed_units ?? effectiveCalculationUnits(calculation.data),
    latestReview: latest,
    history: reviews.data ?? [],
  };
}

export async function calibrateCalculation(actor: ApiActor, calculationId: string, body: unknown) {
  const input = calibrationSchema.parse(body);
  const { data, error } = await db().rpc("calibrate_contribution_calculation", {
    p_actor: actor.appUserId,
    p_calculation: calculationId,
    p_action: input.action,
    p_new_units: input.newUnits === undefined ? null : String(input.newUnits),
    p_reason: input.reason ?? null,
  });
  if (error) databaseError(error);
  return { review: data };
}

export async function createVesting(actor: ApiActor, body: unknown) {
  const input = vestingSchema.parse(body);
  const { data, error } = await db().rpc("create_vesting_schedule", {
    p_actor: actor.appUserId,
    p_calculation: input.calculationId,
    p_start: input.startDate,
    p_duration: input.durationMonths,
    p_cliff: input.cliffMonths,
    p_frequency: input.frequency,
  });
  if (error) databaseError(error);
  return { schedule: data };
}

export async function forfeitVesting(actor: ApiActor, scheduleId: string, body: unknown) {
  const input = forfeitureSchema.parse(body);
  const { data, error } = await db().rpc("forfeit_vesting_schedule", {
    p_actor: actor.appUserId,
    p_schedule: scheduleId,
    p_effective: input.effectiveDate,
    p_reason: input.reason,
  });
  if (error) databaseError(error);
  return { event: data };
}

export async function listVesting(actor: ApiActor, asOfDate = new Date().toISOString().slice(0, 10)) {
  const client = db();
  let query = client
    .from("vesting_schedules")
    .select("*, vesting_events(*)")
    .eq("company_id", actor.companyId)
    .order("created_at", { ascending: false });
  if (actor.role === "contributor") query = query.eq("contributor_id", actor.appUserId);
  const { data, error } = await query;
  if (error) databaseError(error);
  return {
    asOfDate,
    schedules: (data ?? []).map((schedule) => {
      const event = [...(schedule.vesting_events ?? [])].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)),
      )[0];
      return {
        ...schedule,
        position: calculateVesting(
          {
            totalUnits: String(schedule.total_confirmed_units),
            startDate: schedule.start_date,
            durationMonths: schedule.duration_months,
            cliffMonths: schedule.cliff_months,
            frequency: schedule.frequency,
            forfeitedAt: event?.effective_date ?? null,
          },
          asOfDate,
        ),
      };
    }),
  };
}

export async function runSettlement(actor: ApiActor, body: unknown) {
  const input = settlementSchema.parse(body);
  if (input.periodEnd < input.periodStart)
    throw new ApiError(400, "Period end must follow its start.", "invalid_period");
  const client = db();
  const reviews = await client
    .from("calibration_reviews")
    .select("*, calculation:contribution_calculations!calculation_id(id,contributor_id,period_start,period_end)")
    .eq("company_id", actor.companyId)
    .eq("resulting_state", "confirmed")
    .order("created_at", { ascending: false });
  if (reviews.error) databaseError(reviews.error);
  const latestByCalculation = new Map<string, CalculationReviewRow>();
  for (const review of reviews.data ?? [])
    if (!latestByCalculation.has(review.calculation_id))
      latestByCalculation.set(review.calculation_id, review as CalculationReviewRow);
  const schedules = await client
    .from("vesting_schedules")
    .select("*, vesting_events(*)")
    .eq("company_id", actor.companyId);
  if (schedules.error) databaseError(schedules.error);
  const byCalculation = new Map((schedules.data ?? []).map((schedule) => [schedule.calculation_id, schedule]));
  const settlementInputs: SettlementInput[] = [];
  for (const review of latestByCalculation.values()) {
    const calculation = review.calculation;
    if (!calculation || calculation.period_start !== input.periodStart || calculation.period_end !== input.periodEnd)
      continue;
    const schedule = byCalculation.get(review.calculation_id);
    const confirmed = String(review.confirmed_units);
    let vested = confirmed;
    if (schedule) {
      const event = schedule.vesting_events?.[0];
      vested = calculateVesting(
        {
          totalUnits: confirmed,
          startDate: schedule.start_date,
          durationMonths: schedule.duration_months,
          cliffMonths: schedule.cliff_months,
          frequency: schedule.frequency,
          forfeitedAt: event?.effective_date ?? null,
        },
        input.asOfDate,
      ).vestedUnits;
    }
    settlementInputs.push({
      contributorId: calculation.contributor_id,
      confirmedUnits: confirmed,
      vestedUnits: vested,
    });
  }
  if (settlementInputs.length === 0)
    throw new ApiError(409, "No confirmed contributions are eligible for this period.", "nothing_to_settle");
  const members = settleContributions(settlementInputs);
  const hash = calculationInputHash({ input, members });
  const { data, error } = await client.rpc("persist_period_settlement", {
    p_actor: actor.appUserId,
    p_start: input.periodStart,
    p_end: input.periodEnd,
    p_as_of: input.asOfDate,
    p_hash: hash,
    p_members: members,
  });
  if (error) databaseError(error);
  return { ...((data ?? {}) as object), members };
}

export async function latestSettlement(actor: ApiActor) {
  const client = db();
  const settlement = await client
    .from("period_settlements")
    .select(
      "*, members:period_settlement_members(*, contributor:app_users!contributor_id(name,email,role,benchmark_role,current_ownership_percent))",
    )
    .eq("company_id", actor.companyId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (settlement.error) databaseError(settlement.error);
  if (!settlement.data || actor.role !== "contributor") return { settlement: settlement.data };
  const members = (settlement.data.members as SettlementMemberRow[]).filter(
    (member) => member.contributor_id === actor.appUserId,
  );
  return { settlement: { ...settlement.data, members } };
}

export async function getBenchmark(actor: ApiActor, stage: string, sector: string, role: string, share: string) {
  const client = db();
  const { data, error } = await client
    .from("benchmark_rules")
    .select("*")
    .or(`company_id.eq.${actor.companyId},company_id.is.null`)
    .eq("stage", stage)
    .in("sector", [sector, "*"])
    .eq("role", role)
    .eq("active", true)
    .order("company_id", { ascending: false, nullsFirst: false })
    .order("sector", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new ApiError(404, "No benchmark rule matches this stage, sector, and role.", "benchmark_not_found");
  return benchmarkContext(share, mapBenchmark(data));
}

export async function generateRecommendations(actor: ApiActor, body: unknown) {
  const input = recommendationSchema.parse(body);
  const client = db();
  const companyResult = await client.from("companies").select("stage,sector").eq("id", actor.companyId).single();
  if (companyResult.error) databaseError(companyResult.error);
  const members = await client
    .from("period_settlement_members")
    .select("*, contributor:app_users!contributor_id(name,role,benchmark_role,current_ownership_percent)")
    .eq("company_id", actor.companyId)
    .eq("settlement_id", input.settlementId);
  if (members.error) databaseError(members.error);
  const saved = [];
  for (const member of members.data ?? []) {
    const role = member.contributor?.benchmark_role ?? defaultBenchmarkRole(member.contributor?.role);
    const context = await getBenchmark(
      actor,
      companyResult.data.stage ?? "Pre-seed",
      companyResult.data.sector ?? "*",
      role,
      String(member.relative_share),
    );
    const currentOwnership = member.contributor?.current_ownership_percent;
    const recommendation = recommendEquity({
      contributionShare: String(member.relative_share),
      currentOwnership: currentOwnership == null ? null : String(currentOwnership),
      benchmark: context.rule,
    });
    const result = await client.rpc("persist_equity_recommendation", {
      p_actor: actor.appUserId,
      p_member: member.id,
      p_benchmark: context.rule.id,
      p_current: member.contributor?.current_ownership_percent ?? null,
      p_min: recommendation.recommendedMinimum,
      p_max: recommendation.recommendedMaximum,
      p_rationale: recommendation.rationale,
      p_snapshot: context,
    });
    if (result.error) databaseError(result.error);
    saved.push(result.data);
  }
  return { recommendations: saved };
}

export async function listRecommendations(actor: ApiActor) {
  const client = db();
  let query = client
    .from("equity_recommendations")
    .select(
      "*, contributor:app_users!contributor_id(name,email,role), exports:equity_exports(id,destination,status,created_at)",
    )
    .eq("company_id", actor.companyId)
    .order("created_at", { ascending: false });
  if (actor.role === "contributor") query = query.eq("contributor_id", actor.appUserId);
  const { data, error } = await query;
  if (error) databaseError(error);
  return { recommendations: data ?? [] };
}

export async function approveRecommendation(actor: ApiActor, recommendationId: string, body: unknown) {
  const input = approvalSchema.parse(body);
  const { data, error } = await db().rpc("approve_equity_recommendation", {
    p_actor: actor.appUserId,
    p_recommendation: recommendationId,
    p_allocation: String(input.approvedAllocation),
  });
  if (error) databaseError(error);
  return { recommendation: data };
}

export async function createExport(actor: ApiActor, recommendationId: string, body: unknown) {
  const input = exportSchema.parse(body);
  const client = db();
  const result = await client
    .from("equity_recommendations")
    .select(
      "*, contributor:app_users!contributor_id(name), settlement_member:period_settlement_members!settlement_member_id(*)",
    )
    .eq("id", recommendationId)
    .eq("company_id", actor.companyId)
    .in("status", ["approved", "exported"])
    .maybeSingle();
  if (result.error) databaseError(result.error);
  if (!result.data) throw new ApiError(409, "Approve the recommendation before export.", "recommendation_not_approved");
  const recommendation = result.data;
  const exportRecommendation = {
    contributorName: recommendation.contributor?.name ?? recommendation.contributor_id,
    currentAllocation: recommendation.current_ownership === null ? null : String(recommendation.current_ownership),
    recommendedMinimum: String(recommendation.recommended_minimum),
    recommendedMaximum: String(recommendation.recommended_maximum),
    approvedAllocation: String(recommendation.approved_allocation),
    rationale: recommendation.rationale,
    vesting: { vestedUnits: recommendation.settlement_member?.vested_units ?? null },
    benchmark: recommendation.benchmark_snapshot,
  };
  const payload = buildExportPayload(input.destination, exportRecommendation);
  const hash = calculationInputHash(payload);
  const saved = await client.rpc("create_equity_export", {
    p_actor: actor.appUserId,
    p_recommendation: recommendationId,
    p_destination: input.destination,
    p_payload: payload,
    p_hash: hash,
  });
  if (saved.error) databaseError(saved.error);
  return {
    export: saved.data,
    content: input.destination === "csv" ? exportCsv(exportRecommendation) : payload,
    adapterStatus: ["carta", "cake_equity"].includes(input.destination) ? "ready_for_provider_delivery" : "ready",
  };
}

export async function equityCoach(actor: ApiActor) {
  const client = db();
  let calculations = client
    .from("contribution_calculations")
    .select(
      "id,contributor_id,contribution_units,status,created_at,signal:signals!signal_id(source_tool,event_type,occurred_at)",
    )
    .eq("company_id", actor.companyId)
    .eq("status", "provisional");
  if (actor.role === "contributor") calculations = calculations.eq("contributor_id", actor.appUserId);
  const [calcResult, reviewsResult, vestingResult, settlementResult, recommendationResult, goalsResult] =
    await Promise.all([
      calculations,
      client
        .from("calibration_reviews")
        .select("calculation_id,resulting_state,confirmed_units,created_at")
        .eq("company_id", actor.companyId)
        .order("created_at", { ascending: false }),
      listVesting(actor),
      latestSettlement(actor),
      listRecommendations(actor),
      client
        .from("goals")
        .select("id,name,weight,status,period_start,period_end")
        .eq("company_id", actor.companyId)
        .eq("status", "finalized")
        .order("period_start", { ascending: false })
        .limit(5),
    ]);
  if (calcResult.error) databaseError(calcResult.error);
  if (reviewsResult.error) databaseError(reviewsResult.error);
  if (goalsResult.error) databaseError(goalsResult.error);
  const latestReview = new Map<string, CalculationReviewRow>();
  for (const review of reviewsResult.data ?? [])
    if (!latestReview.has(review.calculation_id))
      latestReview.set(review.calculation_id, review as CalculationReviewRow);
  const relevant = (calcResult.data ?? []).filter((calculation) =>
    actor.role === "contributor" ? calculation.contributor_id === actor.appUserId : true,
  );
  const totals = summarizeContributionStates(
    relevant.map((item) => ({ id: item.id, contributionUnits: item.contribution_units })),
    new Map(
      [...latestReview].map(([id, review]) => [
        id,
        { resultingState: review.resulting_state, confirmedUnits: review.confirmed_units },
      ]),
    ),
    vestingResult.schedules.reduce((sum, item) => sum.plus(item.position.vestedUnits), d(0)).toString(),
  );
  return {
    role: actor.role,
    totals,
    activeGoals: goalsResult.data ?? [],
    recentActivity: [...relevant]
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
      .slice(0, 6)
      .map((calculation) => {
        const signal = calculation.signal?.[0];
        return {
          id: calculation.id,
          units: calculation.contribution_units,
          state: latestReview.get(calculation.id)?.resulting_state ?? "provisional",
          source: signal?.source_tool ?? "manual",
          eventType: signal?.event_type ?? "contribution",
          occurredAt: signal?.occurred_at ?? calculation.created_at,
        };
      }),
    latestSettlement: settlementResult.settlement,
    recommendations: recommendationResult.recommendations,
  };
}

function effectiveCalculationUnits(calculation: EffectiveCalculationRow) {
  const overrides = [...(calculation.contribution_calculation_overrides ?? [])].sort((a, b) =>
    String(b.created_at).localeCompare(String(a.created_at)),
  );
  return overrides[0]?.new_units ?? calculation.contribution_units;
}

function defaultBenchmarkRole(role: string | undefined) {
  if (role === "founder_admin") return "Founder";
  if (role === "viewer_investor") return "Advisor";
  return "Early employee";
}

function mapBenchmark(row: BenchmarkDatabaseRow): BenchmarkRule {
  return {
    id: row.id,
    stage: row.stage,
    sector: row.sector,
    role: row.role,
    minimum: String(row.minimum_percent),
    maximum: String(row.maximum_percent),
    sourceLabel: row.source_label,
    version: row.version,
  };
}

const messages: Record<string, [number, string]> = {
  forbidden: [403, "Your role cannot perform this action."],
  calculation_not_found: [404, "Contribution calculation not found."],
  already_confirmed: [409, "This contribution is already confirmed."],
  calibration_scope_forbidden: [403, "This contribution is outside your review scope."],
  dispute_requires_resolution: [409, "A disputed contribution must be adjusted or resolved."],
  reason_required: [400, "Enter a reason of at least five characters."],
  invalid_units: [400, "Enter a valid non-negative unit value."],
  calculation_not_confirmed: [409, "Confirm the contribution before attaching vesting."],
  invalid_vesting: [400, "The vesting schedule is invalid."],
  vesting_not_found: [404, "Vesting schedule not found."],
  invalid_forfeiture: [400, "Enter a valid departure date and reason."],
  share_total_invalid: [409, "Settlement shares must total 100%."],
  invalid_settlement: [400, "The settlement snapshot is invalid."],
  invalid_member: [409, "A settlement member does not belong to this workspace."],
  recommendation_locked: [409, "An approved recommendation cannot be rewritten."],
  recommendation_not_approvable: [409, "This recommendation cannot be approved."],
  invalid_allocation: [400, "Approved allocation must be between 0 and 100%."],
  invalid_export: [409, "Only an approved recommendation can be exported."],
};

function databaseError(error: { code?: string; message?: string }): never {
  const key = Object.keys(messages).find((item) => error.message?.includes(item));
  if (key) throw new ApiError(messages[key][0], messages[key][1], key);
  if (["42703", "42P01", "PGRST202", "PGRST204"].includes(error.code ?? "")) {
    throw new ApiError(503, "Apply the Equity Lifecycle migration before using this feature.", "migration_required");
  }
  throw new ApiError(500, "The equity lifecycle request could not be completed.", "equity_lifecycle_error");
}
