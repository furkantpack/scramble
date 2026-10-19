import type { SupabaseClient } from "@supabase/supabase-js";

import { analyzeCompany } from "@/lib/knowledge/analyze-company";
import { PROFILE_FIELDS, type UnifiedAnalysis } from "@/lib/knowledge/unified-profile";
import type { PitchDeckProfile } from "@/lib/pitch-deck/schema";
import type { Database } from "@/types/database";

import { FirecrawlIntegrationError } from "../errors";
import assert from "node:assert/strict";
import test from "node:test";

const emptyDeckProfile = {
  company_name: null,
  one_liner: null,
  problem: null,
  solution: null,
  product_description: null,
  industry: null,
  target_customer: null,
  business_model: null,
  business_model_details: null,
  market: { tam: null, sam: null, som: null },
  traction: null,
  metrics: [],
  competitors: [],
  competitive_advantage: null,
  team: [],
  fundraising: { stage: null, raising: null, amount: null, previous_funding: null },
} satisfies PitchDeckProfile;

function fixture(website: string | null, withDeck = false) {
  const sequence: string[] = [];
  const job = {
    workspaceId: "workspace",
    companyId: "company",
    userId: "user",
    status: { state: "scraping" as const, runId: "run" },
  };
  const context = {
    workspaceId: job.workspaceId,
    companyId: job.companyId,
    companyName: "Test",
    companyUrl: website,
    founderContext: {
      firstName: "Test",
      lastName: "Founder",
      linkedinUrl: null,
      selectedNeeds: [],
      additionalContext: null,
    },
    companyContext: { stage: "idea", shortDescription: null },
  };
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => ({ data: { onboarding_completed: true } }),
    single: async () => ({ data: { canonical_profile: null }, error: null }),
    update: () => query,
    // biome-ignore lint/suspicious/noThenProperty: Supabase query builders are intentionally awaitable in this test double.
    then: (resolve: (value: unknown) => void) => resolve({ error: null }),
  };
  const db = { from: () => query } as unknown as SupabaseClient<Database>;
  const profile: UnifiedAnalysis = {
    fields: Object.fromEntries(
      PROFILE_FIELDS.map((key) => [
        key,
        {
          value: null,
          source: "founder",
          confidence: null,
          evidence: [],
        },
      ]),
    ) as unknown as UnifiedAnalysis["fields"],
    conflicts: [],
    missingFields: [...PROFILE_FIELDS],
    potentiallyOutdated: [],
  };
  const dependencies: NonNullable<Parameters<typeof analyzeCompany>[2]> = {
    context: async () => context,
    crawl: async () => {
      sequence.push("crawl");
      return {
        rootUrl: website!,
        pages: [{ url: website!, title: "Home", markdown: "Company facts" }],
        provider: "firecrawl",
        fetchedAt: new Date().toISOString(),
        strategy: "crawl",
      };
    },
    saveSnapshots: async () => {
      sequence.push("snapshots");
    },
    loadDeck: async () => {
      sequence.push("deck");
      return withDeck
        ? {
            assetId: "deck",
            profile: emptyDeckProfile,
            pages: [{ page: 1, text: "Deck facts", tables: [], charts: [], visuals: [] }],
            extractedText: "Deck facts",
          }
        : null;
    },
    generateProfile: async (input) => {
      sequence.push(`profile:${input.websitePages.length}:${input.deck ? 1 : 0}`);
      return { result: profile, model: "test", usage: { promptTokens: null, outputTokens: null, totalTokens: null } };
    },
    generate: async (input) => {
      sequence.push(`knowledge:${input.scrapedSources.length}:${input.deckSource ? 1 : 0}`);
      return {
        result: { companySummary: null, sections: [] },
        model: "test",
        usage: { promptTokens: null, outputTokens: null, totalTokens: null },
      };
    },
    save: async () => {
      sequence.push("saved");
      return [];
    },
    writeStatus: async (_db, _scope, status) => {
      sequence.push(`state:${status.state}`);
    },
    incrementUsage: async () => {
      /* Provider calls are mocked in this test. */
    },
  };
  return { db, job, dependencies, sequence };
}

test("website evidence is saved before unified synthesis and Knowledge generation", async () => {
  const f = fixture("https://example.com");
  await analyzeCompany(f.db, f.job, f.dependencies);
  assert.deepEqual(f.sequence, [
    "crawl",
    "snapshots",
    "deck",
    "state:generating",
    "profile:1:0",
    "knowledge:1:0",
    "saved",
    "state:ready",
  ]);
});
test("deck-only analysis never calls Firecrawl", async () => {
  const f = fixture(null, true);
  await analyzeCompany(f.db, f.job, f.dependencies);
  assert.deepEqual(f.sequence, ["deck", "state:generating", "profile:0:1", "knowledge:0:1", "saved", "state:ready"]);
});
test("both sources contribute to the same synthesis", async () => {
  const f = fixture("https://example.com", true);
  await analyzeCompany(f.db, f.job, f.dependencies);
  assert.ok(f.sequence.includes("profile:1:1"));
  assert.ok(f.sequence.includes("knowledge:1:1"));
});
test("no website and no deck fails safely without inventing Knowledge", async () => {
  const f = fixture(null);
  await analyzeCompany(f.db, f.job, f.dependencies);
  assert.deepEqual(f.sequence, ["deck", "state:failed"]);
});
test("website failure falls back to available deck", async () => {
  const f = fixture("https://example.com", true);
  f.dependencies.crawl = async () => {
    throw new FirecrawlIntegrationError("FIRECRAWL_TIMEOUT");
  };
  await analyzeCompany(f.db, f.job, f.dependencies);
  assert.ok(f.sequence.includes("profile:0:1"));
  assert.equal(f.sequence.at(-1), "state:ready");
});
test("website failure without deck records failure", async () => {
  const f = fixture("https://example.com");
  f.dependencies.crawl = async () => {
    throw new FirecrawlIntegrationError("FIRECRAWL_TIMEOUT");
  };
  await analyzeCompany(f.db, f.job, f.dependencies);
  assert.deepEqual(f.sequence, ["deck", "state:failed"]);
});
test("snapshot persistence failure prevents Gemini from using unpersisted evidence", async () => {
  const f = fixture("https://example.com");
  f.dependencies.saveSnapshots = async () => {
    throw new Error("db");
  };
  await analyzeCompany(f.db, f.job, f.dependencies);
  assert.deepEqual(f.sequence, ["crawl", "state:failed"]);
});
test("revoked membership never reaches either source", async () => {
  const f = fixture("https://example.com");
  f.dependencies.context = async () => null;
  await analyzeCompany(f.db, f.job, f.dependencies);
  assert.deepEqual(f.sequence, ["state:failed"]);
});
