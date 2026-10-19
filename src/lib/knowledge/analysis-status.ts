export type AnalysisState = "idle" | "scraping" | "generating" | "ready" | "failed";
export type CompanyAnalysisStatus = {
  state: AnalysisState;
  runId?: string;
  startedAt?: string;
  updatedAt?: string;
  errorCode?: string;
  pages?: number;
  deckPages?: number;
  noWebsite?: boolean;
  sourceKey?: string;
};

export const ANALYSIS_LEASE_MS = 10 * 60 * 1000;
export function isAnalysisActive(status: CompanyAnalysisStatus) {
  return (
    (status.state === "scraping" || status.state === "generating") &&
    Date.now() - Date.parse(status.startedAt ?? "") < ANALYSIS_LEASE_MS
  );
}
