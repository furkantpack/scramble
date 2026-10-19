import type { ExportDestination } from "./types";

export interface ExportRecommendation {
  contributorName: string;
  currentAllocation: string | null;
  recommendedMinimum: string;
  recommendedMaximum: string;
  approvedAllocation: string;
  rationale: string;
  vesting: Record<string, unknown>;
  benchmark: Record<string, unknown>;
}

export function buildExportPayload(destination: ExportDestination, recommendation: ExportRecommendation) {
  return {
    schemaVersion: "rising-equity-export-1",
    destination,
    legalEffect: "none",
    generatedAt: new Date().toISOString(),
    recommendation,
  };
}

export function exportCsv(recommendation: ExportRecommendation): string {
  const fields = [
    "contributor",
    "current_allocation",
    "recommended_minimum",
    "recommended_maximum",
    "approved_allocation",
    "rationale",
  ];
  const values = [
    recommendation.contributorName,
    recommendation.currentAllocation ?? "",
    recommendation.recommendedMinimum,
    recommendation.recommendedMaximum,
    recommendation.approvedAllocation,
    recommendation.rationale,
  ];
  const escapeCsv = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return `${fields.join(",")}\n${values.map(escapeCsv).join(",")}\n`;
}
