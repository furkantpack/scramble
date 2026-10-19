import { after } from "next/server";

import { normalizeApplicationAgentApiError } from "@/lib/application-agent/http";
import { dispatchApplicationJobs, enqueueFillJob } from "@/lib/application-agent/dispatch-jobs";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request, ["founder_admin"]);
    const { id } = await context.params;
    const run = await enqueueFillJob(actor, id, await readJsonBody(request, 8 * 1024));
    after(async () => { try { await dispatchApplicationJobs(); } catch { /* Cron recovers queued work. */ } });
    return noStoreJson({ run }, { status: 202 });
  } catch (error) {
    return handleApiError(normalizeApplicationAgentApiError(error));
  }
}
