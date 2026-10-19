import "server-only";

import type { ApiActor } from "@/lib/signal-engine/auth";
import { ApiError } from "@/lib/signal-engine/http";
import { createSignalEngineAdminClient } from "@/lib/signal-engine/supabase-admin";

import { CalculationBlockedError } from "./errors";
import { d, money } from "./math";
import type {
  CompanyCalculationSettings,
  ContributorRiskProfile,
  FinalizedCalculationGoal,
  FxSnapshot,
  NormalizedCalculationSignal,
  ProvisionalCalculation,
  RoleFmvRate,
  SignalContributor,
} from "./types";

type Db = ReturnType<typeof createSignalEngineAdminClient>;

export interface SliceCalculationRepository {
  getSignal(id: string, companyId: string): Promise<NormalizedCalculationSignal | null>;
  getGoal(id: string): Promise<FinalizedCalculationGoal | null>;
  getSettings(companyId: string): Promise<CompanyCalculationSettings>;
  getContributors(signalId: string, companyId: string): Promise<SignalContributor[]>;
  getFmv(companyId: string, contributorId: string, occurredAt: string): Promise<RoleFmvRate | null>;
  getRisk(companyId: string, contributorId: string, occurredAt: string): Promise<ContributorRiskProfile | null>;
  getFx(fromCurrency: string, toCurrency: string, occurredAt: string): Promise<FxSnapshot | null>;
  getRevenueConsumed(
    companyId: string,
    periodStart: string,
    periodEnd: string,
    excludingSignal: string,
  ): Promise<string>;
  persist(params: {
    actor: ApiActor;
    signalId: string;
    inputHash: string;
    engineVersion: string;
    rows: ProvisionalCalculation[];
    expectedRevenueConsumed: string | null;
  }): Promise<Record<string, unknown>>;
  getLatest(signalId: string, companyId: string): Promise<Record<string, unknown>[]>;
  override(actor: ApiActor, calculationId: string, newUnits: string, reason: string): Promise<Record<string, unknown>>;
}

export class SupabaseSliceCalculationRepository implements SliceCalculationRepository {
  // Defer runtime-only secret validation until a request actually uses the engine.
  // Eager construction here made `next build` require deployment secrets while
  // collecting route metadata.
  private get db(): Db {
    return createSignalEngineAdminClient();
  }

