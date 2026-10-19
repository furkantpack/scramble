import "server-only";

import { ZodError } from "zod";

import { generateGeminiJson } from "./client";
import { GeminiIntegrationError } from "./errors";
import { knowledgeSectionSchema, singleSectionJsonSchema } from "./knowledge-schema";
import { buildRegenerationPrompt, KNOWLEDGE_SYSTEM_INSTRUCTION } from "./knowledge-prompt";
import type { GeminiJsonGenerator, RegenerateKnowledgeSectionInput } from "./types";

export async function regenerateKnowledgeSection(
  input: RegenerateKnowledgeSectionInput,
  generator: GeminiJsonGenerator = generateGeminiJson,
) {
  let prompt: string;
  try {
    prompt = buildRegenerationPrompt(input);
  } catch (error) {
    throw new GeminiIntegrationError("GEMINI_SCHEMA_ERROR", "Section regeneration input is invalid.", error);
  }
  const response = await generator({
    systemInstruction: KNOWLEDGE_SYSTEM_INSTRUCTION,
    prompt,
    schema: singleSectionJsonSchema,
  });

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(response.text);
  } catch (error) {
    throw new GeminiIntegrationError("GEMINI_INVALID_RESPONSE", "Gemini returned invalid section JSON.", error);
  }
  try {
    const proposedVersion = knowledgeSectionSchema.parse(parsedJson);
    if (proposedVersion.category !== input.category) {
      throw new GeminiIntegrationError("GEMINI_SCHEMA_ERROR", "Gemini returned the wrong Knowledge Base category.");
    }
    const allowedUrls = new Set(input.scrapedSources.map((source) => source.url));
    if (
      proposedVersion.evidence.some(
        (evidence) => evidence.evidenceType === "direct" && (!evidence.sourceUrl || !allowedUrls.has(evidence.sourceUrl)),
      )
    ) {
      throw new GeminiIntegrationError("GEMINI_SCHEMA_ERROR", "Gemini returned an unknown direct-evidence URL.");
    }
    return {
      currentVersion: input.currentContent,
      proposedVersion,
      usage: response.usage,
      model: response.model,
    };
  } catch (error) {
    if (error instanceof GeminiIntegrationError) throw error;
    throw new GeminiIntegrationError(
      "GEMINI_SCHEMA_ERROR",
      error instanceof ZodError ? "Gemini section output did not match the schema." : "Gemini section validation failed.",
      error,
    );
  }
}
