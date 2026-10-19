import "server-only";
import type { Document, Firecrawl, ScrapeOptions } from "firecrawl";

import { assertSafePublicHttpUrl } from "@/lib/application-agent/url-safety";

import { createFirecrawlClient } from "./client";
import { FirecrawlIntegrationError, normalizeFirecrawlError, withFirecrawlRetry } from "./errors";
import { EXCLUDED_PATHS, normalizePages, PAGE_LIMIT } from "./normalize-pages";
import type { CompanyCrawlResult } from "./types";

export const COMPANY_CRAWL_OPTIONS = {
  limit: PAGE_LIMIT,
  maxDiscoveryDepth: 2,
  allowExternalLinks: false,
  allowSubdomains: false,
  crawlEntireDomain: false,
  ignoreQueryParameters: true,
  deduplicateSimilarURLs: true,
  excludePaths: [`(^|/)(${EXCLUDED_PATHS.join("|")})(/|$)`],
  scrapeOptions: {
    formats: ["markdown" as const],
    onlyMainContent: true,
    excludeTags: ["nav", "footer"],
    timeout: 18_000,
  },
};

type Dependencies = {
  client?: Pick<Firecrawl, "startCrawl" | "getCrawlStatus" | "cancelCrawl"> & {
    scrape: (url: string, options: ScrapeOptions) => Promise<Document>;
  };
  validate?: typeof assertSafePublicHttpUrl;
  onCall?: () => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export async function crawlCompanyWebsite(value: string, deps: Dependencies = {}): Promise<CompanyCrawlResult> {
  const validate = deps.validate ?? assertSafePublicHttpUrl;
  let rootUrl: string;
  try {
    rootUrl = await validate(value, "Company website");
  } catch {
    throw new FirecrawlIntegrationError("FIRECRAWL_INVALID_URL");
  }
  const client = deps.client ?? createFirecrawlClient();
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const call = async <T>(operation: () => Promise<T>, validateTarget = false) =>
    withFirecrawlRetry(async () => {
      if (validateTarget) {
        try {
          await validate(rootUrl, "Company website");
        } catch {
          throw new FirecrawlIntegrationError("FIRECRAWL_INVALID_URL");
        }
      }
      await deps.onCall?.();
      return operation();
    }, sleep);
  let jobId: string | undefined;
  try {
    const job = await call(() => client.startCrawl(rootUrl, COMPANY_CRAWL_OPTIONS), true);
    jobId = job.id;
    const deadline = now() + 60_000;
    while (now() < deadline) {
      const result = await call(() => client.getCrawlStatus(job.id, { autoPaginate: false }));
      if (result.status === "completed") {
        const pages = normalizePages(result.data, rootUrl);
        if (!pages.length) throw new FirecrawlIntegrationError("FIRECRAWL_EMPTY_RESULT");
        return {
          rootUrl,
          pages,
          snapshots: normalizePages(result.data, rootUrl, false),
          provider: "firecrawl",
          fetchedAt: new Date().toISOString(),
          strategy: "crawl",
          creditsUsed: result.creditsUsed,
        };
      }
      if (result.status === "failed" || result.status === "cancelled")
        throw new FirecrawlIntegrationError("FIRECRAWL_UNKNOWN");
      await sleep(2000);
    }
    throw new FirecrawlIntegrationError("FIRECRAWL_TIMEOUT");
  } catch (error) {
    const safe = normalizeFirecrawlError(error);
    if (jobId) {
      try {
        await deps.onCall?.();
        await client.cancelCrawl(jobId);
      } catch {
        /* Best-effort bounded cancellation; never expose errors. */
      }
    }
    // Invalid credentials/targets are not made valid by calling a second endpoint.
    if (["FIRECRAWL_AUTH_ERROR", "FIRECRAWL_INVALID_URL", "FIRECRAWL_BLOCKED"].includes(safe.code)) throw safe;
    const homepage = await call(() => client.scrape(rootUrl, COMPANY_CRAWL_OPTIONS.scrapeOptions), true);
    const pages = normalizePages([homepage], rootUrl);
    if (!pages.length) throw new FirecrawlIntegrationError("FIRECRAWL_EMPTY_RESULT");
    return {
      rootUrl,
      pages,
      snapshots: normalizePages([homepage], rootUrl, false),
      provider: "firecrawl",
      fetchedAt: new Date().toISOString(),
      strategy: "homepage",
    };
  }
}
