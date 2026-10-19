import "server-only";
import { createHash } from "node:crypto";

import { analyzePitchDeck } from "@/lib/pitch-deck/analyze";
import { MAX_PDF_BYTES } from "@/lib/pitch-deck/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/database";

import { claimAnalysis, readAnalysisStatus } from "./analysis-repository";
import { analyzeCompany } from "./analyze-company";
import { getKnowledgeGenerationContext } from "./generation-context";

type Job = Database["public"]["Tables"]["source_analysis_jobs"]["Row"];

export async function processSourceAnalysisJobs() {
  const db = createSupabaseAdminClient();
  const { data: jobs, error } = await db.rpc("claim_source_analysis_jobs", { max_jobs: 1 });
  if (error) throw new Error(`Source job claim unavailable: ${error.code}`);
  let completed = 0;
  for (const job of jobs ?? []) {
    try {
      if (job.kind === "company") {
        const status = await readAnalysisStatus(db, { workspaceId: job.workspace_id, companyId: job.company_id });
        if (status.runId !== job.analysis_run_id) throw new Error("ANALYSIS_RUN_SUPERSEDED");
        await analyzeCompany(db, { workspaceId: job.workspace_id, companyId: job.company_id,
          userId: job.requested_by, status });
        const result = await readAnalysisStatus(db, { workspaceId: job.workspace_id, companyId: job.company_id });
        if (result.state !== "ready") throw new Error(result.errorCode ?? "ANALYSIS_FAILED");
      } else {
        await processPitchDeck(job);
        await enqueueUnifiedAnalysisAfterDeck(job);
      }
      await db.from("source_analysis_jobs").update({ status: "completed", lease_until: null,
        updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "running");
      completed++;
    } catch (error) {
      const code = safeSourceError(error);
      const retry = ["GEMINI_RATE_LIMIT", "GEMINI_TIMEOUT", "FIRECRAWL_TIMEOUT", "PREFLIGHT_UNAVAILABLE"]
        .includes(code) && job.attempts < 3;
      const delayMs = Math.min(300_000, 15_000 * 2 ** job.attempts);
      await db.from("source_analysis_jobs").update({ status: retry ? "queued" : "failed",
        lease_until: null, next_attempt_at: new Date(Date.now() + delayMs).toISOString(),
        error_code: code, updated_at: new Date().toISOString() }).eq("id", job.id).eq("status", "running");
      if (job.kind === "pitch_deck" && job.asset_id && !retry)
        await db.from("company_assets").update({ analysis_status: "failed",
          analysis_error: "We couldn't analyze this deck yet. You can retry or continue manually." })
          .eq("id", job.asset_id).eq("workspace_id", job.workspace_id).eq("company_id", job.company_id)
          .neq("analysis_status", "processed");
    }
  }
  return { claimed: jobs?.length ?? 0, completed };
}

async function enqueueUnifiedAnalysisAfterDeck(job: Job) {
  const db = createSupabaseAdminClient();
  const { data: founder } = await db.from("founder_profiles").select("onboarding_completed")
    .eq("workspace_id", job.workspace_id).eq("user_id", job.requested_by).maybeSingle();
  if (!founder?.onboarding_completed) return;
  const { data: active } = await db.from("source_analysis_jobs").select("id")
    .eq("company_id", job.company_id).eq("kind", "company")
    .in("status", ["queued", "running"]).limit(1).maybeSingle();
  if (active) return;
  const context = await getKnowledgeGenerationContext(db, job.requested_by, job.company_id);
  if (!context || context.workspaceId !== job.workspace_id) return;
  const { claimed, status } = await claimAnalysis(db, context, job.requested_by,
    !context.companyUrl, `${context.companyUrl ?? ""}|${job.asset_id ?? ""}`);
  if (!claimed || !status.runId) return;
  const { error } = await db.from("source_analysis_jobs").insert({
    workspace_id: job.workspace_id, company_id: job.company_id,
    requested_by: job.requested_by, kind: "company", analysis_run_id: status.runId,
    idempotency_key: `company:${job.company_id}:${status.runId}`,
  });
  if (error) {
    await db.from("audit_logs").update({ metadata: { ...status, state: "failed", errorCode: "QUEUE_UNAVAILABLE" },
      to_status: "failed" }).eq("id", job.company_id).eq("workspace_id", job.workspace_id)
      .eq("metadata->>runId", status.runId);
    throw new Error("QUEUE_UNAVAILABLE");
  }
}

async function processPitchDeck(job: Job) {
  if (!job.asset_id) throw new Error("ASSET_MISSING");
  const db = createSupabaseAdminClient();
  const { data: owner, error: ownerError } = await db.from("workspace_members").select("id")
    .eq("workspace_id", job.workspace_id).eq("user_id", job.requested_by)
    .eq("role", "owner").maybeSingle();
  if (ownerError || !owner) throw new Error("OWNER_ACCESS_REVOKED");
  const { data: asset } = await db.from("company_assets")
    .select("id,storage_path,mime_type,file_size_bytes,analysis_status")
    .eq("id", job.asset_id).eq("workspace_id", job.workspace_id)
    .eq("company_id", job.company_id).eq("type", "pitch_deck").maybeSingle();
  if (!asset || !asset.storage_path.startsWith(`${job.workspace_id}/${job.company_id}/`) ||
    asset.mime_type !== "application/pdf" || !asset.file_size_bytes || asset.file_size_bytes > MAX_PDF_BYTES)
    throw new Error("INVALID_DECK");
  if (asset.analysis_status === "processed") return;
  await db.from("company_assets").update({ analysis_status: "processing", analysis_error: null })
    .eq("id", asset.id).eq("workspace_id", job.workspace_id).eq("company_id", job.company_id);
  const { data: file, error: downloadError } = await db.storage.from("pitch-decks").download(asset.storage_path);
  if (downloadError || !file) throw new Error("DECK_DOWNLOAD_FAILED");
  if (file.size > MAX_PDF_BYTES) throw new Error("INVALID_DECK");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("INVALID_DECK");
  const fingerprint = createHash("sha256").update(bytes).digest("hex");
  const { data: duplicate } = await db.from("company_assets")
    .select("extracted_text,extracted_json,extracted_pages")
    .eq("workspace_id", job.workspace_id).eq("company_id", job.company_id)
    .eq("type", "pitch_deck").eq("content_sha256", fingerprint)
    .eq("analysis_status", "processed").neq("id", asset.id).limit(1).maybeSingle();
  if (duplicate?.extracted_json && duplicate.extracted_pages) {
    const { error } = await db.from("company_assets").update({ analysis_status: "processed",
      content_sha256: fingerprint, extracted_text: duplicate.extracted_text,
      extracted_json: duplicate.extracted_json, extracted_pages: duplicate.extracted_pages,
      analysis_error: null, processed_at: new Date().toISOString(),
    }).eq("id", asset.id).eq("workspace_id", job.workspace_id).eq("company_id", job.company_id);
    if (error) throw new Error("DECK_SAVE_FAILED");
    return;
  }
  const result = await analyzePitchDeck(bytes);
  const { error } = await db.from("company_assets").update({
    analysis_status: "processed", content_sha256: fingerprint, extracted_text: result.extractedText,
    extracted_json: result.profile, extracted_pages: result.pages,
    analysis_error: null, processed_at: new Date().toISOString(),
  }).eq("id", asset.id).eq("workspace_id", job.workspace_id).eq("company_id", job.company_id);
  if (error) throw new Error("DECK_SAVE_FAILED");
}

function safeSourceError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (typeof code === "string" && /^[A-Z_]{3,40}$/.test(code)) return code;
  const message = error instanceof Error ? error.message : "";
  return /^[A-Z_]{3,40}$/.test(message) ? message : "ANALYSIS_FAILED";
}
