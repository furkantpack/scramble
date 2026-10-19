import { z } from "zod";

const nullableText = z.string().trim().max(8_000).nullable();

export const pitchDeckProfileSchema = z.object({
  company_name: nullableText,
  one_liner: nullableText,
  problem: nullableText,
  solution: nullableText,
  product_description: nullableText,
  industry: nullableText,
  target_customer: nullableText,
  business_model: nullableText,
  business_model_details: nullableText,
  market: z.object({ tam: nullableText, sam: nullableText, som: nullableText }),
  traction: nullableText,
  metrics: z.array(z.string().trim().max(500)).max(30),
  competitors: z.array(z.string().trim().max(500)).max(30),
  competitive_advantage: nullableText,
  team: z.array(z.string().trim().max(500)).max(30),
  fundraising: z.object({
    stage: nullableText,
    raising: z.boolean().nullable(),
    amount: nullableText,
    previous_funding: nullableText,
  }),
});

export type PitchDeckProfile = z.infer<typeof pitchDeckProfileSchema>;

export const pitchDeckPageSchema = z.object({
  page: z.number().int().positive(),
  text: z.string().trim().max(4_000),
  tables: z.array(z.string().trim().max(1_000)).max(12),
  charts: z.array(z.string().trim().max(1_000)).max(12),
  visuals: z.array(z.string().trim().max(1_000)).max(12),
});

export type PitchDeckPage = z.infer<typeof pitchDeckPageSchema>;

const nullableStringJson = { type: ["string", "null"] } as const;
const textArrayJson = { type: "array", items: { type: "string" } } as const;

export const pitchDeckResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    extracted_text: {
      type: "string",
      description: "Concise transcription of meaningful slide text, up to 12000 characters.",
    },
    pages: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          page: { type: "integer" },
          text: { type: "string" },
          tables: textArrayJson,
          charts: textArrayJson,
          visuals: textArrayJson,
        },
        required: ["page", "text", "tables", "charts", "visuals"],
      },
    },
    profile: {
      type: "object",
      additionalProperties: false,
      properties: {
        company_name: nullableStringJson,
        one_liner: nullableStringJson,
        problem: nullableStringJson,
        solution: nullableStringJson,
        product_description: nullableStringJson,
        industry: nullableStringJson,
        target_customer: nullableStringJson,
        business_model: nullableStringJson,
        business_model_details: nullableStringJson,
        market: {
          type: "object",
          additionalProperties: false,
          properties: { tam: nullableStringJson, sam: nullableStringJson, som: nullableStringJson },
          required: ["tam", "sam", "som"],
        },
        traction: nullableStringJson,
        metrics: textArrayJson,
        competitors: textArrayJson,
        competitive_advantage: nullableStringJson,
        team: textArrayJson,
        fundraising: {
          type: "object",
          additionalProperties: false,
          properties: {
            stage: nullableStringJson,
            raising: { type: ["boolean", "null"] },
            amount: nullableStringJson,
            previous_funding: nullableStringJson,
          },
          required: ["stage", "raising", "amount", "previous_funding"],
        },
      },
      required: [
        "company_name",
        "one_liner",
        "problem",
        "solution",
        "product_description",
        "industry",
        "target_customer",
        "business_model",
        "business_model_details",
        "market",
        "traction",
        "metrics",
        "competitors",
        "competitive_advantage",
        "team",
        "fundraising",
      ],
    },
  },
  required: ["extracted_text", "pages", "profile"],
} as const;

export const pitchDeckResponseSchema = z.object({
  extracted_text: z.string().max(20_000),
  pages: z.array(pitchDeckPageSchema).max(80),
  profile: pitchDeckProfileSchema,
});

export function onboardingPrefill<T extends { companyName: string; description: string; stage: string }>(
  current: T,
  profile: PitchDeckProfile,
): T {
  const stage = profile.fundraising.stage?.toLowerCase().replace(/[\s-]+/g, "_");
  const recognizedStage = stage && ["idea", "pre_seed", "seed", "series_a", "later_stage"].includes(stage) ? stage : "";
  return {
    ...current,
    companyName: current.companyName.trim() || profile.company_name || "",
    description: current.description.trim() || profile.one_liner || profile.product_description || "",
    stage: current.stage || recognizedStage,
  };
}
