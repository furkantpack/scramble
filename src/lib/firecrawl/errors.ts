export type FirecrawlErrorCode =
  | "FIRECRAWL_AUTH_ERROR"
  | "FIRECRAWL_RATE_LIMIT"
  | "FIRECRAWL_TIMEOUT"
  | "FIRECRAWL_BLOCKED"
  | "FIRECRAWL_EMPTY_RESULT"
  | "FIRECRAWL_INVALID_URL"
  | "FIRECRAWL_UNKNOWN";

export class FirecrawlIntegrationError extends Error {
  constructor(
    public readonly code: FirecrawlErrorCode,
    public readonly retryable = false,
  ) {
    super(code);
    this.name = "FirecrawlIntegrationError";
  }
}

export function normalizeFirecrawlError(error: unknown): FirecrawlIntegrationError {
  if (error instanceof FirecrawlIntegrationError) return error;
  const record = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const status = Number(record.status ?? record.statusCode);
  const code = String(record.code ?? "");
  // Inspect messages only for classification. Never log or return provider payloads.
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (status === 401 || status === 402 || message.includes("api key"))
    return new FirecrawlIntegrationError("FIRECRAWL_AUTH_ERROR");
  if (status === 403) return new FirecrawlIntegrationError("FIRECRAWL_BLOCKED");
  if (status === 429) return new FirecrawlIntegrationError("FIRECRAWL_RATE_LIMIT", true);
  if (status === 400 || code === "unsafe_url") return new FirecrawlIntegrationError("FIRECRAWL_INVALID_URL");
  if (message.includes("timeout") || message.includes("timed out") || record.name === "AbortError") {
    return new FirecrawlIntegrationError("FIRECRAWL_TIMEOUT", true);
  }
  const transient =
    status >= 500 || /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED/.test(code) || message.includes("fetch failed");
  return new FirecrawlIntegrationError("FIRECRAWL_UNKNOWN", transient);
}

export async function withFirecrawlRetry<T>(
  operation: () => Promise<T>,
  sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const safe = normalizeFirecrawlError(error);
      if (!safe.retryable || attempt >= 2) throw safe;
      await sleep(500 * 2 ** attempt);
    }
  }
}
