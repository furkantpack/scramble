"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";

import { useRouter } from "next/navigation";

import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  FileText,
  FileUp,
  ListChecks,
  Presentation,
  RotateCcw,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { onboardingPrefill, type PitchDeckProfile, pitchDeckProfileSchema } from "@/lib/pitch-deck/schema";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

import { FieldLabel, ScouterLogo } from "../_components/scouter-ui";

const steps = [
  { label: "About you", icon: UserRound },
  { label: "Your company", icon: Building2 },
  { label: "Your pitch deck", icon: Presentation },
  { label: "What you need", icon: ListChecks },
] as const;

const stages: { label: string; value: Database["public"]["Enums"]["company_stage"] }[] = [
  { label: "Idea", value: "idea" },
  { label: "Pre-Seed", value: "pre_seed" },
  { label: "Seed", value: "seed" },
  { label: "Series A", value: "series_a" },
  { label: "Later stage", value: "later_stage" },
  { label: "Not sure", value: "not_sure" },
];
const intentOptions = [
  { value: "fundraising", label: "Fundraising", description: "I am raising now or preparing to raise." },
  {
    value: "investor_introductions",
    label: "Investor introductions",
    description: "I want to meet investors who are genuinely relevant.",
  },
  {
    value: "fundraising_preparation",
    label: "Fundraising preparation",
    description: "I want help getting ready for investor conversations.",
  },
  {
    value: "pitch_deck_feedback",
    label: "Pitch deck feedback",
    description: "I want Scouter to review and challenge my deck.",
  },
  { value: "just_exploring", label: "Just exploring", description: "I am not actively raising yet." },
] as const;

type FounderContext = {
  firstName: string;
  lastName: string;
  linkedin: string;
  companyName: string;
  website: string;
  stage: string;
  description: string;
  deckName: string;
  deckSize: number;
  intents: string[];
  notes: string;
};

const emptyContext: FounderContext = {
  firstName: "",
  lastName: "",
  linkedin: "",
  companyName: "",
  website: "",
  stage: "",
  description: "",
  deckName: "",
  deckSize: 0,
  intents: [],
  notes: "",
};

