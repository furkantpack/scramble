"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import { AlertTriangle, Check, RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  type ConfirmedProfile,
  confirmedProfileSchema,
  PROFILE_FIELDS,
  type ProfileFieldKey,
  type StoredUnifiedAnalysis,
  storedUnifiedAnalysisSchema,
} from "@/lib/knowledge/unified-profile";

const labels: Record<ProfileFieldKey, string> = {
  company_name: "Company name",
  one_liner: "One-liner",
  product_description: "Product description",
  problem: "Problem",
  solution: "Solution",
  industry: "Industry",
  market_category: "Market category",
  target_customers: "Target customers",
  business_model: "Business model",
  pricing: "Pricing",
  market_opportunity: "Market opportunity",
  competitors: "Competitors",
  differentiation: "Differentiation",
  traction: "Traction",
  metrics: "Metrics",
  founders_team: "Founders and team",
  funding_stage: "Funding stage",
  fundraising: "Fundraising",
  geographic_focus: "Geographic focus",
  startup_maturity: "Startup maturity",
  technologies: "Technologies",
  other_relevant_information: "Other relevant information",
};
const groups: { title: string; fields: ProfileFieldKey[] }[] = [
  { title: "Company & product", fields: PROFILE_FIELDS.slice(0, 7) as ProfileFieldKey[] },
  { title: "Market & model", fields: PROFILE_FIELDS.slice(7, 13) as ProfileFieldKey[] },
  { title: "Progress & team", fields: PROFILE_FIELDS.slice(13) as ProfileFieldKey[] },
];
type Fields = ConfirmedProfile["fields"];
const fromAnalysis = (analysis: StoredUnifiedAnalysis): Fields =>
  Object.fromEntries(PROFILE_FIELDS.map((key) => [key, analysis.fields[key].value])) as Fields;