  async getSignal(id: string, companyId: string) {
    const { data, error } = await this.db
      .from("signals")
      .select("*, linked_goal:goals!goal_id(period_start,period_end)")
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) databaseError(error);
    if (!data) return null;
    if (!data.calculation_strategy) {
      throw new CalculationBlockedError("needs_input", "Choose an explicit calculation strategy for this signal.", {
        field: "calculation_strategy",
      });
    }
    const fallbackDate = String(data.occurred_at).slice(0, 10);
    const linkedGoal = data.linked_goal as { period_start?: string; period_end?: string } | null;
    return {
      id: data.id,
      companyId: data.company_id,
      goalId: data.goal_id,
      periodStart: data.calculation_period_start ?? linkedGoal?.period_start ?? fallbackDate,
      periodEnd: data.calculation_period_end ?? linkedGoal?.period_end ?? fallbackDate,
      source: String(data.source_tool ?? "MANUAL").toUpperCase(),
      sourceRef: data.source_url ?? data.external_url ?? data.external_key ?? data.external_id,
      sourcePayload: data.raw_payload ?? {},
      occurredAt: data.occurred_at,
      revision: data.calculation_revision ?? 0,
      contributionType: data.calculation_strategy,
      domain: data.calculation_domain ?? data.domain_tag ?? "DOMAIN-OPS",
      weightClass: data.calculation_weight_class ?? legacyWeight(data.weight_tag ?? data.weight_class),
      amount: decimalOrNull(data.amount),
      currency: data.currency,
      hours: decimalOrNull(data.hours),
      manualValuationAmount: decimalOrNull(data.manual_valuation_amount),
      manualValuationCurrency: data.manual_valuation_currency,
      manualValuationApproved: data.manual_valuation_approved === true,
      expenseApproved: data.expense_approved === true,
      expenseAtRiskCapital: data.expense_at_risk_capital === true,
      expenseReimbursed: data.expense_reimbursed === true,
      economicValueAmount: decimalOrNull(data.economic_value_amount),
      economicValueCurrency: data.economic_value_currency,
    } as NormalizedCalculationSignal;
  }

  async getGoal(id: string) {
    const { data, error } = await this.db.from("goals").select("*").eq("id", id).maybeSingle();
    if (error) databaseError(error);
    if (!data) return null;
    return {
      id: data.id,
      companyId: data.company_id,
      periodStart: data.period_start,
      periodEnd: data.period_end,
      name: data.name,
      status: data.status,
      weight: decimalOrNull(data.weight),
      revision: data.revision ?? 0,
      finalizedAt: data.finalized_at,
      finalizedBy: data.finalized_by,
    } satisfies FinalizedCalculationGoal;
  }

  async getSettings(companyId: string) {
    const { data, error } = await this.db
      .from("contribution_engine_settings")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) databaseError(error);
    if (!data) throw new ApiError(503, "Contribution Engine settings are not initialized.", "migration_required");
    return {
      companyId,
      baseCurrency: data.base_currency,
      weightClassFactors: {
        CORE: String(data.core_factor),
        SUPPORTING: String(data.supporting_factor),
        EXPERIMENTAL: String(data.experimental_factor),
      },
      cashRiskFactor: String(data.cash_risk_factor),
      revenueAttributionRate: String(data.revenue_attribution_rate),
      revenueSignalCapBase: decimalOrNull(data.revenue_signal_cap_base),
      revenuePeriodCapBase: decimalOrNull(data.revenue_period_cap_base),
      allowAtRiskExpenseMultiplier: data.allow_at_risk_expense_multiplier,
      revision: data.revision,
    };
  }

  async getContributors(signalId: string, companyId: string) {
    const { data, error } = await this.db
      .from("signal_contributors")
      .select("id,contributor_id,attribution_bps")
      .eq("signal_id", signalId)
      .eq("company_id", companyId)
      .order("contributor_id");
    if (error) databaseError(error);
    return (data ?? []).map((item) => ({
      id: item.id,
      contributorId: item.contributor_id,
      attributionBps: item.attribution_bps,
    }));
  }

  async getFmv(companyId: string, contributorId: string, occurredAt: string) {
    const { data, error } = await this.db
      .from("contributor_fmv_rates")
      .select("*")
      .eq("company_id", companyId)
      .eq("contributor_id", contributorId)
      .lte("effective_from", occurredAt)
      .or(`effective_to.is.null,effective_to.gt.${occurredAt}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) databaseError(error);
    return data
      ? {
          id: data.id,
          contributorId: data.contributor_id,
          hourlyRate: String(data.hourly_rate),
          currency: data.currency,
          effectiveFrom: data.effective_from,
          effectiveTo: data.effective_to,
        }
      : null;
  }

  async getRisk(companyId: string, contributorId: string, occurredAt: string) {
    const { data, error } = await this.db
      .from("contributor_risk_profiles")
      .select("*")
      .eq("company_id", companyId)
      .eq("contributor_id", contributorId)
      .lte("effective_from", occurredAt)
      .or(`effective_to.is.null,effective_to.gt.${occurredAt}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) databaseError(error);
    return data
      ? ({
          id: data.id,
          contributorId: data.contributor_id,
          timeRiskFactor: String(data.time_risk_factor),
          cashRiskFactorOverride: decimalOrNull(data.cash_risk_factor_override),
          atRiskExpenseFactor: String(data.at_risk_expense_factor),
          effectiveFrom: data.effective_from,
          effectiveTo: data.effective_to,
        } satisfies ContributorRiskProfile)
      : null;
  }

  async getFx(fromCurrency: string, toCurrency: string, occurredAt: string) {
    const rateDate = occurredAt.slice(0, 10);
    const { data, error } = await this.db
      .from("fx_rate_snapshots")
      .select("*")
      .eq("from_currency", fromCurrency)
      .eq("to_currency", toCurrency)
      .eq("rate_date", rateDate)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) databaseError(error);
    return data
      ? ({
          id: data.id,
          fromCurrency: data.from_currency,
          toCurrency: data.to_currency,
          rate: String(data.rate),
          rateDate: data.rate_date,
          provider: data.provider,
          capturedAt: data.captured_at,
        } satisfies FxSnapshot)
      : null;
  }

  async getRevenueConsumed(companyId: string, periodStart: string, periodEnd: string, excludingSignal: string) {
    const { data, error } = await this.db
      .from("contribution_calculations")
      .select("signal_id,revenue_signal_capped_value,calculation_version")
      .eq("company_id", companyId)
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd)
      .eq("status", "provisional")
      .eq("valuation_mode", "revenue_attribution")
      .neq("signal_id", excludingSignal)
      .order("calculation_version", { ascending: false });
    if (error) databaseError(error);
    const bySignal = new Map<string, string>();
    for (const row of data ?? [])
      if (!bySignal.has(row.signal_id)) bySignal.set(row.signal_id, row.revenue_signal_capped_value);
    return money([...bySignal.values()].reduce((sum, value) => sum.plus(value), d(0)));
  }

  async persist(params: Parameters<SliceCalculationRepository["persist"]>[0]) {
    const { data, error } = await this.db.rpc("persist_contribution_calculation", {
      p_actor: params.actor.appUserId,
      p_signal: params.signalId,
      p_input_hash: params.inputHash,
      p_engine_version: params.engineVersion,
      p_rows: params.rows,
      p_expected_revenue_consumed: params.expectedRevenueConsumed,
    });
    if (error) databaseError(error);
    return data as Record<string, unknown>;
  }

  async getLatest(signalId: string, companyId: string) {
    const { data, error } = await this.db
      .from("contribution_calculations")
      .select("*, contribution_calculation_overrides(*)")
      .eq("company_id", companyId)
      .eq("signal_id", signalId)
      .eq("status", "provisional")
      .order("contributor_id");
    if (error) databaseError(error);
    return (data ?? []) as Record<string, unknown>[];
  }

  async override(actor: ApiActor, calculationId: string, newUnits: string, reason: string) {
    const { data, error } = await this.db.rpc("override_contribution_calculation", {
      p_actor: actor.appUserId,
      p_calculation: calculationId,
      p_new_units: newUnits,
      p_reason: reason,
    });
    if (error) databaseError(error);
    return data as Record<string, unknown>;
  }
}

