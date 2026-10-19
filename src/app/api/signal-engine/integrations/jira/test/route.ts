import { requireApiActor } from "@/lib/signal-engine/auth";
import { decryptCredentials } from "@/lib/signal-engine/crypto";
import { ApiError, handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";
import { JiraRequestError, parseJiraCredentials, testJiraConnection } from "@/lib/signal-engine/jira-client";
import { createSignalEngineAdminClient } from "@/lib/signal-engine/supabase-admin";
import type { JiraCredentials } from "@/lib/signal-engine/types";

export async function POST(request: Request) {
  try {
    const actor = await requireApiActor(request, ["founder_admin", "team_lead"]);
    const textLength = Number(request.headers.get("content-length") ?? 0);
    let credentials: JiraCredentials;
    if (textLength > 0) {
      credentials = parseJiraCredentials(await readJsonBody(request));
    } else {
      const client = createSignalEngineAdminClient();
      const { data, error } = await client
        .from("integrations")
        .select("credentials_encrypted")
        .eq("company_id", actor.companyId)
        .eq("tool", "jira")
        .eq("status", "connected")
        .maybeSingle();
      if (error || !data?.credentials_encrypted)
        throw new ApiError(404, "Jira is not connected", "integration_not_found");
      credentials = decryptCredentials(data.credentials_encrypted);
    }

    const identity = await testJiraConnection(credentials);
    return noStoreJson({ ok: true, identity });
  } catch (error) {
    if (error instanceof JiraRequestError) {
      return handleApiError(new ApiError(error.status >= 500 ? 502 : 400, error.message, "jira_connection_failed"));
    }
    return handleApiError(error);
  }
}
