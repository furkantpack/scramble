import { z } from "zod";

import { KNOWLEDGE_CATEGORIES } from "@/lib/gemini/types";

const scrapedSources = z.array(
  z.object({
    url: z.url(),
    title: z.string().trim().max(240).nullish(),
    markdown: z.string().trim().min(1),
  }),
);

export const generateKnowledgeRequestSchema = z.object({
  companyId: z.string().uuid(),
  scrapedSources,
});

export const regenerateKnowledgeRequestSchema = z.object({
  companyId: z.string().uuid(),
  category: z.enum(KNOWLEDGE_CATEGORIES),
  currentContent: z.string().max(8_000).nullable(),
  founderInstruction: z.string().trim().max(2_000).nullish(),
  scrapedSources,
});
