import { z } from "zod";

import { KNOWLEDGE_CATEGORIES } from "./types";

const nullableStringSchema = z.string().trim().max(8_000).nullable();

export const knowledgeEvidenceSchema = z.object({
  sourceUrl: z.url().nullable(),
  sourceLabel: z.string().trim().min(1).max(160),
  excerpt: z.string().trim().min(1).max(500),
  evidenceType: z.enum(["direct", "pitch_deck", "founder_input", "inference"]),
});

export const knowledgeSectionSchema = z.object({
  category: z.enum(KNOWLEDGE_CATEGORIES),
  status: z.enum(["generated", "needs_review", "missing"]),
  content: nullableStringSchema,
  confidence: z.number().min(0).max(1).nullable(),
  evidence: z.array(knowledgeEvidenceSchema).max(20),
  missingInformation: z.array(z.string().trim().min(1).max(240)).max(20),
  notes: z.array(z.string().trim().min(1).max(500)).max(20),
});

export const knowledgeGenerationSchema = z
  .object({
    companySummary: z.string().trim().max(2_000).nullable(),
    sections: z.array(knowledgeSectionSchema).length(KNOWLEDGE_CATEGORIES.length),
  })
  .superRefine((value, context) => {
    for (const category of KNOWLEDGE_CATEGORIES) {
      const count = value.sections.filter((section) => section.category === category).length;
      if (count !== 1) {
        context.addIssue({
          code: "custom",
          message: `Expected exactly one ${category} section; received ${count}.`,
          path: ["sections"],
        });
      }
    }
  });

const evidenceJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceUrl: { type: ["string", "null"], description: "Exact supplied source URL, or null for founder input/inference." },
    sourceLabel: { type: "string", description: "Short human-readable source label." },
    excerpt: { type: "string", description: "A short excerpt or concise evidence explanation, never a long quotation." },
    evidenceType: { type: "string", enum: ["direct", "pitch_deck", "founder_input", "inference"] },
  },
  required: ["sourceUrl", "sourceLabel", "excerpt", "evidenceType"],
} as const;

export const knowledgeSectionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: [...KNOWLEDGE_CATEGORIES] },
    status: { type: "string", enum: ["generated", "needs_review", "missing"] },
    content: { type: ["string", "null"] },
    confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
    evidence: { type: "array", items: evidenceJsonSchema },
    missingInformation: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["category", "status", "content", "confidence", "evidence", "missingInformation", "notes"],
} as const;

export const knowledgeGenerationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    companySummary: { type: ["string", "null"] },
    sections: {
      type: "array",
      items: knowledgeSectionJsonSchema,
    },
  },
  required: ["companySummary", "sections"],
} as const;

export const singleSectionJsonSchema = knowledgeSectionJsonSchema;
