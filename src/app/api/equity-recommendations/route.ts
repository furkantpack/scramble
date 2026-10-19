import { generateRecommendations, listRecommendations } from "@/domain/equityLifecycle/service";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";

export async function GET(request: Request) {
  try {
    return noStoreJson(await listRecommendations(await requireApiActor(request)));
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await requireApiActor(request, ["founder_admin"]);
    return noStoreJson(await generateRecommendations(actor, await readJsonBody(request, 8 * 1024)));
  } catch (error) {
    return handleApiError(error);
  }
}
