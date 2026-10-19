import { createVesting, listVesting } from "@/domain/equityLifecycle/service";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";

export async function GET(request: Request) {
  try {
    const actor = await requireApiActor(request);
    const asOf = new URL(request.url).searchParams.get("asOf") ?? undefined;
    return noStoreJson(await listVesting(actor, asOf));
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await requireApiActor(request, ["founder_admin"]);
    return noStoreJson(await createVesting(actor, await readJsonBody(request, 8 * 1024)));
  } catch (error) {
    return handleApiError(error);
  }
}
