import { z } from "zod";

import { requireApiActor } from "@/lib/signal-engine/auth";
import { decryptCredentials, encryptCredentials, generateWebhookSecret, sha256Hex } from "@/lib/signal-engine/crypto";
import { getSignalEngineEnv } from "@/lib/signal-engine/env";
import { ApiError, handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";
import { parseJiraCredentials, testJiraConnection } from "@/lib/signal-engine/jira-client";
import { createSignalEngineAdminClient } from "@/lib/signal-engine/supabase-admin";

const settingsSchema = z.object({
  syncFrequency: z.enum(["manual", "hourly", "daily"]),
});

export async function GET(request: Request) {
  try {
    const actor = await requireApiActor(request);
    const client = createSignalEngineAdminClient();
    const { data, error } = await client
      .from("integrations")
      .select(
        "id, tool, display_name, status, base_url, account_label, sync_frequency, last_successful_sync_at, last_error, updated_at",
      )
      .eq("company_id", actor.companyId)
      .eq("tool", "jira")
      .maybeSingle();
    if (error) throw new ApiError(500, "Jira connection could not be loaded", "integration_read_failed");

    return noStoreJson({ integration: data ?? null });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await requireApiActor(request, ["founder_admin", "team_lead"]);
    const credentials = parseJiraCredentials(await readJsonBody(request));
    const identity = await testJiraConnection(credentials);
    const webhookSecret = generateWebhookSecret();
    const client = createSignalEngineAdminClient();
    const { data, error } = await client
      .from("integrations")
      .upsert(
        {
          company_id: actor.companyId,
          tool: "jira",
          display_name: "Jira",
          status: "connected",
          base_url: credentials.baseUrl,
          account_label: credentials.email,
          credentials_encrypted: encryptCredentials(credentials),
          webhook_secret_hash: sha256Hex(webhookSecret),
          last_error: null,
          created_by: actor.appUserId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,tool" },
      )
      .select("id, status, base_url, account_label, sync_frequency, last_successful_sync_at")
      .single();
    if (error || !data) throw new ApiError(500, "Jira connection could not be saved", "integration_write_failed");

    const baseUrl = getSignalEngineEnv().SIGNAL_ENGINE_WEBHOOK_BASE_URL ?? new URL(request.url).origin;
    return noStoreJson(
      {
        integration: data,
        identity,
        webhookUrl: `${baseUrl.replace(/\/$/, "")}/api/webhooks/jira/${data.id}/${webhookSecret}`,
        webhookEvents: ["jira:issue_created", "jira:issue_updated"],
      },
      { status: 201 },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = await requireApiActor(request, ["founder_admin", "team_lead"]);
    const settings = settingsSchema.parse(await readJsonBody(request));
    const client = createSignalEngineAdminClient();
    const { data, error } = await client
      .from("integrations")
      .update({ sync_frequency: settings.syncFrequency, updated_at: new Date().toISOString() })
      .eq("company_id", actor.companyId)
      .eq("tool", "jira")
      .select("id, sync_frequency")
      .maybeSingle();
    if (error || !data) throw new ApiError(404, "Jira is not connected", "integration_not_found");
    return noStoreJson({ integration: data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = await requireApiActor(request, ["founder_admin", "team_lead"]);
    const client = createSignalEngineAdminClient();
    const { data: existing, error: readError } = await client
      .from("integrations")
      .select("id, credentials_encrypted")
      .eq("company_id", actor.companyId)
      .eq("tool", "jira")
      .maybeSingle();
    if (readError || !existing) throw new ApiError(404, "Jira is not connected", "integration_not_found");
    if (existing.credentials_encrypted) decryptCredentials(existing.credentials_encrypted);

    const { error } = await client
      .from("integrations")
      .update({
        status: "not_connected",
        credentials_encrypted: null,
        webhook_secret_hash: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("company_id", actor.companyId);
    if (error) throw new ApiError(500, "Jira could not be disconnected", "integration_write_failed");

    await client.from("audit_log").insert({
      company_id: actor.companyId,
      actor_id: actor.appUserId,
      action: "integration.disconnected",
      entity_type: "integration",
      entity_id: existing.id,
      after: { tool: "jira" },
    });
    return noStoreJson({ disconnected: true });
  } catch (error) {
    return handleApiError(error);
  }
}
