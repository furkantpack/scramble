import { z } from "zod";

import { requireApiActor } from "@/lib/signal-engine/auth";
import { toDatabaseContribution, toDatabaseDomain, toDatabaseWeight } from "@/lib/signal-engine/db-tags";
import { ApiError, handleApiError, noStoreJson, readJsonBody } from "@/lib/signal-engine/http";
import { createSignalEngineAdminClient } from "@/lib/signal-engine/supabase-admin";

const tagRuleSchema = z
  .object({
    id: z.uuid().optional(),
    sourceField: z.enum(["project_key", "label", "issue_type", "status"]),
    sourceValue: z.string().trim().min(1).max(200),
    contributionType: z.enum(["TIME", "MONEY", "IP"]).nullable().default(null),
    domainTag: z.enum(["ENG", "DESIGN", "GROWTH", "SALES", "OPS", "FINANCE", "LEGAL"]).nullable().default(null),
    weightClass: z.enum(["CORE", "SUPPORTING"]).nullable().default(null),
    priority: z.number().int().min(0).max(10_000).default(100),
    isActive: z.boolean().default(true),
  })
  .refine((rule) => rule.contributionType || rule.domainTag || rule.weightClass, {
    message: "Each rule must set at least one Rising tag",
  });

const goalRuleSchema = z
  .object({
    id: z.uuid().optional(),
    sourceProjectKey: z.string().trim().min(1).max(100).nullable().default(null),
    sourceLabel: z.string().trim().min(1).max(200).nullable().default(null),
    sourceKeyword: z.string().trim().min(2).max(200).nullable().default(null),
    goalId: z.uuid(),
    priority: z.number().int().min(0).max(10_000).default(100),
    isActive: z.boolean().default(true),
  })
  .refine((rule) => [rule.sourceProjectKey, rule.sourceLabel, rule.sourceKeyword].filter(Boolean).length === 1, {
    message: "A goal rule must use exactly one source matcher",
  });

const rulesSchema = z.object({
  tagRules: z.array(tagRuleSchema).max(100),
  goalRules: z.array(goalRuleSchema).max(100),
});

export async function GET(request: Request) {
  try {
    const actor = await requireApiActor(request);
    const client = createSignalEngineAdminClient();
    const { data: integration, error: integrationError } = await client
      .from("integrations")
      .select("id")
      .eq("company_id", actor.companyId)
      .eq("tool", "jira")
      .maybeSingle();
    if (integrationError || !integration) throw new ApiError(404, "Jira is not connected", "integration_not_found");

    const [tagRules, goalRules, goals] = await Promise.all([
      client
        .from("tag_mapping_rules")
        .select("*")
        .eq("company_id", actor.companyId)
        .eq("integration_id", integration.id)
        .order("priority", { ascending: false }),
      client
        .from("goal_link_rules")
        .select("*")
        .eq("company_id", actor.companyId)
        .eq("integration_id", integration.id)
        .order("priority", { ascending: false }),
      client.from("goals").select("id, name, status").eq("company_id", actor.companyId).order("name"),
    ]);
    if (tagRules.error || goalRules.error || goals.error) {
      throw new ApiError(500, "Jira mappings could not be loaded", "rules_read_failed");
    }
    return noStoreJson({ tagRules: tagRules.data, goalRules: goalRules.data, goals: goals.data });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const actor = await requireApiActor(request, ["founder_admin", "team_lead"]);
    const input = rulesSchema.parse(await readJsonBody(request, 128 * 1024));
    const client = createSignalEngineAdminClient();
    const { data: integration, error: integrationError } = await client
      .from("integrations")
      .select("id")
      .eq("company_id", actor.companyId)
      .eq("tool", "jira")
      .maybeSingle();
    if (integrationError || !integration) throw new ApiError(404, "Jira is not connected", "integration_not_found");

    const tagRows = input.tagRules.map((rule) => {
      let legacyTag = ["WEIGHT", toDatabaseWeight(rule.weightClass ?? "SUPPORTING")];
      if (rule.contributionType) legacyTag = ["CONTRIB", toDatabaseContribution(rule.contributionType)];
      else if (rule.domainTag) legacyTag = ["DOMAIN", toDatabaseDomain(rule.domainTag)];
      return {
        ...(rule.id ? { id: rule.id } : {}),
        company_id: actor.companyId,
        integration_id: integration.id,
        source_field: rule.sourceField,
        source_value: rule.sourceValue,
        target_tag_type: legacyTag[0],
        target_tag_value: legacyTag[1],
        contribution_type: rule.contributionType,
        normalized_domain_tag: rule.domainTag,
        weight_class: rule.weightClass,
        priority: rule.priority,
        is_active: rule.isActive,
        created_by: actor.appUserId,
        updated_at: new Date().toISOString(),
      };
    });
    const goalRows = input.goalRules.map((rule) => {
      let matchType = "keyword";
      if (rule.sourceProjectKey) matchType = "project_key";
      else if (rule.sourceLabel) matchType = "label";
      const matchValue = rule.sourceProjectKey ?? rule.sourceLabel ?? rule.sourceKeyword;
      return {
        ...(rule.id ? { id: rule.id } : {}),
        company_id: actor.companyId,
        integration_id: integration.id,
        match_type: matchType,
        match_value: matchValue,
        source_project_key: rule.sourceProjectKey,
        source_label: rule.sourceLabel,
        source_keyword: rule.sourceKeyword,
        goal_id: rule.goalId,
        priority: rule.priority,
        is_active: rule.isActive,
        created_by: actor.appUserId,
        updated_at: new Date().toISOString(),
      };
    });

    const [tagWrite, goalWrite] = await Promise.all([
      tagRows.length
        ? client.from("tag_mapping_rules").upsert(tagRows, {
            onConflict: "company_id,integration_id,source_field,source_value,target_tag_type",
          })
        : Promise.resolve({ error: null }),
      goalRows.length ? client.from("goal_link_rules").upsert(goalRows) : Promise.resolve({ error: null }),
    ]);
    if (tagWrite.error || goalWrite.error) {
      throw new ApiError(409, "One or more mapping rules conflict with an existing rule", "rules_write_failed");
    }
    await client.from("audit_log").insert({
      company_id: actor.companyId,
      actor_id: actor.appUserId,
      action: "integration.rules_updated",
      entity_type: "integration",
      entity_id: integration.id,
      after: { tagRuleCount: tagRows.length, goalRuleCount: goalRows.length },
    });
    return noStoreJson({ saved: true, tagRuleCount: tagRows.length, goalRuleCount: goalRows.length });
  } catch (error) {
    return handleApiError(error);
  }
}
