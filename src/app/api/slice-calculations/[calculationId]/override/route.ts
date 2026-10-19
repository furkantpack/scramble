import { z } from "zod";

import { sliceCalculationService } from "@/domain/sliceCalculation/service";
import { overrideSchema } from "@/domain/sliceCalculation/validation";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";

type Context = { params: Promise<{ calculationId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const actor = await requireApiActor(request, ["founder_admin", "team_lead"]);
    const calculationId = z.uuid().parse((await context.params).calculationId);
    const input = overrideSchema.parse(await readJsonBody(request, 8 * 1024));
    return noStoreJson(
      await sliceCalculationService.override(actor, calculationId, String(input.newUnits), input.reason),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
