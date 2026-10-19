import "server-only";

import { SkyvernError, SkyvernTimeoutError } from "@skyvern/client";

export type BrowserAgentErrorCode =
  | "SKYVERN_AUTH_ERROR"
  | "SKYVERN_RATE_LIMIT"
  | "SKYVERN_RUN_FAILED"
  | "SKYVERN_TIMEOUT"
  | "SKYVERN_UNKNOWN";

export class BrowserAgentError extends Error {
  constructor(
    readonly code: BrowserAgentErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "BrowserAgentError";
  }
}

export function normalizeSkyvernError(error: unknown): BrowserAgentError {
  if (error instanceof BrowserAgentError) return error;
  if (error instanceof SkyvernTimeoutError || (error instanceof Error && error.name === "AbortError")) {
    return new BrowserAgentError("SKYVERN_TIMEOUT", "The browser agent timed out", true);
  }
  if (error instanceof SkyvernError) {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return new BrowserAgentError("SKYVERN_AUTH_ERROR", "The browser agent could not authenticate");
    }
    if (error.statusCode === 408 || error.statusCode === 429) {
      return new BrowserAgentError(
        error.statusCode === 429 ? "SKYVERN_RATE_LIMIT" : "SKYVERN_TIMEOUT",
        error.statusCode === 429 ? "The browser agent rate limit was reached" : "The browser agent timed out",
        true,
      );
    }
    if (error.statusCode && error.statusCode >= 500) {
      return new BrowserAgentError("SKYVERN_UNKNOWN", "The browser agent is temporarily unavailable", true);
    }
    return new BrowserAgentError("SKYVERN_RUN_FAILED", "The browser agent rejected the operation");
  }
  return new BrowserAgentError("SKYVERN_UNKNOWN", "The browser agent operation failed");
}
