import { z } from "zod";

import { calibrateCalculation, getCalibration } from "@/domain/equityLifecycle/service";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";

type Context = { params: Promise<{ calculationId: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireApiActor(request);
    return noStoreJson(await getCalibration(actor, z.uuid().parse((await context.params).calculationId)));
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireApiActor(request, ["founder_admin", "team_lead", "contributor"]);
    return noStoreJson(
      await calibrateCalculation(
        actor,
        z.uuid().parse((await context.params).calculationId),
        await readJsonBody(request, 8 * 1024),
      ),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
