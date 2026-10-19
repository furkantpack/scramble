import { CalculationBlockedError } from "./errors";
import { d, money } from "./math";
import type { DecimalValue, FxSnapshot } from "./types";

export async function normalizeCurrency(params: {
  amount: DecimalValue;
  fromCurrency: string;
  toCurrency: string;
  occurredAt: string;
  getFxRate: (args: { fromCurrency: string; toCurrency: string; occurredAt: string }) => Promise<FxSnapshot | null>;
}): Promise<{ normalized: DecimalValue; fxSnapshot: FxSnapshot | null }> {
  const from = params.fromCurrency.trim().toUpperCase();
  const to = params.toCurrency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
    throw new CalculationBlockedError("needs_input", "A valid ISO currency is required.", { field: "currency" });
  }
  if (d(params.amount).isNegative()) throw new CalculationBlockedError("needs_input", "Amount cannot be negative.");
  if (from === to) return { normalized: money(params.amount), fxSnapshot: null };

  const snapshot = await params.getFxRate({
    fromCurrency: from,
    toCurrency: to,
    occurredAt: params.occurredAt,
  });
  if (!snapshot) {
    throw new CalculationBlockedError("needs_input", "A historical FX rate is required for this signal date.", {
      fromCurrency: from,
      toCurrency: to,
      rateDate: params.occurredAt.slice(0, 10),
    });
  }
  return { normalized: money(d(params.amount).mul(snapshot.rate)), fxSnapshot: snapshot };
}
