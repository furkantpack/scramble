import "server-only";
import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { crawlCompanyWebsite } from "@/lib/firecrawl/crawl-company";
import { FirecrawlIntegrationError } from "@/lib/firecrawl/errors";
import { GeminiIntegrationError } from "@/lib/gemini/errors";
import { generateCompanyKnowledge } from "@/lib/gemini/generate-knowledge";
import { generateUnifiedProfile } from "@/lib/gemini/generate-unified-profile";
import { loadLatestPitchDeckEvidence } from "@/lib/pitch-deck/load-evidence";
import type { Database, Json } from "@/types/database";

import { incrementFirecrawlUsage, saveScrapeSnapshots, writeAnalysisStatus } from "./analysis-repository";
import type { CompanyAnalysisStatus } from "./analysis-status";
import { getKnowledgeGenerationContext } from "./generation-context";
import { saveGeneratedKnowledge } from "./save-generated-knowledge";
import { confirmedProfileSchema } from "./unified-profile";

// Worker boundary: only IDs + a claimed run. No browser-supplied company facts or scrape data.
export async function analyzeCompany(
  db: SupabaseClient<Database>,
  job: { workspaceId: string; companyId: string; userId: string; status: CompanyAnalysisStatus },
  dependencies = {
    context: getKnowledgeGenerationContext,
    crawl: crawlCompanyWebsite,
    generate: generateCompanyKnowledge,
    save: saveGeneratedKnowledge,
    saveSnapshots: saveScrapeSnapshots,
    writeStatus: writeAnalysisStatus,
    incrementUsage: incrementFirecrawlUsage,
    loadDeck: loadLatestPitchDeckEvidence,
    generateProfile: generateUnifiedProfile,
  },
) {
  let status = job.status;
  try {
    const context = await dependencies.context(db, job.userId, job.companyId);
    if (!context || context.workspaceId !== job.workspaceId) throw new Error("Company access revoked");
    const { data: founder } = await db
      .from("founder_profiles")
      .select("onboarding_completed")
      .eq("workspace_id", context.workspaceId)
      .eq("user_id", job.userId)
      .maybeSingle();
    if (!founder?.onboarding_completed) throw new Error("Onboarding incomplete");
    const website = context.companyUrl;
    let crawl = null;
    let websiteError: unknown = null;
    if (website) {
      try {
        crawl = await dependencies.crawl(website, {
          onCall: () => dependencies.incrementUsage(db, context.workspaceId),
        });
      } catch (error) {
        websiteError = error;
      }
    }
    if (crawl) await dependencies.saveSnapshots(db, context, crawl);
    let deck = null;
    let deckError: unknown = null;
    try {
      deck = await dependencies.loadDeck(db, context.workspaceId, context.companyId);
    } catch (error) {
      deckError = error;
    }
    if (!crawl && !deck) throw websiteError ?? deckError ?? new Error("No analysis source available");
    status = {
      ...status,
      state: "generating",
      pages: crawl?.pages.length ?? 0,
      deckPages: deck?.pages.length ?? 0,
      noWebsite: !website,
    };
    await dependencies.writeStatus(db, context, status);
    const { data: company, error: companyError } = await db
      .from("companies")
      .select("canonical_profile,unified_analysis")
      .eq("id", context.companyId)
      .eq("workspace_id", context.workspaceId)
      .single();
    if (companyError) throw companyError;
    const sourceFingerprint = createHash("sha256").update(JSON.stringify({
      website: crawl?.pages.map((page) => [page.url, page.markdown]) ?? [],
      deck: deck ? [deck.assetId, deck.extractedText] : null,
      founder: context.founderContext, company: context.companyContext,
    })).digest("hex");
    const oldAnalysis = company.unified_analysis;
    const oldFingerprint = oldAnalysis && typeof oldAnalysis === "object" && !Array.isArray(oldAnalysis) &&
      "sourceFingerprint" in oldAnalysis ? oldAnalysis.sourceFingerprint : null;
    if (oldFingerprint === sourceFingerprint) {
      const { count } = await db.from("knowledge_base_entries")
        .select("id", { head: true, count: "exact" })
        .eq("workspace_id", context.workspaceId).eq("company_id", context.companyId);
      if ((count ?? 0) > 0) {
        await dependencies.writeStatus(db, context, { ...status, state: "ready" });
        return;
      }
    }
    const existingConfirmed = confirmedProfileSchema.safeParse(company.canonical_profile);
    const profile = await dependencies.generateProfile({
      companyName: context.companyName,
      websiteUrl: context.companyUrl ?? null,
      companyStage: context.companyContext.stage ?? null,
      companyDescription: context.companyContext.shortDescription ?? null,
      founderName: [context.founderContext.firstName, context.founderContext.lastName].filter(Boolean).join(" "),
      founderLinkedin: context.founderContext.linkedinUrl ?? null,
      founderNeeds: context.founderContext.selectedNeeds ?? [],
      founderContext: context.founderContext.additionalContext ?? null,
      websitePages: crawl?.pages ?? [],
      deck,
      confirmedProfile: existingConfirmed.success ? existingConfirmed.data : null,
    });
    const { error: profileError } = await db
      .from("companies")
      .update({
        unified_analysis: {
          ...profile.result,
          runId: status.runId,
          generatedAt: new Date().toISOString(),
          model: profile.model,
          sourceFingerprint,
          sourceRefs: {
            websiteUrls: crawl?.pages.map((page) => page.url) ?? [],
            pitchDeckAssetId: deck?.assetId ?? null,
          },
        } as Json,
      })
      .eq("id", context.companyId)
      .eq("workspace_id", context.workspaceId);
    if (profileError) throw new Error("Unified analysis could not be saved");
    const generation = await dependencies.generate({
      ...context,
      scrapedSources: crawl?.pages ?? [],
      deckSource: deck ? { assetId: deck.assetId, extractedText: deck.extractedText, pages: deck.pages } : null,
    });
    await dependencies.save(db, context, generation);
    status = { ...status, state: "ready" };
    await dependencies.writeStatus(db, context, status);
  } catch (error) {
    const errorCode =
      error instanceof FirecrawlIntegrationError || error instanceof GeminiIntegrationError
        ? error.code
        : "ANALYSIS_FAILED";
    // Never log provider payloads, user content, or credentials.
    console.error("Company analysis failed", { code: errorCode });
    await dependencies.writeStatus(db, job, { ...status, state: "failed", errorCode });
  }
}
