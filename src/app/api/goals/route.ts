import { createGoals, listGoals } from "@/lib/goal-engine/goal-service";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";

export async function GET(request: Request) {
  try {
    return noStoreJson(
      await listGoals(await requireApiActor(request), new URL(request.url).searchParams.get("active") === "true"),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
export async function POST(request: Request) {
  try {
    const actor = await requireApiActor(request, ["founder_admin", "team_lead"]);
    return noStoreJson(await createGoals(actor, await readJsonBody(request)), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
