import "server-only";

import type { ApiActor } from "@/lib/signal-engine/auth";
import { ApiError } from "@/lib/signal-engine/http";

import { assertCompleteAttribution, assertFinalizedGoal, calculateSignalGroup } from "./calculate";
import { calculationInputHash } from "./canonical";
import { CalculationBlockedError } from "./errors";
import { d, money } from "./math";
import { type SliceCalculationRepository, SupabaseSliceCalculationRepository } from "./repository";
import { type CalculationBlockedResponse, ENGINE_VERSION, type NormalizedCalculationSignal } from "./types";

export class SliceCalculationService {
  constructor(private readonly repo: SliceCalculationRepository) {}

  async calculate(actor: ApiActor, signalId: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.calculateOnce(actor, signalId);
      } catch (error) {
        if (error instanceof ApiError && error.code === "revenue_cap_changed" && attempt < 2) continue;
        if (error instanceof CalculationBlockedError) {
          return {
            signalId,
            status: error.state,
            message: error.message,
            details: error.details,
          } satisfies CalculationBlockedResponse;
        }
        throw error;
      }
    }
    throw new ApiError(409, "Revenue capacity kept changing. Try again.", "revenue_cap_busy");
  }

  private async calculateOnce(actor: ApiActor, signalId: string) {
    const signal = await this.repo.getSignal(signalId, actor.companyId);
    if (!signal) throw new ApiError(404, "Signal not found in this workspace.", "signal_not_found");
    const contributors = await this.repo.getContributors(signal.id, actor.companyId);
    const goal = signal.goalId ? await this.repo.getGoal(signal.goalId) : null;
    assertCompleteAttribution(contributors);
    assertFinalizedGoal(signal, goal);
    const settings = await this.repo.getSettings(actor.companyId);
    const fmvByContributor = new Map();
    const riskByContributor = new Map();
    await Promise.all(
      contributors.map(async (contributor) => {
        const [fmv, risk] = await Promise.all([
          signal.contributionType === "TIME"
            ? this.repo.getFmv(actor.companyId, contributor.contributorId, signal.occurredAt)
            : Promise.resolve(null),
          this.repo.getRisk(actor.companyId, contributor.contributorId, signal.occurredAt),
        ]);
        fmvByContributor.set(contributor.contributorId, fmv);
        riskByContributor.set(contributor.contributorId, risk);
      }),
    );
    const consumed =
      signal.contributionType === "RELATIONSHIP"
        ? await this.repo.getRevenueConsumed(actor.companyId, signal.periodStart, signal.periodEnd, signal.id)
        : "0.00000000";
    const rows = await calculateSignalGroup({
      signal,
      goal,
      contributors,
      settings,
      fmvByContributor,
      riskByContributor,
      getFxRate: (args) => this.repo.getFx(args.fromCurrency, args.toCurrency, args.occurredAt),
      alreadyConsumedRevenuePeriodBase: consumed,
    });
    const inputHash = calculationInputHash({
      engineVersion: ENGINE_VERSION,
      rows: rows.map(({ inputSnapshot }) => inputSnapshot),
      consumed: signal.contributionType === "RELATIONSHIP" ? consumed : null,
    });
    return this.repo.persist({
      actor,
      signalId,
      inputHash,
      engineVersion: ENGINE_VERSION,
      rows,
      expectedRevenueConsumed: signal.contributionType === "RELATIONSHIP" ? consumed : null,
    });
  }

  async latest(actor: ApiActor, signalId: string) {
    let signal: NormalizedCalculationSignal | null;
    try {
      signal = await this.repo.getSignal(signalId, actor.companyId);
    } catch (error) {
      if (error instanceof CalculationBlockedError) {
        return { signalId, status: error.state, message: error.message, details: error.details, calculations: [] };
      }
      throw error;
    }
    if (!signal) throw new ApiError(404, "Signal not found in this workspace.", "signal_not_found");
    const calculations = await this.repo.getLatest(signalId, actor.companyId);
    if (calculations.length === 0) {
      return {
        signalId,
        status: "needs_input",
        message: "No provisional calculation has been created for this signal yet.",
        calculations: [],
      };
    }
    return { signalId, status: "provisional", calculations: calculations.map(withEffectiveUnits) };
  }

  async override(actor: ApiActor, calculationId: string, newUnits: string, reason: string) {
    if (!d(newUnits).isFinite() || d(newUnits).isNegative()) {
      throw new ApiError(400, "Contribution Units must be a non-negative number.", "invalid_units");
    }
    return { override: await this.repo.override(actor, calculationId, money(newUnits), reason.trim()) };
  }
}

function withEffectiveUnits(row: Record<string, unknown>) {
  const overrides = Array.isArray(row.contribution_calculation_overrides)
    ? [...(row.contribution_calculation_overrides as Record<string, unknown>[])].sort((a, b) =>
        String(b.created_at).localeCompare(String(a.created_at)),
      )
    : [];
  return {
    ...row,
    effective_units: overrides[0]?.new_units ?? row.contribution_units,
    current_override: overrides[0] ?? null,
  };
}

export const sliceCalculationService = new SliceCalculationService(new SupabaseSliceCalculationRepository());
