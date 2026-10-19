export const sourceTools = ["jira"] as const;
export type SourceTool = (typeof sourceTools)[number];

export const contributionTypes = ["TIME", "MONEY", "IP"] as const;
export type ContributionType = (typeof contributionTypes)[number];

export const domainTags = ["ENG", "DESIGN", "GROWTH", "SALES", "OPS", "FINANCE", "LEGAL"] as const;
export type DomainTag = (typeof domainTags)[number];

export const weightClasses = ["CORE", "SUPPORTING"] as const;
export type WeightClass = (typeof weightClasses)[number];

export const sourceFields = ["project_key", "label", "issue_type", "status"] as const;
export type SourceField = (typeof sourceFields)[number];

export type SignalStatus = "unlinked" | "linked" | "ignored" | "manual_review";

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface NormalizedEvent {
  sourceTool: SourceTool;
  externalId: string;
  externalKey: string;
  externalUrl: string;
  actorExternalId: string | null;
  summary: string;
  eventType: "created" | "updated";
  occurredAt: string;
  projectKey: string;
  issueType: string;
  status: string;
  labels: string[];
  rawPayload: Record<string, unknown>;
}

export interface TagMappingRule {
  id: string;
  integrationId: string;
  sourceField: SourceField;
  sourceValue: string;
  contributionType: ContributionType | null;
  domainTag: DomainTag | null;
  weightClass: WeightClass | null;
  priority: number;
  isActive: boolean;
}

export interface GoalLinkRule {
  id: string;
  integrationId: string;
  sourceProjectKey: string | null;
  sourceLabel: string | null;
  sourceKeyword: string | null;
  goalId: string;
  priority: number;
  isActive: boolean;
}

export interface GoalCandidate {
  id: string;
  title: string;
}

export interface TaggingResult {
  contributionType: ContributionType;
  domainTag: DomainTag;
  weightClass: WeightClass;
  confidence: number;
  appliedRuleIds: string[];
}

export interface GoalLinkResult {
  goalId: string | null;
  confidence: number;
  reason: "project_rule" | "label_rule" | "keyword_rule" | "ambiguous" | "no_match";
  appliedRuleId: string | null;
}

export interface IngestionResult {
  status: "created" | "duplicate";
  signalId: string | null;
  fingerprint: string;
}
