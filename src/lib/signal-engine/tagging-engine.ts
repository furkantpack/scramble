import type { NormalizedEvent, TaggingResult, TagMappingRule } from "./types";

const DEFAULT_TAGS = {
  contributionType: "TIME",
  domainTag: "OPS",
  weightClass: "SUPPORTING",
} as const;

export function tagSignal(event: NormalizedEvent, rules: TagMappingRule[]): TaggingResult {
  const result: TaggingResult = {
    ...DEFAULT_TAGS,
    confidence: 0.35,
    appliedRuleIds: [],
  };
  const resolved = new Set<"contributionType" | "domainTag" | "weightClass">();
  const activeRules = rules.filter((rule) => rule.isActive).sort((a, b) => a.priority - b.priority);

  for (const rule of activeRules) {
    if (!ruleMatches(event, rule)) continue;
    if (rule.contributionType && !resolved.has("contributionType")) {
      result.contributionType = rule.contributionType;
      resolved.add("contributionType");
    }
    if (rule.domainTag && !resolved.has("domainTag")) {
      result.domainTag = rule.domainTag;
      resolved.add("domainTag");
    }
    if (rule.weightClass && !resolved.has("weightClass")) {
      result.weightClass = rule.weightClass;
      resolved.add("weightClass");
    }
    if (
      rule.contributionType === result.contributionType ||
      rule.domainTag === result.domainTag ||
      rule.weightClass === result.weightClass
    ) {
      result.appliedRuleIds.push(rule.id);
    }
    if (resolved.size === 3) break;
  }

  result.appliedRuleIds = [...new Set(result.appliedRuleIds)];
  result.confidence = Math.min(0.35 + resolved.size * 0.2, 0.95);
  return result;
}

function ruleMatches(event: NormalizedEvent, rule: TagMappingRule) {
  const expected = rule.sourceValue.trim().toLocaleLowerCase("en-US");
  if (!expected) return false;

  if (rule.sourceField === "project_key") return event.projectKey.toLocaleLowerCase("en-US") === expected;
  if (rule.sourceField === "issue_type") return event.issueType.toLocaleLowerCase("en-US") === expected;
  if (rule.sourceField === "status") return event.status.toLocaleLowerCase("en-US") === expected;
  return event.labels.some((label) => label.toLocaleLowerCase("en-US") === expected);
}
