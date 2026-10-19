import "server-only";

import { GoogleGenAI } from "@google/genai";

import { GeminiIntegrationError, normalizeGeminiError } from "./errors";
import type { GeminiJsonGenerator } from "./types";

const DEFAULT_MODEL = "gemini-3.8-flash";
const REQUEST_TIMEOUT_MS = 60_000;

export function getGeminiModel() {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

export const generateGeminiJson: GeminiJsonGenerator = async ({ systemInstruction, prompt, schema }) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new GeminiIntegrationError("GEMINI_AUTH_ERROR", "Gemini server configuration is missing.");
  const model = getGeminiModel();
  try {
    const client = new GoogleGenAI({ apiKey });
    const response = await client.models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        responseJsonSchema: schema,
        maxOutputTokens: 8192,
        httpOptions: { timeout: REQUEST_TIMEOUT_MS },
      },
    });
    if (!response.text) {
      throw new GeminiIntegrationError("GEMINI_INVALID_RESPONSE", "Gemini returned no structured output.");
    }
    return {
      text: response.text,
      model: response.modelVersion ?? model,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount ?? null,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? null,
        totalTokens: response.usageMetadata?.totalTokenCount ?? null,
      },
    };
  } catch (error) {
    throw normalizeGeminiError(error);
  }
};
