import { z } from "zod";

import { getBenchmark } from "@/domain/equityLifecycle/service";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson } from "@/lib/signal-engine/http";

const querySchema = z.object({
  stage: z.string().min(1).max(80),
  sector: z.string().min(1).max(80),
  role: z.string().min(1).max(80),
  share: z.string().regex(/^\d+(\.\d{1,8})?$/),
});
export async function GET(request: Request) {
  try {
    const actor = await requireApiActor(request);
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return noStoreJson(await getBenchmark(actor, query.stage, query.sector, query.role, query.share));
  } catch (error) {
    return handleApiError(error);
  }
}
