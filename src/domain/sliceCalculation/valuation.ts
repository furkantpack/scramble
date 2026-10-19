import { CalculationBlockedError } from "./errors";
import { normalizeCurrency } from "./fx";
import { d, money } from "./math";
import type {
  CompanyCalculationSettings,
  ContributorRiskProfile,
  FxSnapshot,
  NormalizedCalculationSignal,
  RoleFmvRate,
  ValuationResult,
} from "./types";

type FxGetter = (args: { fromCurrency: string; toCurrency: string; occurredAt: string }) => Promise<FxSnapshot | null>;

const positive = (value: string | null) => value !== null && d(value).gt(0);

export async function valueTime(params: {
  signal: NormalizedCalculationSignal;
  settings: CompanyCalculationSettings;
  fmv: RoleFmvRate | null;
  risk: ContributorRiskProfile | null;
  getFxRate: FxGetter;
}): Promise<ValuationResult> {
  if (!positive(params.signal.hours)) {
    throw new CalculationBlockedError("needs_input", "TIME contribution requires explicit positive hours.", {
      field: "hours",
    });
  }
  if (!params.fmv) {
    throw new CalculationBlockedError("needs_input", "TIME contribution requires an active FMV hourly rate.", {
      field: "fmv_rate",
    });
  }
  const original = money(d(params.signal.hours as string).mul(params.fmv.hourlyRate));
  const normalized = await normalizeCurrency({
    amount: original,
    fromCurrency: params.fmv.currency,
    toCurrency: params.settings.baseCurrency,
    occurredAt: params.signal.occurredAt,
    getFxRate: params.getFxRate,
  });
  return {
    valuationMode: "time_fmv",
    originalBaseValue: original,
    originalCurrency: params.fmv.currency,
    normalizedBaseValue: normalized.normalized,
    riskFactor: params.risk?.timeRiskFactor ?? "1",
    fxSnapshot: normalized.fxSnapshot,
    revenue: null,
    explanation: {
      strategy: "TIME",
      hours: params.signal.hours,
      fmvHourlyRate: params.fmv.hourlyRate,
      fmvCurrency: params.fmv.currency,
      riskSource: params.risk ? "contributor_risk_profile" : "default_1_0",
    },
  };
}

export async function valueCash(params: {
  signal: NormalizedCalculationSignal;
  settings: CompanyCalculationSettings;
  risk: ContributorRiskProfile | null;
  getFxRate: FxGetter;
}): Promise<ValuationResult> {
  if (!positive(params.signal.amount) || !params.signal.currency) {
    throw new CalculationBlockedError("needs_input", "CASH contribution requires positive amount and currency.", {
      fields: ["amount", "currency"],
    });
  }
  const normalized = await normalizeCurrency({
    amount: params.signal.amount as string,
    fromCurrency: params.signal.currency,
    toCurrency: params.settings.baseCurrency,
    occurredAt: params.signal.occurredAt,
    getFxRate: params.getFxRate,
  });
  return {
    valuationMode: "cash_actual",
    originalBaseValue: params.signal.amount as string,
    originalCurrency: params.signal.currency,
    normalizedBaseValue: normalized.normalized,
    riskFactor: params.risk?.cashRiskFactorOverride ?? params.settings.cashRiskFactor,
    fxSnapshot: normalized.fxSnapshot,
    revenue: null,
    explanation: {
      strategy: "CASH",
      riskSource: params.risk?.cashRiskFactorOverride ? "contributor_cash_override" : "company_cash_risk_factor",
    },
  };
}

export async function valueExpense(params: {
  signal: NormalizedCalculationSignal;
  settings: CompanyCalculationSettings;
  risk: ContributorRiskProfile | null;
  getFxRate: FxGetter;
}): Promise<ValuationResult> {
  if (params.signal.expenseReimbursed) {
    throw new CalculationBlockedError("needs_input", "Reimbursed expenses are not contribution capital.", {
      field: "expenseReimbursed",
    });
  }
  if (!params.signal.expenseApproved) {
    throw new CalculationBlockedError("needs_input", "EXPENSE must be approved before valuation.", {
      field: "expenseApproved",
    });
  }
  if (!positive(params.signal.amount) || !params.signal.currency) {
    throw new CalculationBlockedError("needs_input", "EXPENSE requires positive amount and currency.");
  }
  const normalized = await normalizeCurrency({
    amount: params.signal.amount as string,
    fromCurrency: params.signal.currency,
    toCurrency: params.settings.baseCurrency,
    occurredAt: params.signal.occurredAt,
    getFxRate: params.getFxRate,
  });
  const atRisk = params.signal.expenseAtRiskCapital && params.settings.allowAtRiskExpenseMultiplier;
  return {
    valuationMode: atRisk ? "expense_at_risk" : "expense_standard",
    originalBaseValue: params.signal.amount as string,
    originalCurrency: params.signal.currency,
    normalizedBaseValue: normalized.normalized,
    riskFactor: atRisk ? (params.risk?.atRiskExpenseFactor ?? "1") : "1",
    fxSnapshot: normalized.fxSnapshot,
    revenue: null,
    explanation: {
      strategy: "EXPENSE",
      approved: true,
      atRiskCapital: params.signal.expenseAtRiskCapital,
      riskMultiplierApplied: atRisk,
    },
  };
}