function legacyWeight(value: unknown): "CORE" | "SUPPORTING" | "EXPERIMENTAL" {
  if (value === "EXPERIMENTAL" || value === "WEIGHT-EXPERIMENTAL") return "EXPERIMENTAL";
  if (value === "SUPPORTING" || value === "WEIGHT-SUPPORTING") return "SUPPORTING";
  return "CORE";
}

function decimalOrNull(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

const dbMessages: Record<string, [number, string]> = {
  forbidden: [403, "Your account cannot perform this calculation."],
  signal_not_found: [404, "Signal not found in this workspace."],
  calculation_not_found: [404, "Active calculation not found in this workspace."],
  invalid_calculation: [400, "The calculation payload failed an integrity check."],
  revenue_cap_changed: [409, "Revenue capacity changed while calculating. Retry the calculation."],
  override_scope_forbidden: [403, "This calculation is outside your explicit override scope."],
  invalid_override: [400, "Enter non-negative units and a reason of at least five characters."],
  attribution_exceeds_100_percent: [409, "Contributor allocation cannot exceed 100%."],
};

export function databaseError(error: { code?: string; message?: string }): never {
  const key = Object.keys(dbMessages).find((item) => error.message?.includes(item));
  if (key) throw new ApiError(dbMessages[key][0], dbMessages[key][1], key);
  if (["42703", "42P01", "PGRST202", "PGRST204"].includes(error.code ?? "")) {
    throw new ApiError(
      503,
      "Apply the Slice Calculation Engine migration before using this feature.",
      "migration_required",
    );
  }
  throw new ApiError(500, "The contribution calculation could not be saved.", "calculation_storage_error");
}
