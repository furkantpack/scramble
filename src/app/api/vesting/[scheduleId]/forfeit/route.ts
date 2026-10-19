import { z } from "zod";

import { forfeitVesting } from "@/domain/equityLifecycle/service";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";

type Context = { params: Promise<{ scheduleId: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireApiActor(request, ["founder_admin"]);
    return noStoreJson(
      await forfeitVesting(
        actor,
        z.uuid().parse((await context.params).scheduleId),
        await readJsonBody(request, 8 * 1024),
      ),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
