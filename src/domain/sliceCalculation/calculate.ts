import { CalculationBlockedError, CalculationInvariantError } from "./errors";
import { bpsToFactor, d, goalWeightToFactor, units } from "./math";
import type {
  CompanyCalculationSettings,
  ContributorRiskProfile,
  FinalizedCalculationGoal,
  FxSnapshot,
  NormalizedCalculationSignal,
  ProvisionalCalculation,
  RoleFmvRate,
  SignalContributor,
  ValuationResult,
} from "./types";
import { valueCash, valueExpense, valueIdea, valueRelationship, valueTime } from "./valuation";
import { randomUUID } from "node:crypto";

export function assertCompleteAttribution(contributors: SignalContributor[]): void {
  const total = contributors.reduce((sum, contributor) => sum + contributor.attributionBps, 0);
  if (total > 10_000) throw new CalculationInvariantError("Signal attribution exceeds 100%.");
  if (total !== 10_000) {
    throw new CalculationBlockedError(
      "needs_attribution",
      `Signal attribution must total exactly 100%; got ${total / 100}%.`,
      { totalAttributionBps: total },
    );
  }
}

export function assertFinalizedGoal(
  signal: NormalizedCalculationSignal,
  goal: FinalizedCalculationGoal | null,
): asserts goal is FinalizedCalculationGoal {
  if (!signal.goalId || !goal || goal.status !== "finalized" || goal.weight === null) {
    throw new CalculationBlockedError("waiting_for_goal", "Signal must be linked to a finalized goal.", {
      signalGoalId: signal.goalId,
      goalStatus: goal?.status ?? null,
    });
  }
  if (goal.companyId !== signal.companyId) throw new CalculationInvariantError("Goal and signal companies differ.");
  if (goal.periodStart !== signal.periodStart || goal.periodEnd !== signal.periodEnd) {
    throw new CalculationInvariantError("Goal and signal periods differ.");
  }
}

export async function calculateSignalGroup(params: {
  signal: NormalizedCalculationSignal;
  goal: FinalizedCalculationGoal;
  contributors: SignalContributor[];
  settings: CompanyCalculationSettings;
  fmvByContributor: Map<string, RoleFmvRate | null>;
  riskByContributor: Map<string, ContributorRiskProfile | null>;
  getFxRate: (args: { fromCurrency: string; toCurrency: string; occurredAt: string }) => Promise<FxSnapshot | null>;
  alreadyConsumedRevenuePeriodBase: string;
  calculationGroupId?: string;
}): Promise<ProvisionalCalculation[]> {
  assertCompleteAttribution(params.contributors);
  assertFinalizedGoal(params.signal, params.goal);
  const groupId = params.calculationGroupId ?? randomUUID();
  let shared: ValuationResult | null = null;

  if (params.signal.contributionType === "IDEA") {
    shared = await valueIdea({ signal: params.signal, settings: params.settings, getFxRate: params.getFxRate });
  } else if (params.signal.contributionType === "RELATIONSHIP") {
    shared = await valueRelationship({
      signal: params.signal,
      settings: params.settings,
      getFxRate: params.getFxRate,
      alreadyConsumedPeriodBase: params.alreadyConsumedRevenuePeriodBase,
    });
  }

  const goalFactor = goalWeightToFactor(params.goal.weight as string);
  const weightClassFactor = params.settings.weightClassFactors[params.signal.weightClass];
  const results: ProvisionalCalculation[] = [];

  for (const contributor of params.contributors) {
    const risk = params.riskByContributor.get(contributor.contributorId) ?? null;
    let valuation = shared;
    if (params.signal.contributionType === "TIME") {
      valuation = await valueTime({
        signal: params.signal,
        settings: params.settings,
        fmv: params.fmvByContributor.get(contributor.contributorId) ?? null,
        risk,
        getFxRate: params.getFxRate,
      });
    } else if (params.signal.contributionType === "CASH") {
      valuation = await valueCash({
        signal: params.signal,
        settings: params.settings,
        risk,
        getFxRate: params.getFxRate,
      });
    } else if (params.signal.contributionType === "EXPENSE") {
      valuation = await valueExpense({
        signal: params.signal,
        settings: params.settings,
        risk,
        getFxRate: params.getFxRate,
      });
    }
    if (!valuation) throw new CalculationInvariantError("A valuation strategy did not return a result.");
    const attributionFactor = bpsToFactor(contributor.attributionBps);
    const contributionUnits = units(
      d(valuation.normalizedBaseValue)
        .mul(valuation.riskFactor)
        .mul(goalFactor)
        .mul(weightClassFactor)
        .mul(attributionFactor),
    );
    const inputSnapshot = {
      signal: params.signal,
      goal: params.goal,
      contributor,
      settings: params.settings,
      fmv: params.fmvByContributor.get(contributor.contributorId) ?? null,
      risk,
      fx: valuation.fxSnapshot,
    };
    results.push({
      companyId: params.signal.companyId,
      periodStart: params.signal.periodStart,
      periodEnd: params.signal.periodEnd,
      signalId: params.signal.id,
      goalId: params.goal.id,
      contributorId: contributor.contributorId,
      calculationGroupId: groupId,
      strategy: params.signal.contributionType,
      valuationMode: valuation.valuationMode,
      status: "provisional",
      companyBaseCurrency: params.settings.baseCurrency,
      originalBaseValue: valuation.originalBaseValue,
      originalCurrency: valuation.originalCurrency,
      normalizedBaseValue: valuation.normalizedBaseValue,
      strategyRiskFactor: valuation.riskFactor,
      goalFactor: units(goalFactor),
      weightClass: params.signal.weightClass,
      weightClassFactor: units(weightClassFactor),
      contributorAttributionBps: contributor.attributionBps,
      contributionUnits,
      revenueRawAttributableValue: valuation.revenue?.rawAttributableValue ?? null,
      revenueSignalCappedValue: valuation.revenue?.signalCappedValue ?? null,
      revenuePeriodRemainingBefore: valuation.revenue?.periodRemainingBefore ?? null,
      fxSnapshot: valuation.fxSnapshot,
      inputSnapshot,
      explanation: {
        ...valuation.explanation,
        formula:
          "normalized_base_value × strategy_risk_factor × finalized_goal_factor × weight_class_factor × contributor_attribution",
        values: {
          normalizedBaseValue: valuation.normalizedBaseValue,
          strategyRiskFactor: valuation.riskFactor,
          finalizedGoalFactor: units(goalFactor),
          weightClassFactor: units(weightClassFactor),
          contributorAttribution: units(attributionFactor),
          contributionUnits,
        },
      },
    });
  }
  return results;
}
