import { z } from "zod";

export const PROFILE_FIELDS = [
  "company_name",
  "one_liner",
  "product_description",
  "problem",
  "solution",
  "industry",
  "market_category",
  "target_customers",
  "business_model",
  "pricing",
  "market_opportunity",
  "competitors",
  "differentiation",
  "traction",
  "metrics",
  "founders_team",
  "funding_stage",
  "fundraising",
  "geographic_focus",
  "startup_maturity",
  "technologies",
  "other_relevant_information",
] as const;

export type ProfileFieldKey = (typeof PROFILE_FIELDS)[number];
const sourceSchema = z.enum(["website", "pitch_deck", "both", "founder"]);
const evidenceSchema = z.object({
  source: z.enum(["website", "pitch_deck", "founder"]),
  url: z.url().nullable(),
  page: z.number().int().positive().nullable(),
  excerpt: z.string().trim().max(500),
});
const fieldSchema = z.object({
  value: z.string().trim().max(4_000).nullable(),
  source: sourceSchema,
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.array(evidenceSchema).max(8),
});

export const unifiedAnalysisSchema = z.object({
  fields: z.record(z.enum(PROFILE_FIELDS), fieldSchema),
  conflicts: z
    .array(
      z.object({
        field: z.enum(PROFILE_FIELDS),
        websiteValue: z.string().trim().max(2_000).nullable(),
        pitchDeckValue: z.string().trim().max(2_000).nullable(),
        reason: z.string().trim().max(500),
      }),
    )
    .max(30),
  missingFields: z.array(z.enum(PROFILE_FIELDS)).max(PROFILE_FIELDS.length),
  potentiallyOutdated: z
    .array(
      z.object({
        field: z.enum(PROFILE_FIELDS),
        reason: z.string().trim().max(500),
      }),
    )
    .max(30),
});

export type UnifiedAnalysis = z.infer<typeof unifiedAnalysisSchema>;
export const storedUnifiedAnalysisSchema = unifiedAnalysisSchema.extend({
  runId: z.string().uuid(),
  generatedAt: z.iso.datetime(),
  model: z.string(),
  sourceRefs: z.object({ websiteUrls: z.array(z.url()), pitchDeckAssetId: z.string().uuid().nullable() }),
});
export type StoredUnifiedAnalysis = z.infer<typeof storedUnifiedAnalysisSchema>;
export const confirmedProfileSchema = z.object({
  fields: z.record(z.enum(PROFILE_FIELDS), z.string().trim().max(4_000).nullable()),
  analysisRunId: z.string().uuid(),
  provenance: z.record(z.enum(PROFILE_FIELDS), fieldSchema.omit({ value: true })).optional(),
});
export type ConfirmedProfile = z.infer<typeof confirmedProfileSchema>;

const evidenceJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    source: { type: "string", enum: ["website", "pitch_deck", "founder"] },
    url: { type: ["string", "null"] },
    page: { type: ["integer", "null"] },
    excerpt: { type: "string" },
  },
  required: ["source", "url", "page", "excerpt"],
} as const;

export const unifiedAnalysisJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string", enum: [...PROFILE_FIELDS] },
          value: { type: ["string", "null"] },
          source: { type: "string", enum: ["website", "pitch_deck", "both", "founder"] },
          confidence: { type: ["number", "null"] },
          evidence: { type: "array", items: evidenceJsonSchema },
        },
        required: ["key", "value", "source", "confidence", "evidence"],
      },
    },
    conflicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          field: { type: "string", enum: [...PROFILE_FIELDS] },
          websiteValue: { type: ["string", "null"] },
          pitchDeckValue: { type: ["string", "null"] },
          reason: { type: "string" },
        },
        required: ["field", "websiteValue", "pitchDeckValue", "reason"],
      },
    },
    missingFields: { type: "array", items: { type: "string", enum: [...PROFILE_FIELDS] } },
    potentiallyOutdated: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { field: { type: "string", enum: [...PROFILE_FIELDS] }, reason: { type: "string" } },
        required: ["field", "reason"],
      },
    },
  },
  required: ["fields", "conflicts", "missingFields", "potentiallyOutdated"],
} as const;
