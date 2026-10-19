import { d, units } from "@/domain/sliceCalculation/math";

import type { VestingPosition, VestingScheduleInput } from "./types";

const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

export function wholeMonthsBetween(startDate: string, asOfDate: string): number {
  if (!dateOnly.test(startDate) || !dateOnly.test(asOfDate)) throw new Error("invalid_date");
  const start = new Date(`${startDate}T00:00:00Z`);
  const asOf = new Date(`${asOfDate}T00:00:00Z`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(asOf.valueOf())) throw new Error("invalid_date");
  let months = (asOf.getUTCFullYear() - start.getUTCFullYear()) * 12 + asOf.getUTCMonth() - start.getUTCMonth();
  if (asOf.getUTCDate() < start.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

export function calculateVesting(input: VestingScheduleInput, asOfDate: string): VestingPosition {
  if (!Number.isInteger(input.durationMonths) || input.durationMonths <= 0) throw new Error("invalid_duration");
  if (!Number.isInteger(input.cliffMonths) || input.cliffMonths < 0 || input.cliffMonths > input.durationMonths) {
    throw new Error("invalid_cliff");
  }
  const total = d(input.totalUnits);
  if (!total.isFinite() || total.isNegative()) throw new Error("invalid_units");
  const effectiveAsOf = input.forfeitedAt && input.forfeitedAt < asOfDate ? input.forfeitedAt : asOfDate;
  const elapsed = wholeMonthsBetween(input.startDate, effectiveAsOf);
  const interval = input.frequency === "quarterly" ? 3 : 1;
  const totalInstallments = Math.ceil(input.durationMonths / interval);
  let vestedInstallments = 0;
  if (elapsed >= input.cliffMonths) vestedInstallments = Math.min(totalInstallments, Math.floor(elapsed / interval));
  const vested = total.mul(vestedInstallments).div(totalInstallments);
  const unvested = total.minus(vested);
  const percentage = total.isZero() ? d(0) : vested.div(total).mul(100);
  let state: VestingPosition["state"] = "vesting";
  if (input.forfeitedAt && input.forfeitedAt <= asOfDate) state = "forfeited";
  else if (vested.gte(total)) state = "vested";
  else if (vested.isZero()) state = "confirmed";
  return {
    totalUnits: units(total),
    vestedUnits: units(vested),
    unvestedUnits: units(unvested),
    vestedPercentage: units(percentage),
    state,
    vestedInstallments,
    totalInstallments,
  };
}
