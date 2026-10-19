export type GeminiErrorCode =
  | "GEMINI_AUTH_ERROR"
  | "GEMINI_RATE_LIMIT"
  | "GEMINI_INVALID_RESPONSE"
  | "GEMINI_SCHEMA_ERROR"
  | "GEMINI_TIMEOUT"
  | "GEMINI_UNKNOWN";

export class GeminiIntegrationError extends Error {
  constructor(
    public readonly code: GeminiErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GeminiIntegrationError";
  }
}

export function normalizeGeminiError(error: unknown) {
  if (error instanceof GeminiIntegrationError) return error;
  const status = objectNumber(error, "status") ?? objectNumber(error, "statusCode");
  const code = objectString(error, "code");
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (status === 401 || status === 403 || code === "PERMISSION_DENIED" || message.includes("api key")) {
    return new GeminiIntegrationError("GEMINI_AUTH_ERROR", "Gemini authentication failed.", error);
  }
  if (status === 429 || code === "RESOURCE_EXHAUSTED" || message.includes("rate limit")) {
    return new GeminiIntegrationError("GEMINI_RATE_LIMIT", "Gemini is temporarily rate limited.", error);
  }
  if (code === "DEADLINE_EXCEEDED" || message.includes("timeout") || message.includes("timed out")) {
    return new GeminiIntegrationError("GEMINI_TIMEOUT", "Gemini did not respond in time.", error);
  }
  return new GeminiIntegrationError("GEMINI_UNKNOWN", "Gemini generation failed.", error);
}

function objectString(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  const candidate = value[key as keyof typeof value];
  return typeof candidate === "string" ? candidate : undefined;
}

function objectNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) return undefined;
  const candidate = value[key as keyof typeof value];
  return typeof candidate === "number" ? candidate : undefined;
}
