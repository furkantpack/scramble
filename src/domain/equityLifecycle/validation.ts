import { z } from "zod";

const decimal = z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(\.\d{1,8})?$/)]);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const calibrationSchema = z
  .object({
    action: z.enum(["accept", "dispute", "adjust", "resolve"]),
    newUnits: decimal.optional(),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();

export const vestingSchema = z
  .object({
    calculationId: z.uuid(),
    startDate: date,
    durationMonths: z.number().int().min(1).max(120).default(48),
    cliffMonths: z.number().int().min(0).max(60).default(12),
    frequency: z.enum(["monthly", "quarterly"]).default("monthly"),
  })
  .strict()
  .refine((value) => value.cliffMonths <= value.durationMonths, { path: ["cliffMonths"] });

export const forfeitureSchema = z.object({ effectiveDate: date, reason: z.string().trim().min(5).max(1000) }).strict();
export const settlementSchema = z.object({ periodStart: date, periodEnd: date, asOfDate: date }).strict();
export const recommendationSchema = z.object({ settlementId: z.uuid() }).strict();
export const approvalSchema = z.object({ approvedAllocation: decimal }).strict();
export const exportSchema = z
  .object({ destination: z.enum(["csv", "json", "manual_legal", "carta", "cake_equity"]) })
  .strict();
