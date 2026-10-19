import { z } from "zod";

import { requireApiActor } from "@/lib/signal-engine/auth";
import { ApiError, handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";
import { createSignalEngineAdminClient } from "@/lib/signal-engine/supabase-admin";

const mappingSchema = z.object({ jiraAccountId: z.string().trim().min(2).max(200).nullable() });

export async function PUT(request: Request) {
  try {
    const actor = await requireApiActor(request);
    const input = mappingSchema.parse(await readJsonBody(request));
    const client = createSignalEngineAdminClient();
    const { data, error } = await client
      .from("app_users")
      .update({ external_jira_account_id: input.jiraAccountId })
      .eq("id", actor.appUserId)
      .eq("company_id", actor.companyId)
      .select("id, external_jira_account_id")
      .single();
    if (error) {
      const message =
        error.code === "23505" ? "This Jira account is already linked" : "Jira account could not be linked";
      throw new ApiError(error.code === "23505" ? 409 : 500, message, "jira_profile_write_failed");
    }
    return noStoreJson({ user: data });
  } catch (error) {
    return handleApiError(error);
  }
}
