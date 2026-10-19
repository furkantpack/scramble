import { z } from "zod";

import { sliceCalculationService } from "@/domain/sliceCalculation/service";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson } from "@/lib/signal-engine/http";

type Context = { params: Promise<{ signalId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireApiActor(request);
    const signalId = z.uuid().parse((await context.params).signalId);
    return noStoreJson(await sliceCalculationService.latest(actor, signalId));
  } catch (error) {
    return handleApiError(error);
  }
}
