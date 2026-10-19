export const ENGINE_VERSION = "slice-engine-3.0.0";

export const contributionStrategies = ["TIME", "CASH", "EXPENSE", "IDEA", "RELATIONSHIP"] as const;
export type ContributionStrategy = (typeof contributionStrategies)[number];

export const calculationWeightClasses = ["CORE", "SUPPORTING", "EXPERIMENTAL"] as const;
export type CalculationWeightClass = (typeof calculationWeightClasses)[number];

export const calculationStates = [
  "waiting_for_goal",
  "needs_attribution",
  "needs_input",
  "provisional",
  "superseded",
  "error",
] as const;
export type CalculationState = (typeof calculationStates)[number];

export type DecimalValue = string;

export interface NormalizedCalculationSignal {
  id: string;
  companyId: string;
  goalId: string | null;
  periodStart: string;
  periodEnd: string;
  source: string;
  sourceRef: string;
  sourcePayload: Record<string, unknown>;
  occurredAt: string;
  revision: number;
  contributionType: ContributionStrategy;
  domain: string;
  weightClass: CalculationWeightClass;
  amount: DecimalValue | null;
  currency: string | null;
  hours: DecimalValue | null;
  manualValuationAmount: DecimalValue | null;
  manualValuationCurrency: string | null;
  manualValuationApproved: boolean;
  expenseApproved: boolean;
  expenseAtRiskCapital: boolean;
  expenseReimbursed: boolean;
  economicValueAmount: DecimalValue | null;
  economicValueCurrency: string | null;
}

export interface FinalizedCalculationGoal {
  id: string;
  companyId: string;
  periodStart: string;
  periodEnd: string;
  name: string;
  status: string;
  weight: DecimalValue | null;
  revision: number;
  finalizedAt: string | null;
  finalizedBy: string | null;
}

export interface SignalContributor {
  id?: string;
  contributorId: string;
  attributionBps: number;
}

export interface CompanyCalculationSettings {
  companyId: string;
  baseCurrency: string;
  weightClassFactors: Record<CalculationWeightClass, DecimalValue>;
  cashRiskFactor: DecimalValue;
  revenueAttributionRate: DecimalValue;
  revenueSignalCapBase: DecimalValue | null;
  revenuePeriodCapBase: DecimalValue | null;
  allowAtRiskExpenseMultiplier: boolean;
  revision: number;
}

export interface RoleFmvRate {
  id: string;
  contributorId: string;
  hourlyRate: DecimalValue;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface ContributorRiskProfile {
  id: string;
  contributorId: string;
  timeRiskFactor: DecimalValue;
  cashRiskFactorOverride: DecimalValue | null;
  atRiskExpenseFactor: DecimalValue;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface FxSnapshot {
  id?: string;
  fromCurrency: string;
  toCurrency: string;
  rate: DecimalValue;
  rateDate: string;
  provider: string;
  capturedAt: string;
}

export interface RevenueValuationSnapshot {
  normalizedRevenue: DecimalValue;
  rawAttributableValue: DecimalValue;
  signalCappedValue: DecimalValue;
  periodRemainingBefore: DecimalValue | null;
}

export interface ValuationResult {
  valuationMode: string;
  originalBaseValue: DecimalValue;
  originalCurrency: string;
  normalizedBaseValue: DecimalValue;
  riskFactor: DecimalValue;
  fxSnapshot: FxSnapshot | null;
  revenue: RevenueValuationSnapshot | null;
  explanation: Record<string, unknown>;
}

export interface ProvisionalCalculation {
  companyId: string;
  periodStart: string;
  periodEnd: string;
  signalId: string;
  goalId: string;
  contributorId: string;
  calculationGroupId: string;
  strategy: ContributionStrategy;
  valuationMode: string;
  status: "provisional";
  companyBaseCurrency: string;
  originalBaseValue: DecimalValue;
  originalCurrency: string;
  normalizedBaseValue: DecimalValue;
  strategyRiskFactor: DecimalValue;
  goalFactor: DecimalValue;
  weightClass: CalculationWeightClass;
  weightClassFactor: DecimalValue;
  contributorAttributionBps: number;
  contributionUnits: DecimalValue;
  revenueRawAttributableValue: DecimalValue | null;
  revenueSignalCappedValue: DecimalValue | null;
  revenuePeriodRemainingBefore: DecimalValue | null;
  fxSnapshot: FxSnapshot | null;
  inputSnapshot: Record<string, unknown>;
  explanation: Record<string, unknown>;
}

export interface PersistedCalculation extends ProvisionalCalculation {
  id: string;
  calculationVersion: number;
  inputHash: string;
  engineVersion: string;
  createdAt: string;
  supersededAt: string | null;
  effectiveUnits: DecimalValue;
  override: CalculationOverride | null;
}

export interface CalculationOverride {
  id: string;
  calculationId: string;
  actorId: string;
  actorRole: "Founder/Admin" | "Team Lead";
  scopeType: "COMPANY" | "TEAM" | "DOMAIN";
  scopeId: string | null;
  previousUnits: DecimalValue;
  newUnits: DecimalValue;
  reason: string;
  createdAt: string;
}

export interface CalculationBlockedResponse {
  signalId: string;
  status: "waiting_for_goal" | "needs_attribution" | "needs_input";
  message: string;
  details?: Record<string, unknown>;
}