export async function valueIdea(params: {
  signal: NormalizedCalculationSignal;
  settings: CompanyCalculationSettings;
  getFxRate: FxGetter;
}): Promise<ValuationResult> {
  const signal = params.signal;
  if (!signal.manualValuationApproved || !positive(signal.manualValuationAmount) || !signal.manualValuationCurrency) {
    throw new CalculationBlockedError("needs_input", "IDEA/IP requires an explicitly approved manual valuation.", {
      fields: ["manualValuationApproved", "manualValuationAmount", "manualValuationCurrency"],
    });
  }
  const normalized = await normalizeCurrency({
    amount: signal.manualValuationAmount as string,
    fromCurrency: signal.manualValuationCurrency,
    toCurrency: params.settings.baseCurrency,
    occurredAt: signal.occurredAt,
    getFxRate: params.getFxRate,
  });
  return {
    valuationMode: "approved_manual_valuation",
    originalBaseValue: signal.manualValuationAmount as string,
    originalCurrency: signal.manualValuationCurrency,
    normalizedBaseValue: normalized.normalized,
    riskFactor: "1",
    fxSnapshot: normalized.fxSnapshot,
    revenue: null,
    explanation: { strategy: "IDEA", approvalSource: "explicit_manual_valuation" },
  };
}

export async function valueRelationship(params: {
  signal: NormalizedCalculationSignal;
  settings: CompanyCalculationSettings;
  getFxRate: FxGetter;
  alreadyConsumedPeriodBase: string;
}): Promise<ValuationResult> {
  const signal = params.signal;
  if (positive(signal.economicValueAmount) && signal.economicValueCurrency) {
    const normalized = await normalizeCurrency({
      amount: signal.economicValueAmount as string,
      fromCurrency: signal.economicValueCurrency,
      toCurrency: params.settings.baseCurrency,
      occurredAt: signal.occurredAt,
      getFxRate: params.getFxRate,
    });
    return {
      valuationMode: "explicit_economic_value",
      originalBaseValue: signal.economicValueAmount as string,
      originalCurrency: signal.economicValueCurrency,
      normalizedBaseValue: normalized.normalized,
      riskFactor: "1",
      fxSnapshot: normalized.fxSnapshot,
      revenue: null,
      explanation: { strategy: "RELATIONSHIP", valueSource: "approved_explicit_economic_value" },
    };
  }
  if (!positive(signal.amount) || !signal.currency) {
    throw new CalculationBlockedError(
      "needs_input",
      "RELATIONSHIP requires approved economic value or eligible revenue amount.",
    );
  }
  const normalizedRevenue = await normalizeCurrency({
    amount: signal.amount as string,
    fromCurrency: signal.currency,
    toCurrency: params.settings.baseCurrency,
    occurredAt: signal.occurredAt,
    getFxRate: params.getFxRate,
  });
  const raw = d(normalizedRevenue.normalized).mul(params.settings.revenueAttributionRate);
  const signalCapped = params.settings.revenueSignalCapBase
    ? DecimalMin(raw, d(params.settings.revenueSignalCapBase))
    : raw;
  const remaining = params.settings.revenuePeriodCapBase
    ? DecimalMax(d(0), d(params.settings.revenuePeriodCapBase).minus(params.alreadyConsumedPeriodBase))
    : null;
  const base = remaining ? DecimalMin(signalCapped, remaining) : signalCapped;
  return {
    valuationMode: "revenue_attribution",
    originalBaseValue: signal.amount as string,
    originalCurrency: signal.currency,
    normalizedBaseValue: money(base),
    riskFactor: "1",
    fxSnapshot: normalizedRevenue.fxSnapshot,
    revenue: {
      normalizedRevenue: money(normalizedRevenue.normalized),
      rawAttributableValue: money(raw),
      signalCappedValue: money(signalCapped),
      periodRemainingBefore: remaining ? money(remaining) : null,
    },
    explanation: {
      strategy: "RELATIONSHIP",
      revenueAttributionRate: params.settings.revenueAttributionRate,
      revenueSignalCapBase: params.settings.revenueSignalCapBase,
      revenuePeriodCapBase: params.settings.revenuePeriodCapBase,
    },
  };
}

function DecimalMin(a: ReturnType<typeof d>, b: ReturnType<typeof d>) {
  return a.lte(b) ? a : b;
}

function DecimalMax(a: ReturnType<typeof d>, b: ReturnType<typeof d>) {
  return a.gte(b) ? a : b;
}
