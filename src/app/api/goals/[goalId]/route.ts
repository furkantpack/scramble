import { z } from "zod";

import { getGoal, mutateGoal } from "@/lib/goal-engine/goal-service";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";

type Context = { params: Promise<{ goalId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireApiActor(request);
    return noStoreJson(await getGoal(actor, z.uuid().parse((await context.params).goalId)));
  } catch (error) {
    return handleApiError(error);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await requireApiActor(request, ["founder_admin", "team_lead"]);
    return noStoreJson(
      await mutateGoal(actor, z.uuid().parse((await context.params).goalId), await readJsonBody(request)),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
