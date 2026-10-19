import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { sha256Hex } from "./crypto";
import {
  fromDatabaseContribution,
  fromDatabaseDomain,
  fromDatabaseWeight,
  toDatabaseContribution,
  toDatabaseDomain,
  toDatabaseWeight,
} from "./db-tags";
import { linkSignalToGoal } from "./goal-linker";
import { tagSignal } from "./tagging-engine";
import type {
  ContributionType,
  DomainTag,
  GoalCandidate,
  GoalLinkRule,
  IngestionResult,
  NormalizedEvent,
  SourceField,
  TagMappingRule,
  WeightClass,
} from "./types";

interface IngestOptions {
  companyId: string;
  integrationId: string;
  event: NormalizedEvent;
}

export async function ingestNormalizedEvent(
  client: SupabaseClient,
  { companyId, integrationId, event }: IngestOptions,
): Promise<IngestionResult> {
  const fingerprint = signalFingerprint(integrationId, event);
  const [tagRulesResult, goalRulesResult, goalsResult, actorResult] = await Promise.all([
    client
      .from("tag_mapping_rules")
      .select(
        "id, integration_id, source_field, source_value, target_tag_value, contribution_type, normalized_domain_tag, weight_class, priority, is_active",
      )
      .eq("company_id", companyId)
      .eq("integration_id", integrationId)
      .eq("is_active", true),
    client
      .from("goal_link_rules")
      .select(
        "id, integration_id, match_type, match_value, source_project_key, source_label, source_keyword, goal_id, priority, is_active",
      )
      .eq("company_id", companyId)
      .eq("integration_id", integrationId)
      .eq("is_active", true),
    client
      .from("goals")
      .select("id, name")
      .eq("company_id", companyId)
      .in("status", ["active", "draft", "voting", "finalized"]),
    event.actorExternalId
      ? client
          .from("app_users")
          .select("id")
          .eq("company_id", companyId)
          .eq("external_jira_account_id", event.actorExternalId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const queryError = tagRulesResult.error ?? goalRulesResult.error ?? goalsResult.error ?? actorResult.error;
  if (queryError) throw new Error("Signal enrichment data could not be loaded");

  const tagRules = (tagRulesResult.data ?? []).map(mapTagRule);
  const goalRules = (goalRulesResult.data ?? []).map(mapGoalRule);
  const goals = (goalsResult.data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.name),
  })) satisfies GoalCandidate[];
  const tags = tagSignal(event, tagRules);
  const goalLink = linkSignalToGoal(event, goalRules, goals);

  const { data, error } = await client
    .from("signals")
    .insert({
      company_id: companyId,
      integration_id: integrationId,
      source_tool: event.sourceTool,
      external_id: event.externalId,
      external_key: event.externalKey,
      external_url: event.externalUrl,
      event_type: event.eventType,
      actor_app_user_id: actorResult.data?.id ?? null,
      dedupe_hash: fingerprint,
      contrib_tag: toDatabaseContribution(tags.contributionType),
      domain_tag: toDatabaseDomain(tags.domainTag),
      weight_tag: toDatabaseWeight(tags.weightClass),
      applied_rule_ids: tags.appliedRuleIds,
      goal_link_method: goalLink.goalId ? "rule" : "none",
      source_event_id: event.externalId,
      source_event_type: event.eventType,
      source_fingerprint: fingerprint,
      source_url: event.externalUrl,
      actor_user_id: actorResult.data?.id ?? null,
      actor_external_id: event.actorExternalId,
      summary: event.summary,
      occurred_at: event.occurredAt,
      contribution_type: tags.contributionType,
      normalized_domain_tag: tags.domainTag,
      weight_class: tags.weightClass,
      tag_confidence: tags.confidence,
      tag_source: "automated",
      applied_tag_rule_ids: tags.appliedRuleIds,
      goal_id: goalLink.goalId,
      goal_link_confidence: goalLink.confidence,
      goal_link_reason: goalLink.reason,
      goal_link_source: "automated",
      status: goalLink.goalId ? "linked" : "unlinked",
      raw_payload: event.rawPayload,
    })
    .select("id")
    .single();

  if (error?.code === "23505") return { status: "duplicate", signalId: null, fingerprint };
  if (error || !data) throw new Error("Signal could not be persisted");

  const { error: auditError } = await client.from("audit_log").insert({
    company_id: companyId,
    actor_id: null,
    action: "signal.ingested",
    entity_type: "signal",
    entity_id: data.id,
    after: {
      integrationId,
      sourceTool: event.sourceTool,
      appliedTagRuleIds: tags.appliedRuleIds,
      goalLinkReason: goalLink.reason,
    },
  });
  if (auditError) throw new Error("Signal audit record could not be persisted");

  return { status: "created", signalId: String(data.id), fingerprint };
}

export function signalFingerprint(integrationId: string, event: NormalizedEvent) {
  return sha256Hex([integrationId, event.sourceTool, event.externalId, event.eventType, event.occurredAt].join(":"));
}

function mapTagRule(row: Record<string, unknown>): TagMappingRule {
  return {
    id: String(row.id),
    integrationId: String(row.integration_id),
    sourceField: row.source_field as SourceField,
    sourceValue: String(row.source_value),
    contributionType:
      (row.contribution_type as ContributionType | null) ?? fromDatabaseContribution(row.target_tag_value),
    domainTag: (row.normalized_domain_tag as DomainTag | null) ?? fromDatabaseDomain(row.target_tag_value),
    weightClass: (row.weight_class as WeightClass | null) ?? fromDatabaseWeight(row.target_tag_value),
    priority: Number(row.priority),
    isActive: row.is_active === undefined ? true : Boolean(row.is_active),
  };
}

function mapGoalRule(row: Record<string, unknown>): GoalLinkRule {
  let sourceProjectKey = typeof row.source_project_key === "string" ? row.source_project_key : null;
  let sourceLabel = typeof row.source_label === "string" ? row.source_label : null;
  let sourceKeyword = typeof row.source_keyword === "string" ? row.source_keyword : null;
  if (!sourceProjectKey && row.match_type === "project_key") sourceProjectKey = String(row.match_value);
  if (!sourceLabel && row.match_type === "label") sourceLabel = String(row.match_value);
  if (!sourceKeyword && row.match_type === "keyword") sourceKeyword = String(row.match_value);

  return {
    id: String(row.id),
    integrationId: String(row.integration_id),
    sourceProjectKey,
    sourceLabel,
    sourceKeyword,
    goalId: String(row.goal_id),
    priority: Number(row.priority),
    isActive: row.is_active === undefined ? true : Boolean(row.is_active),
  };
}
