import { ServerConfigurationError, verifyApplicationCronRequest } from "@/lib/configuration/server-env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    if (!verifyApplicationCronRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  } catch (error) {
    if (error instanceof ServerConfigurationError)
      return Response.json({ ready: false, error: "Server configuration error", code: error.code }, { status: 503 });
    throw error;
  }
  try {
    const { error } = await createSupabaseAdminClient().from("application_dispatch_jobs")
      .select("id", { head: true }).limit(0);
    const ready = !error && Boolean(process.env.SKYVERN_API_KEY) &&
      process.env.BROWSER_AGENT_PROVIDER === "skyvern";
    return Response.json({ ready }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ready: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