export default function Page() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState(0);
  const [context, setContext] = useState<FounderContext>(emptyContext);
  const [workspaceId, setWorkspaceId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [deckAssetId, setDeckAssetId] = useState("");
  const [deckProfile, setDeckProfile] = useState<PitchDeckProfile | null>(null);
  const [deckBusy, setDeckBusy] = useState<"uploading" | "analyzing" | "removing" | "">("");
  const [deckProgress, setDeckProgress] = useState(0);
  const [deckError, setDeckError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data: auth } = await supabase.auth.getUser();
        if (!auth.user) return router.replace("/scouter-founder/login");
        const { data: member, error: memberError } = await supabase
          .from("workspace_members")
          .select("workspace_id")
          .eq("user_id", auth.user.id)
          .limit(1)
          .maybeSingle();
        if (memberError || !member) throw new Error("Workspace could not be loaded.");
        const [{ data: profile }, { data: company }, { data: needs }] = await Promise.all([
          supabase
            .from("founder_profiles")
            .select("*")
            .eq("workspace_id", member.workspace_id)
            .eq("user_id", auth.user.id)
            .maybeSingle(),
          supabase.from("companies").select("*").eq("workspace_id", member.workspace_id).limit(1).maybeSingle(),
          supabase.from("founder_needs").select("need").eq("workspace_id", member.workspace_id),
        ]);
        if (!active) return;
        if (profile?.onboarding_completed) return router.replace("/dashboard");
        const { data: savedDeck } = company
          ? await supabase
              .from("company_assets")
              .select("id,file_name,file_size_bytes,analysis_status,extracted_json")
              .eq("workspace_id", member.workspace_id)
              .eq("company_id", company.id)
              .eq("type", "pitch_deck")
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
          : { data: null };
        let savedProfile: PitchDeckProfile | null = null;
        if (savedDeck) {
          setDeckAssetId(savedDeck.id);
          const parsed = pitchDeckProfileSchema.safeParse(savedDeck.extracted_json);
          if (parsed.success) {
            savedProfile = parsed.data;
            setDeckProfile(parsed.data);
          }
        }
        setWorkspaceId(member.workspace_id);
        setProfileId(profile?.id ?? "");
        setCompanyId(company?.id ?? "");
        const loadedContext: FounderContext = {
          firstName: profile?.first_name ?? String(auth.user.user_metadata.first_name ?? ""),
          lastName: profile?.last_name ?? String(auth.user.user_metadata.last_name ?? ""),
          linkedin: profile?.linkedin_url ?? "",
          companyName: company?.name ?? "",
          website: company?.website_url ?? "",
          stage: company?.stage ?? "",
          description: company?.short_description ?? "",
          deckName: savedDeck?.file_name ?? "",
          deckSize: savedDeck?.file_size_bytes ?? 0,
          intents: (needs ?? []).map((item) => item.need),
          notes: profile?.anything_else_scouter_should_know ?? "",
        };
        setContext(savedProfile ? onboardingPrefill(loadedContext, savedProfile) : loadedContext);
      } catch {
        if (active) setErrorMessage("Your onboarding data could not be loaded. Please refresh and try again.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [router]);

  const canContinue =
    (step === 0 && !!context.firstName.trim() && !!context.lastName.trim()) ||
    (step === 1 && !!context.companyName.trim()) ||
    (step === 2 && !deckBusy) ||
    (step === 3 && context.intents.length > 0);
  let continueLabel = "Continue";
  if (step === 3) continueLabel = saving ? "Saving…" : "Finish onboarding";

  function update(values: Partial<FounderContext>) {
    setContext((current) => ({ ...current, ...values }));
  }

  function moveForward() {
    if (!canContinue || step >= 3) return;
    if (step === 3) window.localStorage.setItem("scouter:founder-context", JSON.stringify(context));
    setStep((current) => current + 1);
  }

  async function handleDeck(event: ChangeEvent<HTMLInputElement>) {
    await analyzeSelectedFile(event.target.files?.[0]);
  }

  async function analyzeSelectedFile(file: File | undefined) {
    if (!file) return;
    if (
      file.type !== "application/pdf" ||
      !file.name.toLowerCase().endsWith(".pdf") ||
      !file.size ||
      file.size > 20 * 1024 * 1024
    ) {
      setDeckError("Choose a PDF file smaller than 20 MB.");
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setDeckError("");
    setDeckProgress(0);
    setDeckBusy("uploading");
    try {
      const supabase = getSupabaseBrowserClient();
      let resolvedCompanyId = companyId;
      if (!resolvedCompanyId) {
        const { data, error } = await supabase
          .from("companies")
          .insert({
            workspace_id: workspaceId,
            name: context.companyName.trim(),
            website_url: context.website.trim() || null,
            stage: (context.stage || "not_sure") as Database["public"]["Enums"]["company_stage"],
            short_description: context.description.trim() || null,
          })
          .select("id")
          .single();
        if (error || !data) throw new Error("Your company details could not be saved before upload.");
        resolvedCompanyId = data.id;
        setCompanyId(data.id);
      }
      const assetId = await uploadDeck(file, setDeckProgress);
      // Previous decks and their extracted evidence remain available for audit.
      // Only the newest asset is used in the next synthesis.
      setDeckAssetId(assetId);
      update({ deckName: file.name, deckSize: file.size });
      setDeckBusy("analyzing");
      await processDeck(assetId);
    } catch (error) {
      setDeckError(error instanceof Error ? error.message : "Deck upload failed. Please try again.");
    } finally {
      setDeckBusy("");
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function processDeck(assetId: string) {
    setDeckError("");
    const response = await fetch(`/api/onboarding/pitch-deck/${assetId}`, { method: "POST" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Deck analysis failed. You can retry or continue manually.");
    let profile = result.profile;
    if (response.status === 202) {
      for (let attempt = 0; attempt < 75; attempt++) {
        await new Promise((resolve) => window.setTimeout(resolve, 2000));
        const statusResponse = await fetch(`/api/onboarding/pitch-deck/${assetId}?status=1`, { cache: "no-store" });
        if (!statusResponse.ok) throw new Error("Deck analysis status is unavailable. Please retry later.");
        const status = await statusResponse.json();
        if (status.status === "failed") throw new Error("Deck analysis could not complete. You can retry or continue manually.");
        if (status.status === "processed") { profile = status.profile; break; }
      }
      if (!profile) throw new Error("Deck analysis is continuing in the background. Return later to review it.");
    }
    const parsed = pitchDeckProfileSchema.safeParse(profile);
    if (!parsed.success) throw new Error("Deck analysis returned incomplete data. Please retry.");
    setDeckProfile(parsed.data);
    setContext((current) => onboardingPrefill(current, parsed.data));
  }

  async function retryDeck() {
    if (!deckAssetId || deckBusy) return;
    setDeckBusy("analyzing");
    try {
      await processDeck(deckAssetId);
    } catch (error) {
      setDeckError(error instanceof Error ? error.message : "Deck analysis failed.");
    } finally {
      setDeckBusy("");
    }
  }

  async function removeDeck() {
    if (!deckAssetId || deckBusy) return;
    setDeckBusy("removing");
    setDeckError("");
    try {
      const response = await fetch(`/api/onboarding/pitch-deck/${deckAssetId}`, { method: "DELETE" });
      if (!response.ok) throw new Error("The deck could not be removed. Please try again.");
      setDeckAssetId("");
      setDeckProfile(null);
      update({ deckName: "", deckSize: 0 });
    } catch (error) {
      setDeckError(error instanceof Error ? error.message : "Could not remove the deck.");
    } finally {
      setDeckBusy("");
    }
  }

  async function finishOnboarding() {
    if (!workspaceId || saving) return;
    setSaving(true);
    setErrorMessage("");
    try {
      const supabase = getSupabaseBrowserClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("expired_session");

      const profilePayload = {
        first_name: context.firstName.trim(),
        last_name: context.lastName.trim(),
        linkedin_url: context.linkedin.trim() || null,
        anything_else_scouter_should_know: context.notes.trim() || null,
      };
      let resolvedProfileId = profileId;
      if (resolvedProfileId) {
        const { error } = await supabase.from("founder_profiles").update(profilePayload).eq("id", resolvedProfileId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("founder_profiles")
          .insert({ ...profilePayload, workspace_id: workspaceId, user_id: auth.user.id, onboarding_completed: false })
          .select("id")
          .single();
        if (error) throw error;
        resolvedProfileId = data.id;
        setProfileId(data.id);
      }

      const companyPayload = {
        name: context.companyName.trim(),
        website_url: context.website.trim() || null,
        stage: (context.stage || "not_sure") as Database["public"]["Enums"]["company_stage"],
        short_description: context.description.trim() || null,
      };
      let resolvedCompanyId = companyId;
      if (resolvedCompanyId) {
        const { error } = await supabase.from("companies").update(companyPayload).eq("id", resolvedCompanyId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("companies")
          .insert({ ...companyPayload, workspace_id: workspaceId })
          .select("id")
          .single();
        if (error) throw error;
        resolvedCompanyId = data.id;
        setCompanyId(data.id);
      }

      const { error: deleteNeedsError } = await supabase
        .from("founder_needs")
        .delete()
        .eq("founder_profile_id", resolvedProfileId);
      if (deleteNeedsError) throw deleteNeedsError;
      const { error: needsError } = await supabase.from("founder_needs").insert(
        context.intents.map((need) => ({
          workspace_id: workspaceId,
          founder_profile_id: resolvedProfileId,
          need: need as Database["public"]["Enums"]["founder_need"],
        })),
      );
      if (needsError) throw needsError;

      const appUserResponse = await fetch("/api/onboarding/app-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: resolvedCompanyId }),
      });
      if (!appUserResponse.ok) throw new Error("app_user_provisioning_failed");

      const { error: completeError } = await supabase.rpc("complete_founder_onboarding", {
        target_workspace_id: workspaceId,
      });
      if (completeError) throw completeError;
      await supabase.from("audit_logs").insert({
        workspace_id: workspaceId,
        actor_user_id: auth.user.id,
        action: "onboarding_completed",
        metadata: {},
      });
      // Completion is committed first. Analysis failure must never undo onboarding.
      if (context.website.trim() || deckAssetId) {
        try {
          await fetch(`/api/companies/${resolvedCompanyId}/analyze`, {
            method: "POST",
            signal: AbortSignal.timeout(15_000),
          });
        } catch {
          /* The profile page exposes a safe retry if the request was interrupted. */
        }
      }
      router.replace("/dashboard");
    } catch (error) {
      setErrorMessage(
        error instanceof Error && error.message === "expired_session"
          ? "Your session expired. Please sign in again."
          : "Onboarding could not be saved. Check your details and try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="grid min-h-dvh place-items-center bg-zinc-50 text-muted-foreground text-sm">
        Loading your workspace…
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-zinc-50">
      <div className="flex min-h-dvh flex-col bg-white">
        <header className="flex items-center justify-between gap-4 border-b px-4 py-3 sm:px-6 lg:px-8">
          <ScouterLogo />
          <div className="flex items-center gap-3">
            <span className="hidden text-muted-foreground text-xs sm:block">Step {step + 1} of 4</span>
            <Badge variant="outline" className="rounded-full">
              {Math.round(((step + 1) / 4) * 100)}%
            </Badge>
          </div>
        </header>

        <div className="border-b bg-zinc-50/80 px-4 py-3 lg:hidden">
          <div className="flex items-center gap-2">
            {steps.map((item, index) => (
              <div key={item.label} className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={cn(
                    "grid size-6 shrink-0 place-items-center rounded-full border bg-white font-medium text-[10px]",
                    index <= step && "border-orange-500 bg-orange-500 text-white",
                  )}
                >
                  {index < step ? <Check className="size-3" /> : index + 1}
                </span>
                {index < steps.length - 1 ? (
                  <span className={cn("h-px min-w-0 flex-1 bg-zinc-200", index < step && "bg-orange-400")} />
                ) : null}
              </div>
            ))}
          </div>
          <p className="mt-2 truncate font-medium text-xs">{steps[step].label}</p>
        </div>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[280px_1fr]">
          <aside className="hidden border-r bg-zinc-50/70 p-6 lg:block xl:p-8">
            <div className="space-y-2">
              {steps.map((item, index) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-3 text-muted-foreground",
                      index === step && "border bg-white text-zinc-950 shadow-xs",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-lg border bg-white",
                        index <= step && "border-orange-200 bg-orange-50 text-orange-700",
                      )}
                    >
                      {index < step ? <Check className="size-4" /> : <Icon className="size-4" />}
                    </span>
                    <span>
                      <span className="block text-[11px]">Step {index + 1}</span>
                      <span className="block font-medium text-sm">{item.label}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </aside>

          <section className="flex items-center justify-center px-4 py-8 sm:px-8 lg:px-12 lg:py-12">
            <div className="w-full max-w-4xl">
              {step === 0 ? <AboutStep value={context} update={update} /> : null}
              {step === 1 ? <CompanyStep value={context} update={update} /> : null}
              {step === 2 ? (
                <DeckStep
                  value={context}
                  inputRef={fileInput}
                  onDeck={handleDeck}
                  onDropFile={analyzeSelectedFile}
                  onRemove={removeDeck}
                  onRetry={retryDeck}
                  assetId={deckAssetId}
                  profile={deckProfile}
                  busy={deckBusy}
                  progress={deckProgress}
                  error={deckError}
                  onApplyDescription={() =>
                    deckProfile &&
                    update({ description: deckProfile.one_liner || deckProfile.product_description || "" })
                  }
                  onDescriptionChange={(description) => update({ description })}
                />
              ) : null}
              {step === 3 ? <IntentStep value={context} update={update} /> : null}
              <div className="mt-9 flex items-center justify-between gap-3 border-t pt-6">
                <Button variant="outline" disabled={step === 0} onClick={() => setStep((current) => current - 1)}>
                  <ArrowLeft /> Back
                </Button>
                <div className="flex items-center gap-2">
                  {step === 2 ? (
                    <Button variant="ghost" disabled={!!deckBusy} onClick={() => setStep(3)}>
                      Skip for now
                    </Button>
                  ) : null}
                  <Button
                    disabled={!canContinue || saving}
                    onClick={step === 3 ? finishOnboarding : moveForward}
                    className="bg-orange-600 hover:bg-orange-700"
                  >
                    {continueLabel} <ArrowRight />
                  </Button>
                </div>
              </div>
              {errorMessage ? (
                <p role="alert" className="mt-4 text-center text-red-600 text-sm">
                  {errorMessage}
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function StepIntro({ title, description }: { title: string; description: string }) {
  return (
    <div className="max-w-2xl">
      <h1 className="font-semibold text-3xl tracking-tight md:text-4xl">{title}</h1>
      <p className="mt-3 text-muted-foreground leading-7">{description}</p>
    </div>
  );
}

function FormField({
  id,
  label,
  placeholder,
  value,
  helper,
  required = true,
  type = "text",
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  helper?: string;
  required?: boolean;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <FieldLabel htmlFor={id}>
        {label} {!required ? <span className="text-muted-foreground">(optional)</span> : null}
      </FieldLabel>
      <Input
        id={id}
        type={type}
        required={required}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 rounded-xl"
      />
      {helper ? <p className="text-muted-foreground text-xs">{helper}</p> : null}
    </div>
  );
}

function AboutStep({ value, update }: { value: FounderContext; update: (values: Partial<FounderContext>) => void }) {
  return (
    <div className="space-y-8">
      <StepIntro
        title="Let's start with you."
        description="Scouter uses this to understand your background and connect the right context to your company."
      />
      <div className="grid items-start gap-x-5 gap-y-2 sm:grid-cols-2">
        <FormField
          id="founder-first-name"
          label="First name"
          placeholder="Furkan"
          value={value.firstName}
          onChange={(firstName) => update({ firstName })}
        />
        <FormField
          id="founder-last-name"
          label="Last name"
          placeholder="Topcuoglu"
          value={value.lastName}
          onChange={(lastName) => update({ lastName })}
        />
        <div className="sm:col-span-2">
          <FormField
            id="founder-linkedin"
            label="LinkedIn profile"
            placeholder="https://linkedin.com/in/..."
            value={value.linkedin}
            helper="This helps Scouter understand your professional background."
            required={false}
            type="url"
            onChange={(linkedin) => update({ linkedin })}
          />
        </div>
      </div>
    </div>
  );
}

function CompanyStep({ value, update }: { value: FounderContext; update: (values: Partial<FounderContext>) => void }) {
  return (
    <div className="space-y-8">
      <StepIntro
        title="What are you building?"
        description="Share the basics. Scouter will research the rest before your conversation."
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          id="scouter-company-name"
          label="Company name"
          placeholder="Scouter"
          value={value.companyName}
          onChange={(companyName) => update({ companyName })}
        />
        <FormField
          id="scouter-company-website"
          label="Company website"
          placeholder="https://scouter.so"
          value={value.website}
          required={false}
          type="url"
          onChange={(website) => update({ website })}
        />
        <p className="text-muted-foreground text-xs sm:col-start-2">No website yet? You can leave this blank.</p>
      </div>
      <div className="space-y-3">
        <span className="inline-flex rounded-full bg-zinc-100 px-2.5 py-1 font-medium text-xs text-zinc-700">
          Company stage <span className="ml-1 text-muted-foreground">(optional)</span>
        </span>
        <div className="flex flex-wrap gap-2">
          {stages.map((stage) => (
            <button
              key={stage.value}
              type="button"
              onClick={() => update({ stage: value.stage === stage.value ? "" : stage.value })}
              className={cn(
                "rounded-full border px-3.5 py-2 font-medium text-sm transition-colors",
                value.stage === stage.value
                  ? "border-orange-300 bg-orange-50 text-orange-700"
                  : "bg-white text-zinc-700 hover:bg-zinc-50",
              )}
            >
              {stage.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2">
        <FieldLabel htmlFor="scouter-company-description">
          One-line company description <span className="text-muted-foreground">(optional)</span>
        </FieldLabel>
        <Textarea
          id="scouter-company-description"
          value={value.description}
          onChange={(event) => update({ description: event.target.value })}
          placeholder="What does your company do, and for whom?"
          maxLength={600}
          className="min-h-24 rounded-xl"
        />
        <p className="text-muted-foreground text-xs">
          A pitch deck can suggest this later. Your own text always takes priority.
        </p>
      </div>
    </div>
  );
}

function DeckStep({
  value,
  inputRef,
  onDeck,
  onDropFile,
  onRemove,
  onRetry,
  assetId,
  profile,
  busy,
  progress,
  error,
  onApplyDescription,
  onDescriptionChange,
}: {
  value: FounderContext;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onDeck: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  onDropFile: (file: File | undefined) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onRetry: () => void | Promise<void>;
  assetId: string;
  profile: PitchDeckProfile | null;
  busy: "uploading" | "analyzing" | "removing" | "";
  progress: number;
  error: string;
  onApplyDescription: () => void;
  onDescriptionChange: (description: string) => void;
}) {
  return (
    <div className="space-y-8">
      <StepIntro
        title="Upload your pitch deck."
        description="Your private PDF can help fill in company details. Review every suggestion before continuing."
      />
      <input ref={inputRef} type="file" accept=".pdf,application/pdf" onChange={onDeck} className="sr-only" />
      {value.deckName ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 sm:p-6">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl border bg-white text-orange-600">
              <FileText className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-medium text-emerald-800 text-sm">
                <CheckCircle2 className="size-4" /> {busy === "uploading" ? "Uploading deck" : "Private deck uploaded"}
              </p>
              <p className="mt-1 truncate font-semibold">{value.deckName}</p>
              <p className="mt-1 text-muted-foreground text-xs">{formatBytes(value.deckSize)}</p>
            </div>
            <div className="flex gap-2">
              {assetId ? (
                <Button asChild variant="outline">
                  <a href={`/api/onboarding/pitch-deck/${assetId}`} target="_blank" rel="noopener noreferrer">
                    View
                  </a>
                </Button>
              ) : null}
              <Button variant="outline" disabled={!!busy} onClick={() => inputRef.current?.click()}>
                <RotateCcw /> Replace
              </Button>
              <Button variant="outline" size="icon" disabled={!!busy} onClick={onRemove} aria-label="Remove pitch deck">
                <X />
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!!busy}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (!busy) void onDropFile(event.dataTransfer.files[0]);
          }}
          className="group grid w-full place-items-center rounded-2xl border border-dashed bg-zinc-50 px-5 py-14 text-center transition-colors hover:border-orange-300 hover:bg-orange-50/40"
        >
          <span className="grid size-12 place-items-center rounded-xl border bg-white text-orange-600 shadow-xs">
            <FileUp className="size-6" />
          </span>
          <span className="mt-4 font-semibold">Drop your PDF here or choose a file</span>
          <span className="mt-1 text-muted-foreground text-sm">PDF only · up to 20 MB</span>
        </button>
      )}
      {busy ? (
        <div className="space-y-2" role="status" aria-live="polite">
          <div className="flex justify-between text-sm">
            <span>
              {
                { uploading: "Uploading your PDF", analyzing: "Analyzing your pitch deck", removing: "Removing deck" }[
                  busy
                ]
              }
            </span>
            <span>{busy === "uploading" ? `${progress}%` : ""}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <div
              className="h-full rounded-full bg-orange-500 transition-all"
              style={{ width: `${busy === "uploading" ? progress : 100}%` }}
            />
          </div>
          <p className="text-muted-foreground text-xs">
            {busy === "analyzing"
              ? "Reading slides, charts and tables. You can still review your company details afterward."
              : "Your onboarding details stay saved."}
          </p>
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-red-700 text-sm"
        >
          <span>{error}</span>
          {value.deckName ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              Retry analysis
            </Button>
          ) : null}
        </div>
      ) : null}
      {profile ? (
        <div className="rounded-2xl border bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold">What we found in your deck</p>
              <p className="mt-1 text-muted-foreground text-sm">
                These are suggestions, not verified facts. Existing answers were not replaced.
              </p>
            </div>
            {(profile.one_liner || profile.product_description) &&
            value.description !== (profile.one_liner || profile.product_description) ? (
              <Button variant="outline" size="sm" onClick={onApplyDescription}>
                Use suggested description
              </Button>
            ) : null}
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <DeckFact label="Company" value={profile.company_name} />
            <DeckFact label="One-liner" value={profile.one_liner} />
            <DeckFact label="Problem" value={profile.problem} />
            <DeckFact label="Solution" value={profile.solution} />
            <DeckFact label="Target customer" value={profile.target_customer} />
            <DeckFact label="Business model" value={profile.business_model} />
            <DeckFact label="Traction" value={profile.traction} />
            <DeckFact label="Fundraising" value={profile.fundraising.amount} />
          </div>
          <div className="mt-5 grid gap-2 border-t pt-4">
            <FieldLabel htmlFor="deck-reviewed-description">Your company description</FieldLabel>
            <Textarea
              id="deck-reviewed-description"
              value={value.description}
              onChange={(event) => onDescriptionChange(event.target.value)}
              maxLength={600}
              rows={3}
              className="rounded-xl"
            />
            <p className="text-muted-foreground text-xs">
              Edit this before continuing. Only this reviewed text is saved to your company profile.
            </p>
          </div>
          <p className="mt-5 border-t pt-4 text-muted-foreground text-xs">
            To edit the company name, stage or description, go back to Your company. Other extracted details stay as
            unapproved deck evidence and are not used as founder-confirmed claims.
          </p>
        </div>
      ) : null}
      <div className="flex items-start gap-3 rounded-xl border bg-zinc-50 p-4 text-muted-foreground text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        Your deck stays private. AI suggestions are not used as confirmed company facts until you review them.
      </div>
    </div>
  );
}

function DeckFact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 border-zinc-100 border-b pb-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 text-sm leading-6">{value ?? "Not found in deck"}</p>
    </div>
  );
}

function uploadDeck(file: File, onProgress: (percentage: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", "/api/onboarding/pitch-deck");
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onerror = () => reject(new Error("Upload interrupted. Please check your connection and retry."));
    request.onload = () => {
      let result: { assetId?: string; error?: string } = {};
      try {
        result = JSON.parse(request.responseText);
      } catch {
        /* Use the generic error below. */
      }
      if (request.status >= 200 && request.status < 300 && result.assetId) resolve(result.assetId);
      else reject(new Error(result.error || "Pitch deck upload failed. Please try again."));
    };
    const form = new FormData();
    form.append("file", file);
    request.send(form);
  });
}

function IntentStep({ value, update }: { value: FounderContext; update: (values: Partial<FounderContext>) => void }) {
  function toggle(intent: string) {
    update({
      intents: value.intents.includes(intent)
        ? value.intents.filter((item) => item !== intent)
        : [...value.intents, intent],
    });
  }
  return (
    <div className="space-y-8">
      <StepIntro
        title="What would be useful right now?"
        description="This gives Scouter some initial context. You can explain everything in more detail when you talk."
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {intentOptions.map((intent) => {
          const selected = value.intents.includes(intent.value);
          return (
            <button
              key={intent.value}
              type="button"
              onClick={() => toggle(intent.value)}
              className={cn(
                "flex min-h-28 items-start gap-4 rounded-xl border p-4 text-left transition-colors",
                selected ? "border-orange-300 bg-orange-50" : "bg-white hover:bg-zinc-50",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 grid size-5 shrink-0 place-items-center rounded-md border",
                  selected && "border-orange-600 bg-orange-600 text-white",
                )}
              >
                {selected ? <Check className="size-3.5" /> : null}
              </span>
              <span>
                <span className="block font-semibold text-sm">{intent.label}</span>
                <span className="mt-1 block text-muted-foreground text-sm leading-6">{intent.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-2">
        <FieldLabel htmlFor="scouter-founder-notes">Anything else Scouter should know?</FieldLabel>
        <Textarea
          id="scouter-founder-notes"
          value={value.notes}
          onChange={(event) => update({ notes: event.target.value })}
          placeholder="e.g. We are planning to raise in Q4 and are mainly looking for seed funds with deep AI experience."
          className="min-h-28 rounded-xl"
        />
        <p className="text-muted-foreground text-xs">Optional - you can also explain this during your conversation.</p>
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
