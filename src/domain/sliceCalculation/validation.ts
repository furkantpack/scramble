import { z } from "zod";

export const overrideSchema = z
  .object({
    newUnits: z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(\.\d{1,8})?$/)]),
    reason: z.string().trim().min(5).max(1000),
  })
  .strict();
