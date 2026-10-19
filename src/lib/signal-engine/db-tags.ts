import type { ContributionType, DomainTag, WeightClass } from "./types";

export function toDatabaseContribution(value: ContributionType) {
  return { TIME: "CONTRIB-TIME", MONEY: "CONTRIB-CASH", IP: "CONTRIB-IDEA" }[value];
}

export function toDatabaseDomain(value: DomainTag) {
  return {
    ENG: "DOMAIN-ENG",
    DESIGN: "DOMAIN-PRODUCT",
    GROWTH: "DOMAIN-MKT",
    SALES: "DOMAIN-SALES",
    OPS: "DOMAIN-OPS",
    FINANCE: "DOMAIN-LEADERSHIP",
    LEGAL: "DOMAIN-LEADERSHIP",
  }[value];
}

export function toDatabaseWeight(value: WeightClass) {
  return value === "CORE" ? "WEIGHT-CORE" : "WEIGHT-SUPPORTING";
}

export function fromDatabaseContribution(value: unknown): ContributionType | null {
  if (value === "CONTRIB-TIME") return "TIME";
  if (value === "CONTRIB-CASH" || value === "CONTRIB-EXPENSE") return "MONEY";
  if (value === "CONTRIB-IDEA" || value === "CONTRIB-RELATIONSHIP") return "IP";
  return null;
}

export function fromDatabaseDomain(value: unknown): DomainTag | null {
  if (value === "DOMAIN-ENG") return "ENG";
  if (value === "DOMAIN-PRODUCT") return "DESIGN";
  if (value === "DOMAIN-MKT") return "GROWTH";
  if (value === "DOMAIN-SALES") return "SALES";
  if (value === "DOMAIN-OPS" || value === "DOMAIN-CS" || value === "DOMAIN-LEADERSHIP") return "OPS";
  return null;
}

export function fromDatabaseWeight(value: unknown): WeightClass | null {
  if (value === "WEIGHT-CORE") return "CORE";
  if (value === "WEIGHT-SUPPORTING" || value === "WEIGHT-EXPERIMENTAL") return "SUPPORTING";
  return null;
}
