import type { GoalCandidate, GoalLinkResult, GoalLinkRule, NormalizedEvent } from "./types";

export function linkSignalToGoal(
  event: NormalizedEvent,
  rules: GoalLinkRule[],
  goals: GoalCandidate[],
): GoalLinkResult {
  const activeGoalIds = new Set(goals.map((goal) => goal.id));
  const activeRules = rules
    .filter((rule) => rule.isActive && activeGoalIds.has(rule.goalId))
    .sort((a, b) => a.priority - b.priority);

  const projectMatches = activeRules.filter(
    (rule) => rule.sourceProjectKey?.toLocaleLowerCase("en-US") === event.projectKey.toLocaleLowerCase("en-US"),
  );
  const projectResult = uniqueMatch(projectMatches, "project_rule", 0.98);
  if (projectResult) return projectResult;

  const eventLabels = new Set(event.labels.map((label) => label.toLocaleLowerCase("en-US")));
  const labelMatches = activeRules.filter(
    (rule) => rule.sourceLabel && eventLabels.has(rule.sourceLabel.toLocaleLowerCase("en-US")),
  );
  const labelResult = uniqueMatch(labelMatches, "label_rule", 0.9);
  if (labelResult) return labelResult;

  const summary = event.summary.toLocaleLowerCase("en-US");
  const keywordMatches = activeRules.filter(
    (rule) => rule.sourceKeyword && summary.includes(rule.sourceKeyword.toLocaleLowerCase("en-US")),
  );
  const keywordResult = uniqueMatch(keywordMatches, "keyword_rule", 0.72);
  if (keywordResult) return keywordResult;

  return { goalId: null, confidence: 0, reason: "no_match", appliedRuleId: null };
}

function uniqueMatch(
  matches: GoalLinkRule[],
  reason: "project_rule" | "label_rule" | "keyword_rule",
  confidence: number,
): GoalLinkResult | null {
  if (matches.length === 0) return null;
  const highestPriority = matches[0]?.priority;
  const topMatches = matches.filter((rule) => rule.priority === highestPriority);
  const goalIds = new Set(topMatches.map((rule) => rule.goalId));
  if (goalIds.size > 1) {
    return { goalId: null, confidence: 0, reason: "ambiguous", appliedRuleId: null };
  }
  const match = topMatches[0];
  return { goalId: match.goalId, confidence, reason, appliedRuleId: match.id };
}
