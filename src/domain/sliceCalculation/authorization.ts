import { CalculationInvariantError } from "./errors";

export interface OverrideActor {
  id: string;
  role: "founder_admin" | "team_lead" | "contributor" | "viewer_investor";
  companyId: string;
}

export interface OverrideTarget {
  companyId: string;
  team: string | null;
  domain: string;
}

export interface OverrideScope {
  type: "TEAM" | "DOMAIN";
  value: string;
}

export function authorizeOverride(actor: OverrideActor, target: OverrideTarget, scopes: OverrideScope[]) {
  if (actor.companyId !== target.companyId) throw new CalculationInvariantError("Cross-company override denied.");
  if (actor.role === "founder_admin") {
    return { actorRole: "Founder/Admin" as const, scopeType: "COMPANY" as const, scopeId: null };
  }
  if (actor.role !== "team_lead") throw new CalculationInvariantError("Contributor override denied.");
  const scope = scopes.find(
    (item) =>
      (item.type === "TEAM" && item.value === target.team) || (item.type === "DOMAIN" && item.value === target.domain),
  );
  if (!scope) throw new CalculationInvariantError("Override target is outside the actor scope.");
  return { actorRole: "Team Lead" as const, scopeType: scope.type, scopeId: scope.value };
}
