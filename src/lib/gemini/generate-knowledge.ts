import "server-only";

import { ZodError } from "zod";

import { generateGeminiJson } from "./client";
import { GeminiIntegrationError } from "./errors";
import { buildKnowledgePrompt, KNOWLEDGE_SYSTEM_INSTRUCTION, prepareGenerateKnowledgeInput } from "./knowledge-prompt";
import { knowledgeGenerationJsonSchema, knowledgeGenerationSchema } from "./knowledge-schema";
import type { GeminiJsonGenerator, GenerateKnowledgeInput, KnowledgeGenerationResult } from "./types";
import { KNOWLEDGE_CATEGORIES } from "./types";

export async function generateCompanyKnowledge(
  input: GenerateKnowledgeInput,
  generator: GeminiJsonGenerator = generateGeminiJson,
) {
  let prepared: ReturnType<typeof prepareGenerateKnowledgeInput>;
  try {
    prepared = prepareGenerateKnowledgeInput(input);
  } catch (error) {
    throw new GeminiIntegrationError("GEMINI_SCHEMA_ERROR", "Knowledge generation input is invalid.", error);
  }

  const response = await generator({
    systemInstruction: KNOWLEDGE_SYSTEM_INSTRUCTION,
    prompt: buildKnowledgePrompt(prepared),
    schema: knowledgeGenerationJsonSchema,
  });

  const parsed = parseAndValidate(response.text);
  validateEvidenceUrls(parsed, new Set(prepared.scrapedSources.map((source) => source.url)));
  const deckPages = new Set(prepared.deckSource?.pages.map((page) => page.page) ?? []);
  const ordered: KnowledgeGenerationResult = {
    companySummary: parsed.companySummary,
    sections: KNOWLEDGE_CATEGORIES.map((category) => {
      const section = parsed.sections.find((candidate) => candidate.category === category);
      if (!section) throw new GeminiIntegrationError("GEMINI_SCHEMA_ERROR", `Gemini omitted ${category}.`);
      return normalizeSection(section, deckPages);
    }),
  };

  return { result: ordered, usage: response.usage, model: response.model };
}

function parseAndValidate(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new GeminiIntegrationError("GEMINI_INVALID_RESPONSE", "Gemini returned invalid JSON.", error);
  }
  try {
    return knowledgeGenerationSchema.parse(value);
  } catch (error) {
    const message =
      error instanceof ZodError
        ? "Gemini output did not match the Knowledge Base schema."
        : "Gemini output validation failed.";
    throw new GeminiIntegrationError("GEMINI_SCHEMA_ERROR", message, error);
  }
}

function validateEvidenceUrls(result: KnowledgeGenerationResult, allowedUrls: Set<string>) {
  for (const section of result.sections) {
    for (const evidence of section.evidence) {
      if (evidence.evidenceType === "direct" && (!evidence.sourceUrl || !allowedUrls.has(evidence.sourceUrl))) {
        throw new GeminiIntegrationError(
          "GEMINI_SCHEMA_ERROR",
          `Gemini used an unknown direct-evidence URL in ${section.category}.`,
        );
      }
    }
  }
}

function normalizeSection(section: KnowledgeGenerationResult["sections"][number], deckPages: Set<number>) {
  const evidence = section.evidence.flatMap((item) => {
    if (item.evidenceType !== "pitch_deck") return [{ ...item, excerpt: item.excerpt.slice(0, 500) }];
    const pageMatch = /\b(?:page|p\.?)\s*#?\s*(\d+)\b/i.exec(item.sourceLabel);
    const page = pageMatch ? Number(pageMatch[1]) : deckPages.size === 1 ? [...deckPages][0] : null;
    if (page === null || !deckPages.has(page)) return [];
    return [{ ...item, sourceUrl: null, sourceLabel: `Pitch deck · page ${page}`, excerpt: item.excerpt.slice(0, 500) }];
  });
  const unsupportedDeckClaim = section.evidence.length > 0 && evidence.length === 0;
  return {
    ...section,
    status: unsupportedDeckClaim ? "missing" as const : section.status,
    content: unsupportedDeckClaim ? null : section.content?.trim() || null,
    confidence: unsupportedDeckClaim || (section.status === "missing" && evidence.length === 0) ? null : section.confidence,
    evidence,
  };
}
