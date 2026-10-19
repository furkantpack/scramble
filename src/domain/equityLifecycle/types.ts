export type CalibrationState = "provisional" | "disputed" | "confirmed";
export type CalibrationAction = "accept" | "dispute" | "adjust" | "resolve";

export interface CalibrationResult {
  state: CalibrationState;
  previousUnits: string;
  confirmedUnits: string | null;
  reason: string | null;
}

export type VestingFrequency = "monthly" | "quarterly";
export interface VestingScheduleInput {
  totalUnits: string;
  startDate: string;
  durationMonths: number;
  cliffMonths: number;
  frequency: VestingFrequency;
  forfeitedAt?: string | null;
}

export interface VestingPosition {
  totalUnits: string;
  vestedUnits: string;
  unvestedUnits: string;
  vestedPercentage: string;
  state: "confirmed" | "vesting" | "vested" | "forfeited";
  vestedInstallments: number;
  totalInstallments: number;
}

export interface SettlementInput {
  contributorId: string;
  confirmedUnits: string;
  vestedUnits: string;
}

export interface SettlementMember extends SettlementInput {
  eligibleUnits: string;
  relativeShare: string;
}

export type BenchmarkPosition = "below" | "within" | "above";
export interface BenchmarkRule {
  id?: string;
  stage: string;
  sector: string;
  role: string;
  minimum: string;
  maximum: string;
  sourceLabel: string;
  version: number;
}

export interface BenchmarkContext {
  rule: BenchmarkRule;
  recommendation: string;
  position: BenchmarkPosition;
  explanation: string;
}

export interface EquityRecommendationInput {
  contributionShare: string;
  currentOwnership: string | null;
  benchmark: BenchmarkRule;
}

export interface EquityRecommendationResult {
  recommendedMinimum: string;
  recommendedMaximum: string;
  benchmarkPosition: BenchmarkPosition;
  rationale: string;
}

export type ExportDestination = "csv" | "json" | "manual_legal" | "carta" | "cake_equity";
