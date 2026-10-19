import { z } from "zod";

import { sliceCalculationService } from "@/domain/sliceCalculation/service";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson } from "@/lib/signal-engine/http";

type Context = { params: Promise<{ signalId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireApiActor(request, ["founder_admin", "team_lead", "contributor"]);
    const signalId = z.uuid().parse((await context.params).signalId);
    return noStoreJson(await sliceCalculationService.calculate(actor, signalId));
  } catch (error) {
    return handleApiError(error);
  }
}
