import type { KnowledgeGenerationResult, KnowledgeSection } from "../types";
import { KNOWLEDGE_CATEGORIES } from "../types";

export const websiteUrl = "https://example.com";

export function missingSection(category: KnowledgeSection["category"]): KnowledgeSection {
  return {
    category,
    status: "missing",
    content: null,
    confidence: null,
    evidence: [],
    missingInformation: [`Verified ${category} information`],
    notes: ["The supplied sources do not support a factual answer."],
  };
}

export function resultWith(overrides: Partial<Record<KnowledgeSection["category"], KnowledgeSection>>) {
  return {
    companySummary: "A concise company summary based on supplied sources.",
    sections: KNOWLEDGE_CATEGORIES.map((category) => overrides[category] ?? missingSection(category)),
  } satisfies KnowledgeGenerationResult;
}

export function directSection(category: KnowledgeSection["category"], content: string): KnowledgeSection {
  return {
    category,
    status: "generated",
    content,
    confidence: 0.86,
    evidence: [
      {
        sourceUrl: websiteUrl,
        sourceLabel: "Company website",
        excerpt: content.slice(0, 120),
        evidenceType: "direct",
      },
    ],
    missingInformation: [],
    notes: [],
  };
}
