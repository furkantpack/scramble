"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter, useSearchParams } from "next/navigation";

import { Check, Circle, Loader2, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { CompanyAnalysisStatus } from "@/lib/knowledge/analysis-status";

export function useCompanyAnalysis(companyId: string) {
  const router = useRouter();
  const search = useSearchParams();
  const [status, setStatus] = useState<CompanyAnalysisStatus>({ state: "idle" });
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(
    search.get("analysis") === "start_failed"
      ? "Your onboarding is saved. Start company analysis when you're ready."
      : null,
  );
  const lastRun = useRef<string | undefined>(undefined);
  const apply = useCallback(
    (next: CompanyAnalysisStatus) => {
      if (next.state === "ready" && next.runId && next.runId !== lastRun.current) {
        lastRun.current = next.runId;
        router.refresh();
      }
      if (next.state === "ready" || next.state === "scraping" || next.state === "generating") setError(null);
      setStatus(next);
    },
    [router],
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/companies/${companyId}/analyze`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("status");
        const next = (await response.json()) as CompanyAnalysisStatus;
        if (!controller.signal.aborted) apply(next);
      } catch {
        if (!controller.signal.aborted)
          setError("Analysis status is temporarily unavailable. Your saved information is safe.");
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [companyId, apply]);

  const start = async () => {
    setRequesting(true);
    setError(null);
    try {
      const response = await fetch(`/api/companies/${companyId}/analyze`, {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error("start");
      const next = (await response.json()) as CompanyAnalysisStatus & { accepted: boolean };
      apply(next);
      if (!next.accepted && next.state === "failed") setError("Please wait a minute before trying again.");
    } catch {
      setError("Analysis could not start. Your onboarding information has been saved. Please try again.");
    } finally {
      setRequesting(false);
    }
  };
  const busy = requesting || status.state === "scraping" || status.state === "generating";
  return { status, error, busy, start };
}

export function CompanyAnalysisPanel({ analysis }: { analysis: ReturnType<typeof useCompanyAnalysis> }) {
  const { status, busy, error, start } = analysis;
  if (status.state === "ready" && !error)
    return (
      <p className="flex items-center gap-2 text-muted-foreground text-xs">
        <Check className="size-3.5" />
        {`Company analysis complete · ${status.pages ?? 0} website pages · ${status.deckPages ?? 0} deck pages`}
        <span>Review and approve information before application use.</span>
      </p>
    );
  const failed = status.state === "failed";
  const generating = status.state === "generating";
  return (
    <section aria-live="polite" className="rounded-xl border bg-card px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-sm">
            {busy
              ? "Building your company knowledge"
              : failed
                ? "We couldn't complete your company analysis yet"
                : "Build your company knowledge"}
          </h2>
          <p className="mt-1 text-muted-foreground text-xs">
            {error ||
              (failed
                ? "Your onboarding and existing Knowledge Base are saved. You can edit information manually or retry analysis."
                : busy
                  ? "You can leave this page. Your analysis will continue in the background."
                  : "Analyze your website and pitch deck together. Approved information will not be overwritten.")}
          </p>
        </div>
        {!busy && (
          <Button variant="outline" size="sm" onClick={start}>
            <RotateCcw className="size-3.5" />
            {failed ? "Retry company analysis" : "Analyze company"}
          </Button>
        )}
      </div>
      {busy && (
        <ol className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
          {[
            { text: "Company saved", done: true, active: false },
            {
              text: status.noWebsite ? "No website provided" : "Reading your website",
              done: generating,
              active: status.state === "scraping",
            },
            { text: "Reading deck and synthesizing company profile", done: false, active: generating },
            { text: "Building Knowledge Base", done: false, active: false },
          ].map((step) => (
            <li key={step.text} className="flex items-center gap-2 text-muted-foreground">
              {step.done ? (
                <Check className="size-3.5 text-emerald-600" />
              ) : step.active ? (
                <Loader2 className="size-3.5 animate-spin text-orange-600" />
              ) : (
                <Circle className="size-3" />
              )}
              {step.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
