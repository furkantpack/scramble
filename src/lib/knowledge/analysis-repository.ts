import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CompanyCrawlResult } from "@/lib/firecrawl/types";
import type { Database, Json } from "@/types/database";

import { type CompanyAnalysisStatus, isAnalysisActive } from "./analysis-status";
import { randomUUID } from "node:crypto";

type DB = SupabaseClient<Database>;
type Scope = { workspaceId: string; companyId: string };
const ACTION = "company_analysis_status";

// Existing audit_logs row is the persistent run marker, not a durable job queue.
// Its UUID PK plus compare-and-swap runId prevent simultaneous/repeated paid jobs.
export async function readAnalysisStatus(db: DB, scope: Scope): Promise<CompanyAnalysisStatus> {
  const { data, error } = await db
    .from("audit_logs")
    .select("metadata")
    .eq("id", scope.companyId)
    .eq("workspace_id", scope.workspaceId)
    .eq("action", ACTION)
    .maybeSingle();
  if (error) throw new Error("Analysis status unavailable");
  if (!data) return { state: "idle" };
  const status = data.metadata as CompanyAnalysisStatus;
  if ((status.state === "scraping" || status.state === "generating") && !isAnalysisActive(status)) {
    return { ...status, state: "failed", errorCode: "ANALYSIS_INTERRUPTED" };
  }
  return status;
}

export async function claimAnalysis(db: DB, scope: Scope, userId: string, noWebsite: boolean, sourceKey: string) {
  const previous = await readAnalysisStatus(db, scope);
  if (isAnalysisActive(previous)) return { claimed: false, status: previous };
  if (previous.sourceKey === sourceKey && previous.startedAt && Date.now() - Date.parse(previous.startedAt) < 60_000) {
    return { claimed: false, status: previous };
  }
  const timestamp = new Date().toISOString();
  const status: CompanyAnalysisStatus = {
    state: noWebsite ? "generating" : "scraping",
    runId: randomUUID(),
    startedAt: timestamp,
    updatedAt: timestamp,
    noWebsite,
    sourceKey,
  };
  if (previous.runId) {
    const { data, error } = await db
      .from("audit_logs")
      .update({ metadata: status as Json, to_status: status.state, actor_user_id: userId })
      .eq("id", scope.companyId)
      .eq("workspace_id", scope.workspaceId)
      .eq("action", ACTION)
      .eq("metadata->>runId", previous.runId)
      .select("id");
    if (error) throw new Error("Analysis could not be queued");
    if (!data?.length) return { claimed: false, status: await readAnalysisStatus(db, scope) };
  } else {
    const { error } = await db.from("audit_logs").insert({
      id: scope.companyId,
      workspace_id: scope.workspaceId,
      actor_user_id: userId,
      action: ACTION,
      to_status: status.state,
      metadata: status as Json,
    });
    if (error?.code === "23505") return { claimed: false, status: await readAnalysisStatus(db, scope) };
    if (error) throw new Error("Analysis could not be queued");
  }
  return { claimed: true, status };
}

export async function writeAnalysisStatus(db: DB, scope: Scope, status: CompanyAnalysisStatus) {
  if (!status.runId) throw new Error("Analysis run identifier missing");
  const { data, error } = await db
    .from("audit_logs")
    .update({
      metadata: { ...status, updatedAt: new Date().toISOString() } as Json,
      to_status: status.state,
    })
    .eq("id", scope.companyId)
    .eq("workspace_id", scope.workspaceId)
    .eq("action", ACTION)
    .eq("metadata->>runId", status.runId)
    .select("id");
  if (error || !data?.length) throw new Error("Analysis lease lost");
}

export async function saveScrapeSnapshots(db: DB, scope: Scope, result: CompanyCrawlResult) {
  const { error } = await db.from("scrape_snapshots").insert(
    (result.snapshots ?? result.pages).map((page) => ({
      workspace_id: scope.workspaceId,
      company_id: scope.companyId,
      source_url: page.url,
      raw_markdown: page.markdown,
      fetched_at: result.fetchedAt,
      // Explicit allowlist: never store provider headers/cookies/credentials.
      raw_json: {
        provider: result.provider,
        rootUrl: result.rootUrl,
        title: page.title,
        description: page.description ?? null,
        strategy: result.strategy,
        creditsUsed: result.creditsUsed ?? null,
      },
    })),
  );
  if (error) throw new Error("Website evidence could not be saved");
}

export async function incrementFirecrawlUsage(db: DB, workspaceId: string) {
  const period = `${new Date().toISOString().slice(0, 7)}-01`;
  const { error: initError } = await db
    .from("usage_counters")
    .upsert({ workspace_id: workspaceId }, { onConflict: "workspace_id", ignoreDuplicates: true });
  if (initError) throw new Error("Usage unavailable");
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: row, error } = await db.from("usage_counters").select("*").eq("workspace_id", workspaceId).single();
    if (error) throw new Error("Usage unavailable");
    const newMonth = row.period_start.slice(0, 10) !== period;
    // All providers share a period. Rollover compares every old counter so a concurrent
    // update cannot silently be lost while resetting the previous month.
    const { data: updated, error: updateError } = await db
      .from("usage_counters")
      .update({
        firecrawl_calls_this_month: newMonth ? 1 : row.firecrawl_calls_this_month + 1,
        ...(newMonth
          ? {
              period_start: period,
              llm_input_tokens_this_month: 0,
              llm_output_tokens_this_month: 0,
              browser_agent_runs_this_month: 0,
            }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("firecrawl_calls_this_month", row.firecrawl_calls_this_month)
      .eq("llm_input_tokens_this_month", row.llm_input_tokens_this_month)
      .eq("llm_output_tokens_this_month", row.llm_output_tokens_this_month)
      .eq("browser_agent_runs_this_month", row.browser_agent_runs_this_month)
      .eq("period_start", row.period_start)
      .select("workspace_id");
    if (updateError) throw new Error("Usage could not be recorded");
    if (updated?.length) return;
  }
  throw new Error(`Usage contention for period ${period}`);
}
