import { normalizeApplicationAgentApiError } from "@/lib/application-agent/http";
import { jobRunView, latestDispatchJob } from "@/lib/application-agent/dispatch-jobs";
import { getApplicationAgentRun } from "@/lib/application-agent/service";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson } from "@/lib/signal-engine/http";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await context.params;
    const job = await latestDispatchJob(actor, id);
    if (job && ["queued", "claimed", "dispatching", "unknown_dispatch"].includes(job.status))
      return noStoreJson({ run: jobRunView(job) });
    if (job && ["failed", "cancelled"].includes(job.status) && !job.browser_run_id)
      return noStoreJson({ run: jobRunView(job) });
    return noStoreJson({ run: await getApplicationAgentRun(actor, id) });
  } catch (error) {
    return handleApiError(normalizeApplicationAgentApiError(error));
  }
}
