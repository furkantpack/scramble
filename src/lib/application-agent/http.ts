import "server-only";

import { ApiError } from "@/lib/signal-engine/http";
import { BrowserAgentError } from "@/lib/skyvern/errors";

export function normalizeApplicationAgentApiError(error: unknown) {
  if (!(error instanceof BrowserAgentError)) return error;
  const status = error.code === "SKYVERN_RATE_LIMIT" ? 429 : 502;
  return new ApiError(status, error.message, error.code.toLowerCase());
}
