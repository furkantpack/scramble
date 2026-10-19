import { requireApiActor } from "@/lib/signal-engine/auth";
import { ApiError, handleApiError, noStoreJson } from "@/lib/signal-engine/http";
import { createSignalEngineAdminClient } from "@/lib/signal-engine/supabase-admin";
import { syncJiraIntegration } from "@/lib/signal-engine/sync-service";

export async function POST(request: Request) {
  try {
    const actor = await requireApiActor(request, ["founder_admin", "team_lead"]);
    const client = createSignalEngineAdminClient();
    const { data, error } = await client
      .from("integrations")
      .select("id, company_id, credentials_encrypted, last_successful_sync_at")
      .eq("company_id", actor.companyId)
      .eq("tool", "jira")
      .eq("status", "connected")
      .maybeSingle();
    if (error || !data?.credentials_encrypted)
      throw new ApiError(404, "Jira is not connected", "integration_not_found");

    const result = await syncJiraIntegration(
      client,
      {
        id: data.id,
        company_id: data.company_id,
        credentials_encrypted: data.credentials_encrypted,
        last_successful_sync_at: data.last_successful_sync_at,
      },
      "manual_resync",
    );
    return noStoreJson({ sync: result });
  } catch (error) {
    return handleApiError(error);
  }
}
