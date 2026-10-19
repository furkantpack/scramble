import { latestSettlement } from "@/domain/equityLifecycle/service";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson } from "@/lib/signal-engine/http";

export async function GET(request: Request) {
  try {
    return noStoreJson(await latestSettlement(await requireApiActor(request)));
  } catch (error) {
    return handleApiError(error);
  }
}