export function UnifiedProfileReview({
  companyId,
  initialAnalysis,
  initialConfirmed,
}: {
  companyId: string;
  initialAnalysis: StoredUnifiedAnalysis | null;
  initialConfirmed: ConfirmedProfile | null;
}) {
  const router = useRouter();
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [confirmed, setConfirmed] = useState(initialConfirmed);
  const [draft, setDraft] = useState<Fields | null>(
    initialAnalysis ? (initialConfirmed?.fields ?? fromAnalysis(initialAnalysis)) : null,
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const analysisRunId = useRef(initialAnalysis?.runId);

  const refresh = useCallback(async () => {
    try {
      const [profileResponse, statusResponse] = await Promise.all([
        fetch(`/api/companies/${companyId}/profile`, { cache: "no-store" }),
        fetch(`/api/companies/${companyId}/analyze`, { cache: "no-store" }),
      ]);
      if (!profileResponse.ok || !statusResponse.ok) throw new Error("Profile status unavailable");
      const profile = await profileResponse.json();
      const nextStatus = await statusResponse.json();
      const parsed = storedUnifiedAnalysisSchema.safeParse(profile.analysis);
      const parsedConfirmed = confirmedProfileSchema.safeParse(profile.confirmed);
      setStatus(nextStatus.state);
      if (parsedConfirmed.success) setConfirmed(parsedConfirmed.data);
      if (parsed.success) {
        if (analysisRunId.current !== parsed.data.runId && !dirty)
          setDraft(parsedConfirmed.success ? parsedConfirmed.data.fields : fromAnalysis(parsed.data));
        analysisRunId.current = parsed.data.runId;
        setAnalysis(parsed.data);
      }
      setError("");
    } catch {
      setError("Analysis status is temporarily unavailable. Saved information is safe.");
    }
  }, [companyId, dirty]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const reanalyze = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/companies/${companyId}/analyze`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Analysis could not start.");
      setStatus(body.state);
      toast.success(body.accepted ? "Analysis started" : "Analysis is already running");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Analysis could not start.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!analysis || !draft) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/companies/${companyId}/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: draft, analysisRunId: analysis.runId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not confirm profile.");
      const parsed = confirmedProfileSchema.parse(body.confirmed);
      setConfirmed(parsed);
      setDirty(false);
      toast.success("Startup profile confirmed");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not confirm profile.");
    } finally {
      setBusy(false);
    }
  };

  const active = status === "scraping" || status === "generating";
  return (
    <section className="rounded-2xl border bg-white shadow-xs" aria-labelledby="unified-profile-heading">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b px-5 py-5 md:px-7">
        <div>
          <h2 id="unified-profile-heading" className="font-semibold text-lg">
            Startup intelligence
          </h2>
          <p className="mt-1 max-w-2xl text-muted-foreground text-sm">
            Website and pitch deck evidence are combined into one proposal. Review every claim before it becomes
            application context.
          </p>
          {confirmed && (
            <p className="mt-2 flex items-center gap-1.5 text-emerald-700 text-xs">
              <Check className="size-3.5" /> A founder-confirmed profile is active.
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => void reanalyze()} disabled={busy || active}>
          <RotateCcw className="size-4" /> {active ? "Analyzing…" : "Reanalyze sources"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-red-700 text-sm md:mx-7">
          {error}
        </p>
      )}
      {!analysis ? (
        <p className="px-5 py-8 text-muted-foreground text-sm md:px-7">
          {active
            ? "Reading your sources and building a unified profile. You can leave this page while analysis continues."
            : "Add a company website or a PDF deck, then analyze to create a reviewable profile."}
        </p>
      ) : (
        <>
          {(analysis.conflicts.length > 0 ||
            analysis.potentiallyOutdated.length > 0 ||
            analysis.missingFields.length > 0) && (
            <div className="grid gap-2 border-b bg-amber-50/40 px-5 py-4 text-xs md:px-7">
              {analysis.conflicts.map((item) => (
                <p key={item.field} className="flex gap-2 text-amber-900">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{" "}
                  <span>
                    <strong>{labels[item.field]} conflict:</strong> {item.reason} Website: {item.websiteValue || "—"};
                    deck: {item.pitchDeckValue || "—"}.
                  </span>
                </p>
              ))}
              {analysis.potentiallyOutdated.map((item) => (
                <p key={item.field} className="text-amber-900">
                  <strong>{labels[item.field]} may be outdated:</strong> {item.reason}
                </p>
              ))}
              {analysis.missingFields.length > 0 && (
                <p className="text-muted-foreground">
                  Missing: {analysis.missingFields.map((key) => labels[key]).join(", ")}
                </p>
              )}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.title} className="border-b px-5 py-5 last:border-0 md:px-7">
              <h3 className="mb-4 font-medium text-sm">{group.title}</h3>
              <div className="grid gap-5 md:grid-cols-2">
                {group.fields.map((key) => {
                  const suggestion = analysis.fields[key];
                  const currentValue = draft?.[key] ?? "";
                  const changed = confirmed && currentValue !== (confirmed.fields[key] ?? "");
                  return (
                    <div key={key} className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <label htmlFor={`unified-${key}`} className="font-medium text-xs">
                          {labels[key]}
                        </label>
                        <span className="text-muted-foreground text-[11px]">
                          {suggestion.value
                            ? `${suggestion.source.replace("_", " ")} · ${Math.round((suggestion.confidence ?? 0) * 100)}% confidence`
                            : "Missing"}
                        </span>
                      </div>
                      <Textarea
                        id={`unified-${key}`}
                        value={currentValue}
                        rows={key === "product_description" || key === "market_opportunity" ? 3 : 2}
                        placeholder="Not verified — add founder information"
                        onChange={(event) => {
                          setDraft((current) =>
                            current ? { ...current, [key]: event.target.value || null } : current,
                          );
                          setDirty(true);
                        }}
                      />
                      {suggestion.evidence.length > 0 && (
                        <p className="text-muted-foreground text-[11px] leading-5">
                          {suggestion.evidence
                            .slice(0, 2)
                            .map(
                              (item) =>
                                `${item.source === "pitch_deck" ? `Deck p.${item.page}` : item.source === "website" ? item.url : "Founder"}: ${item.excerpt}`,
                            )
                            .join(" · ")}
                        </p>
                      )}
                      {confirmed && changed && (
                        <span className="text-orange-700 text-[11px]">Pending founder edit</span>
                      )}
                      {confirmed && suggestion.value && suggestion.value !== currentValue && (
                        <button
                          type="button"
                          className="block text-orange-700 text-[11px] underline"
                          onClick={() => {
                            setDraft((current) => (current ? { ...current, [key]: suggestion.value } : current));
                            setDirty(true);
                          }}
                        >
                          Use new suggestion
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-5 md:px-7">
            <p className="max-w-lg text-muted-foreground text-xs">
              Only confirmation makes these fields the primary context for future applications. Missing fields still
              require clarification.
            </p>
            <Button
              disabled={busy || active || !draft}
              onClick={() => void confirm()}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {busy ? "Saving…" : confirmed ? "Confirm updated profile" : "Confirm startup profile"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
