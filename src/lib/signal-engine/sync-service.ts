import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { decryptCredentials } from "./crypto";
import { ingestNormalizedEvent } from "./ingestion-service";
import { fetchUpdatedIssuesSince } from "./jira-client";

interface IntegrationRow {
  id: string;
  company_id: string;
  credentials_encrypted: string;
  last_successful_sync_at: string | null;
}

export async function syncJiraIntegration(
  client: SupabaseClient,
  integration: IntegrationRow,
  triggerType: "scheduled" | "manual_resync" = "scheduled",
) {
  const startedAt = new Date().toISOString();
  const { data: syncLog, error: syncLogError } = await client
    .from("sync_logs")
    .insert({
      company_id: integration.company_id,
      integration_id: integration.id,
      trigger_type: triggerType,
      status: "running",
      started_at: startedAt,
    })
    .select("id")
    .single();
  if (syncLogError || !syncLog) throw new Error("Sync audit could not be started");

  try {
    const credentials = decryptCredentials(integration.credentials_encrypted);
    const fallback = Date.now() - 24 * 60 * 60 * 1000;
    const since = new Date(integration.last_successful_sync_at ?? fallback);
    const events = await fetchUpdatedIssuesSince(credentials, since, { maxIssues: 500 });
    let created = 0;
    let duplicates = 0;

    for (const event of events) {
      const result = await ingestNormalizedEvent(client, {
        companyId: integration.company_id,
        integrationId: integration.id,
        event,
      });
      if (result.status === "created") created += 1;
      else duplicates += 1;
    }

    const finishedAt = new Date().toISOString();
    const { error: integrationError } = await client
      .from("integrations")
      .update({ status: "connected", last_sync_at: finishedAt, last_successful_sync_at: finishedAt, last_error: null })
      .eq("id", integration.id)
      .eq("company_id", integration.company_id);
    const { error: logError } = await client
      .from("sync_logs")
      .update({
        status: "success",
        finished_at: finishedAt,
        completed_at: finishedAt,
        signals_ingested_count: created,
        signals_failed_count: 0,
        fetched_count: events.length,
        created_count: created,
        duplicate_count: duplicates,
      })
      .eq("id", syncLog.id);
    if (integrationError || logError) throw new Error("Sync completion could not be recorded");

    return { fetched: events.length, created, duplicates, completedAt: finishedAt };
  } catch (error) {
    const message = safeOperationalError(error);
    const finishedAt = new Date().toISOString();
    await Promise.all([
      client
        .from("integrations")
        .update({ status: "error", last_error: message })
        .eq("id", integration.id)
        .eq("company_id", integration.company_id),
      client
        .from("sync_logs")
        .update({
          status: "failed",
          finished_at: finishedAt,
          completed_at: finishedAt,
          signals_failed_count: 1,
          error_message: message,
          error_detail: message,
        })
        .eq("id", syncLog.id),
    ]);
    throw new Error(message);
  }
}

function safeOperationalError(error: unknown) {
  const allowed = new Set([
    "Jira rejected the supplied credentials or scope",
    "Jira rate limit reached",
    "Jira request failed",
    "Jira request timed out",
    "Jira could not be reached",
  ]);
  return error instanceof Error && allowed.has(error.message) ? error.message : "Signal sync failed";
}
