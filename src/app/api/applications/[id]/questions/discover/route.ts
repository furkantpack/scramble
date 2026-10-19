import {
  applicationQuestionReadiness,
  discoverAndPersistApplicationQuestions,
} from "@/lib/application-questions/service";
import { requireApiActor } from "@/lib/signal-engine/auth";
import { handleApiError, noStoreJson } from "@/lib/signal-engine/http";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request);
    const { id } = await context.params;
    return noStoreJson({ extraction: await applicationQuestionReadiness(createSupabaseAdminClient(), actor, id) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireApiActor(request, ["founder_admin"]);
    const { id } = await context.params;
    const extraction = await discoverAndPersistApplicationQuestions(actor, id);
    return noStoreJson({ extraction });
  } catch (error) {
    return handleApiError(error);
  }
}
