import { z } from "zod";

import { requireApiActor } from "@/lib/signal-engine/auth";
import { toDatabaseDomain } from "@/lib/signal-engine/db-tags";
import { ApiError, handleApiError, noStoreJson } from "@/lib/signal-engine/http";
import { createSignalEngineAdminClient } from "@/lib/signal-engine/supabase-admin";

const filtersSchema = z.object({
  status: z.enum(["all", "unlinked", "linked", "ignored", "manual_review"]).default("all"),
  domain: z.enum(["all", "ENG", "DESIGN", "GROWTH", "SALES", "OPS", "FINANCE", "LEGAL"]).default("all"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request) {
  try {
    const actor = await requireApiActor(request);
    const url = new URL(request.url);
    const filters = filtersSchema.parse(Object.fromEntries(url.searchParams));
    const client = createSignalEngineAdminClient();
    let query = client
      .from("signals")
      .select(
        "id, source_tool, source_url, summary, occurred_at, contribution_type, domain_tag, normalized_domain_tag, weight_class, tag_confidence, goal_id, goal_link_confidence, goal_link_reason, status, actor_app_user_id",
      )
      .eq("company_id", actor.companyId)
      .order("occurred_at", { ascending: false })
      .limit(filters.limit);
    if (filters.status !== "all") query = query.eq("status", filters.status);
    if (filters.domain !== "all") query = query.eq("domain_tag", toDatabaseDomain(filters.domain));
    const { data, error } = await query;
    if (error) throw new ApiError(500, "Signals could not be loaded", "signals_read_failed");
    return noStoreJson({ signals: data });
  } catch (error) {
    return handleApiError(error);
  }
}
