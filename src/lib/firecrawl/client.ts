import "server-only";
import { Firecrawl } from "firecrawl";

import { FirecrawlIntegrationError } from "./errors";

export function createFirecrawlClient() {
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim();
  if (!apiKey) throw new FirecrawlIntegrationError("FIRECRAWL_AUTH_ERROR");
  return new Firecrawl({
    apiKey,
    apiUrl: process.env.FIRECRAWL_BASE_URL || "https://api.firecrawl.dev",
    timeoutMs: 20_000,
    // SDK 4.41 counts total transport attempts, despite this option's name.
    // Zero makes no HTTP request. One disables internal retries; our service owns them.
    maxRetries: 1,
  });
}
