import { safeStringEqual } from "@/lib/signal-engine/crypto";
import { getSignalEngineEnv } from "@/lib/signal-engine/env";
import { ApiError, handleApiError, noStoreJson } from "@/lib/signal-engine/http";
import { createSignalEngineAdminClient } from "@/lib/signal-engine/supabase-admin";
import { syncJiraIntegration } from "@/lib/signal-engine/sync-service";

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${getSignalEngineEnv().SIGNAL_ENGINE_CRON_SECRET}`;
    if (!safeStringEqual(authorization, expected)) throw new ApiError(401, "Unauthorized", "unauthorized");

    const client = createSignalEngineAdminClient();
    const { data, error } = await client
      .from("integrations")
      .select("id, company_id, credentials_encrypted, last_successful_sync_at, sync_frequency")
      .eq("tool", "jira")
      .eq("status", "connected")
      .not("credentials_encrypted", "is", null)
      .limit(25);
    if (error) throw new ApiError(500, "Scheduled sync could not be prepared", "sync_read_failed");

    const now = Date.now();
    const due = (data ?? []).filter((row) => {
      if (row.sync_frequency === "manual") return false;
      const elapsed = now - new Date(row.last_successful_sync_at ?? 0).getTime();
      return elapsed >= (row.sync_frequency === "daily" ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000);
    });
    let succeeded = 0;
    let failed = 0;
    for (const integration of due) {
      try {
        await syncJiraIntegration(client, {
          id: integration.id,
          company_id: integration.company_id,
          credentials_encrypted: integration.credentials_encrypted,
          last_successful_sync_at: integration.last_successful_sync_at,
        });
        succeeded += 1;
      } catch {
        failed += 1;
      }
    }
    return noStoreJson({ processed: due.length, succeeded, failed });
  } catch (error) {
    return handleApiError(error);
  }
}
