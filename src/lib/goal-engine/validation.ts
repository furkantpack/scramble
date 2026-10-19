import { z } from "zod";

export const weightSchema = z.number().finite().min(0).max(100).multipleOf(0.01);
export const goalInputSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    goal_code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/),
    owning_team: z.string().trim().min(1).max(80),
    period_start: z.iso.date(),
    period_end: z.iso.date(),
    consensus_method: z.enum(["single", "median_consensus"]).default("single"),
    min_quorum: z.number().int().min(1).max(100).default(1),
    voting_deadline: z.iso.datetime({ offset: true }).nullable().default(null),
    initial_weight: weightSchema.optional(),
  })
  .strict()
  .superRefine((goal, ctx) => {
    if (goal.period_end < goal.period_start)
      ctx.addIssue({ code: "custom", path: ["period_end"], message: "End must follow start" });
    if (goal.consensus_method === "single" && goal.min_quorum !== 1)
      ctx.addIssue({ code: "custom", path: ["min_quorum"], message: "Single mode requires quorum 1" });
    if (goal.consensus_method !== "single" && goal.initial_weight !== undefined)
      ctx.addIssue({ code: "custom", path: ["initial_weight"], message: "Consensus requires votes" });
  });
export const createGoalsSchema = z
  .object({
    request_id: z.uuid(),
    goals: z.array(goalInputSchema).min(1).max(20),
  })
  .strict();
export const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("vote"), weight: weightSchema, revision: z.number().int().min(0) }).strict(),
  z
    .object({ action: z.literal("finalize"), weight: weightSchema.optional(), revision: z.number().int().min(0) })
    .strict(),
  z
    .object({
      action: z.literal("reopen"),
      reason: z.string().trim().min(5).max(1000),
      revision: z.number().int().min(0),
    })
    .strict(),
  z.object({ action: z.literal("close"), revision: z.number().int().min(0) }).strict(),
]);
export type GoalInput = z.input<typeof goalInputSchema>;
