import { ServerConfigurationError, verifyApplicationCronRequest } from "@/lib/configuration/server-env";
import { processSourceAnalysisJobs } from "@/lib/knowledge/source-jobs";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  try {
    if (!verifyApplicationCronRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  } catch (error) {
    if (error instanceof ServerConfigurationError)
      return Response.json({ error: "Server configuration error", code: error.code }, { status: 503 });
    throw error;
  }
  try {
    const result = await processSourceAnalysisJobs();
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Source analysis dispatcher unavailable" }, { status: 503 });
  }
}
