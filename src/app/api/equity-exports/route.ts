import { z } from "zod";

import { createExport } from "@/domain/equityLifecycle/service";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";

const bodySchema = z
  .object({ recommendationId: z.uuid(), destination: z.enum(["csv", "json", "manual_legal", "carta", "cake_equity"]) })
  .strict();
export async function POST(request: Request) {
  try {
    const actor = await requireApiActor(request, ["founder_admin"]);
    const input = bodySchema.parse(await readJsonBody(request, 8 * 1024));
    return noStoreJson(await createExport(actor, input.recommendationId, { destination: input.destination }));
  } catch (error) {
    return handleApiError(error);
  }
}
