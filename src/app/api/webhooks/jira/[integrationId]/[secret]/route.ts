import { z } from "zod";

import { safeStringEqual, sha256Hex } from "@/lib/signal-engine/crypto";
import { ApiError, handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";
import { ingestNormalizedEvent } from "@/lib/signal-engine/ingestion-service";
import { normalizeJiraWebhook } from "@/lib/signal-engine/jira-client";
import { createSignalEngineAdminClient } from "@/lib/signal-engine/supabase-admin";
import { consumeWebhookRateLimit } from "@/lib/signal-engine/webhook-security";

const allowedEvents = new Set(["jira:issue_created", "jira:issue_updated"]);

export async function POST(request: Request, context: { params: Promise<{ integrationId: string; secret: string }> }) {
  try {
    const { integrationId, secret } = await context.params;
    z.uuid().parse(integrationId);
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(secret)) throw new ApiError(404, "Webhook not found", "webhook_not_found");

    const rate = consumeWebhookRateLimit(integrationId);
    if (!rate.allowed) {
      const response = noStoreJson({ error: "Too many webhook requests", code: "rate_limited" }, { status: 429 });
      response.headers.set("Retry-After", String(rate.retryAfterSeconds));
      return response;
    }

    const client = createSignalEngineAdminClient();
    const { data: integration, error } = await client
      .from("integrations")
      .select("id, company_id, base_url, webhook_secret_hash")
      .eq("id", integrationId)
      .eq("tool", "jira")
      .eq("status", "connected")
      .maybeSingle();
    if (
      error ||
      !integration?.base_url ||
      !integration.webhook_secret_hash ||
      !safeStringEqual(sha256Hex(secret), integration.webhook_secret_hash)
    ) {
      throw new ApiError(404, "Webhook not found", "webhook_not_found");
    }

    const payload = await readJsonBody(request, 256 * 1024);
    const eventName =
      payload && typeof payload === "object" && "webhookEvent" in payload
        ? (payload as { webhookEvent?: unknown }).webhookEvent
        : null;
    if (typeof eventName !== "string" || !allowedEvents.has(eventName)) {
      throw new ApiError(202, "Event ignored", "event_ignored");
    }

    const event = normalizeJiraWebhook(payload, integration.base_url);
    const result = await ingestNormalizedEvent(client, {
      companyId: integration.company_id,
      integrationId: integration.id,
      event,
    });
    return noStoreJson({ accepted: true, duplicate: result.status === "duplicate" }, { status: 202 });
  } catch (error) {
    if (error instanceof ApiError && error.status === 202) {
      return noStoreJson({ accepted: true, ignored: true }, { status: 202 });
    }
    return handleApiError(error);
  }
}
