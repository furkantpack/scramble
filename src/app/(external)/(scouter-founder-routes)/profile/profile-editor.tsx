"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  ArrowRight,
  Check,
  CircleAlert,
  ExternalLink,
  FileText,
  Globe2,
  RotateCcw,
  Save,
  Upload,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { confirmedProfileSchema } from "@/lib/knowledge/unified-profile";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { Tables } from "@/types/database";

import { PageIntro } from "../_components/founder-ui";

type DeckSummary = Pick<Tables<"company_assets">, "file_name" | "created_at" | "file_size_bytes"> | null;
type Draft = {
  firstName: string;
  lastName: string;
  linkedin: string;
  founderContext: string;
  companyName: string;
  website: string;
  stage: Tables<"companies">["stage"];
  description: string;
};
type FieldKey = keyof Draft;
type FieldErrors = Partial<Record<FieldKey | "deck", string>>;

const MAX_DECK_SIZE = 20 * 1024 * 1024;
const stages: { value: Draft["stage"]; label: string }[] = [
  { value: "idea", label: "Idea" },
  { value: "pre_seed", label: "Pre-seed" },
  { value: "seed", label: "Seed" },
  { value: "series_a", label: "Series A" },
  { value: "later_stage", label: "Later stage" },
  { value: "not_sure", label: "Not sure yet" },
];

function fromRecords(founder: Tables<"founder_profiles">, company: Tables<"companies">): Draft {
  return {
    firstName: founder.first_name,
    lastName: founder.last_name,
    linkedin: founder.linkedin_url ?? "",
    founderContext: founder.anything_else_scouter_should_know ?? "",
    companyName: company.name,
    website: company.website_url ?? "",
    stage: company.stage,
    description: company.short_description ?? "",
  };
}

function validWebUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

function formatBytes(value: number | null | undefined) {
  if (!value) return null;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function ProfileEditor({
  workspaceId,
  membershipRole,
  founder,
  company,
  deck: initialDeck,
}: {
  workspaceId: string;
  membershipRole: Tables<"workspace_members">["role"];
  founder: Tables<"founder_profiles">;
  company: Tables<"companies">;
  deck: DeckSummary;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(() => fromRecords(founder, company));
  const [savedDraft, setSavedDraft] = useState(() => fromRecords(founder, company));
  const [deck, setDeck] = useState(initialDeck);
  const [deckFile, setDeckFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(savedDraft) || deckFile !== null;
  const completed = [
    draft.firstName.trim() && draft.lastName.trim(),
    draft.linkedin.trim(),
    draft.companyName.trim(),
    draft.website.trim(),
    draft.description.trim(),
    deck || deckFile,
  ].filter(Boolean).length;

  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty]);

  function update<K extends FieldKey>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setSaveError("");
  }

  function selectDeck(file: File | null) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) || file.type !== "application/pdf" || file.size === 0 || file.size > MAX_DECK_SIZE) {
      setErrors((current) => ({ ...current, deck: "Choose a PDF file under 20 MB." }));
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setDeckFile(file);
    setErrors((current) => ({ ...current, deck: undefined }));
    setSaveError("");
  }

  function discard() {
    setDraft(savedDraft);
    setDeckFile(null);
    setErrors({});
    setSaveError("");
    if (fileInput.current) fileInput.current.value = "";
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !dirty) return;

    const next: Draft = {
      ...draft,
      firstName: draft.firstName.trim(),
      lastName: draft.lastName.trim(),
      linkedin: draft.linkedin.trim(),
      founderContext: draft.founderContext.trim(),
      companyName: draft.companyName.trim(),
      website: draft.website.trim(),
      description: draft.description.trim(),
    };
    const validation: FieldErrors = {};
    if (!next.firstName) validation.firstName = "First name is required.";
    if (!next.lastName) validation.lastName = "Last name is required.";
    if (!next.companyName) validation.companyName = "Company name is required.";
    if (next.linkedin && !validWebUrl(next.linkedin)) validation.linkedin = "Enter a full http or https URL.";
    if (next.website && !validWebUrl(next.website)) validation.website = "Enter a full http or https URL.";
    if (Object.keys(validation).length) {
      setErrors(validation);
      setSaveError("Check the highlighted fields and try again.");
      return;
    }

    setSaving(true);
    setSaveError("");
    const founderChanged = ["firstName", "lastName", "linkedin", "founderContext"].some(
      (key) => next[key as keyof Draft] !== savedDraft[key as keyof Draft],
    );
    const companyChanged = ["companyName", "website", "stage", "description"].some(
      (key) => next[key as keyof Draft] !== savedDraft[key as keyof Draft],
    );
    let founderSaved = false;
    let detailsSaved = false;
    try {
      const supabase = getSupabaseBrowserClient();
      if (founderChanged) {
        const { error: founderError } = await supabase
          .from("founder_profiles")
          .update({
            first_name: next.firstName,
            last_name: next.lastName,
            linkedin_url: next.linkedin || null,
            anything_else_scouter_should_know: next.founderContext || null,
          })
          .eq("id", founder.id)
          .eq("workspace_id", workspaceId)
          .select("id")
          .single();
        if (founderError) throw new Error("founder");
        founderSaved = true;
      }

      if (companyChanged) {
        const { data: currentCompany, error: currentCompanyError } = await supabase
          .from("companies")
          .select("canonical_profile,profile_confirmed_at")
          .eq("id", company.id)
          .eq("workspace_id", workspaceId)
          .single();
        if (currentCompanyError || !currentCompany) throw new Error("company");
        const confirmed = confirmedProfileSchema.safeParse(currentCompany?.canonical_profile);
        const founderProvenance = {
          source: "founder",
          confidence: 1,
          evidence: [
            { source: "founder", url: null, page: null, excerpt: "Founder updated this field in the profile." },
          ],
        };
        const provenance =
          confirmed.success && confirmed.data.provenance
            ? {
                ...confirmed.data.provenance,
                ...(next.companyName !== savedDraft.companyName ? { company_name: founderProvenance } : {}),
                ...(next.description !== savedDraft.description ? { one_liner: founderProvenance } : {}),
                ...(next.stage !== savedDraft.stage ? { funding_stage: founderProvenance } : {}),
              }
            : undefined;
        if (confirmed.success && membershipRole === "owner") {
          const response = await fetch(`/api/companies/${company.id}/profile`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: next.companyName,
              websiteUrl: next.website || null,
              stage: next.stage,
              shortDescription: next.description || null,
              expectedConfirmedAt: currentCompany.profile_confirmed_at,
              canonicalProfile: {
                ...confirmed.data,
                fields: {
                  ...confirmed.data.fields,
                  company_name: next.companyName,
                  one_liner: next.description || null,
                  funding_stage: next.stage,
                },
                ...(provenance ? { provenance } : {}),
              },
            }),
          });
          if (!response.ok) throw new Error("company");
        } else {
          // Ordinary company fields remain governed by the existing company RLS policy.
          // Non-owners never send canonical profile fields from the browser.
          const { error: companyError } = await supabase
            .from("companies")
            .update({
              name: next.companyName,
              website_url: next.website || null,
              stage: next.stage,
              short_description: next.description || null,
            })
            .eq("id", company.id)
            .eq("workspace_id", workspaceId)
            .select("id")
            .single();
          if (companyError) throw new Error("company");
        }
      }
      detailsSaved = true;
      setDraft(next);
      setSavedDraft(next);

      if (deckFile) {
        const safeName = deckFile.name.replace(/[^a-zA-Z0-9._-]/g, "-");
        const storagePath = `${workspaceId}/${company.id}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from("pitch-decks").upload(storagePath, deckFile, {
          contentType: deckFile.type || "application/octet-stream",
          upsert: false,
        });
        if (uploadError) throw new Error("upload");

        const { data: asset, error: assetError } = await supabase
          .from("company_assets")
          .insert({
            workspace_id: workspaceId,
            company_id: company.id,
            type: "pitch_deck",
            file_name: deckFile.name,
            storage_path: storagePath,
            mime_type: deckFile.type || null,
            file_size_bytes: deckFile.size,
            analysis_status: "uploaded",
          })
          .select("id,file_name,created_at,file_size_bytes")
          .single();
        if (assetError || !asset) {
          await supabase.storage.from("pitch-decks").remove([storagePath]);
          throw new Error("asset");
        }
        setDeck(asset);
        const analysisRequest = await fetch(`/api/onboarding/pitch-deck/${asset.id}`, { method: "POST" }).catch(
          () => null,
        );
        if (!analysisRequest?.ok)
          toast.error("Deck uploaded, but analysis could not be queued. Retry from your profile.");
        setDeckFile(null);
        if (fileInput.current) fileInput.current.value = "";
      }

      if (companyChanged && !deckFile) {
        try {
          await fetch(`/api/companies/${company.id}/analyze`, { method: "POST", signal: AbortSignal.timeout(15_000) });
        } catch {
          /* Saved edits remain intact; the review panel offers an explicit retry. */
        }
      }
      toast.success("Profile saved");
      router.refresh();
    } catch {
      if (detailsSaved) {
        setSaveError(
          founderChanged || companyChanged
            ? "Your profile details were saved, but the pitch deck could not be uploaded. Try saving again."
            : "The pitch deck could not be uploaded. Try saving again.",
        );
      } else if (founderSaved) {
        setSaveError("Your founder details saved, but company details did not. Try saving again.");
      } else {
        setSaveError("Your profile could not be saved. Check your connection and try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <PageIntro
        eyebrow="Your company context"
        title="Founder profile"
        description="Keep the facts behind your applications accurate. Changes here are founder-provided and never overwrite approved Knowledge Base content."
        action={
          <Button asChild variant="outline" className="rounded-xl">
            <Link href="/knowledge-base">
              Review knowledge <ArrowRight className="size-4" />
            </Link>
          </Button>
        }
      />

      <form onSubmit={save} noValidate className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-3 border-zinc-100 border-b px-5 py-4 md:px-7">
            <div>
              <p className="font-semibold text-sm">Profile details</p>
              <p className="mt-0.5 text-muted-foreground text-xs">
                Founder input · Used to personalize application preparation
              </p>
            </div>
            <span className="rounded-full border border-zinc-200 px-3 py-1 text-muted-foreground text-xs">
              {completed} of 6 details added
            </span>
          </div>

          <section className="px-5 py-6 md:px-7" aria-labelledby="founder-section">
            <SectionHeading
              id="founder-section"
              icon={UserRound}
              title="About you"
              description="The person behind the company."
            />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field
                id="profile-first-name"
                label="First name"
                value={draft.firstName}
                onChange={(value) => update("firstName", value)}
                error={errors.firstName}
                required
                disabled={saving}
              />
              <Field
                id="profile-last-name"
                label="Last name"
                value={draft.lastName}
                onChange={(value) => update("lastName", value)}
                error={errors.lastName}
                required
                disabled={saving}
              />
            </div>
            <div className="mt-4">
              <Field
                id="profile-linkedin"
                label="LinkedIn profile"
                value={draft.linkedin}
                onChange={(value) => update("linkedin", value)}
                error={errors.linkedin}
                placeholder="https://linkedin.com/in/your-name"
                type="url"
                disabled={saving}
              />
            </div>
            <div className="mt-4">
              <label htmlFor="profile-context" className="font-medium text-sm">
                Additional founder context <span className="font-normal text-muted-foreground">· optional</span>
              </label>
              <Textarea
                id="profile-context"
                value={draft.founderContext}
                onChange={(event) => update("founderContext", event.target.value)}
                disabled={saving}
                rows={3}
                maxLength={2000}
                placeholder="Anything else Scramble should know about your background or current goals?"
                className="mt-2 resize-y rounded-xl"
              />
              <p className="mt-1.5 text-muted-foreground text-xs">
                Provided by you. Helps Scramble understand your context without making assumptions.
              </p>
            </div>
          </section>

          <section className="border-zinc-100 border-t px-5 py-6 md:px-7" aria-labelledby="company-section">
            <SectionHeading
              id="company-section"
              icon={Globe2}
              title="Company"
              description="Core facts shared across your workspace."
            />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field
                id="profile-company-name"
                label="Company name"
                value={draft.companyName}
                onChange={(value) => update("companyName", value)}
                error={errors.companyName}
                required
                disabled={saving}
              />
              <div>
                <label htmlFor="profile-stage" className="font-medium text-sm">
                  Stage
                </label>
                <select
                  id="profile-stage"
                  value={draft.stage}
                  onChange={(event) => update("stage", event.target.value as Draft["stage"])}
                  disabled={saving}
                  className="mt-2 h-10 w-full rounded-xl border border-input bg-white px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  {stages.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-4">
              <Field
                id="profile-website"
                label="Company website"
                value={draft.website}
                onChange={(value) => update("website", value)}
                error={errors.website}
                placeholder="https://yourcompany.com"
                type="url"
                disabled={saving}
              />
              <p className="mt-1.5 text-muted-foreground text-xs">
                Changing this URL does not automatically replace approved knowledge. Refresh sources from Knowledge Base
                when ready.
              </p>
            </div>
            <div className="mt-4">
              <label htmlFor="profile-description" className="font-medium text-sm">
                Short company description <span className="font-normal text-muted-foreground">· optional</span>
              </label>
              <Textarea
                id="profile-description"
                value={draft.description}
                onChange={(event) => update("description", event.target.value)}
                disabled={saving}
                rows={3}
                maxLength={600}
                placeholder="What does your company do, and for whom?"
                className="mt-2 resize-y rounded-xl"
              />
            </div>
          </section>

          <section
            id="pitch-deck"
            className="border-zinc-100 border-t px-5 py-6 md:px-7"
            aria-labelledby="deck-section"
          >
            <SectionHeading
              id="deck-section"
              icon={FileText}
              title="Pitch deck"
              description="Keep the latest version available for applications."
            />
            {deck ? (
              <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-zinc-700">
                  <FileText className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">{deck.file_name || "Pitch deck"}</p>
                  <p className="mt-0.5 text-muted-foreground text-xs">
                    Current deck{formatBytes(deck.file_size_bytes) ? ` · ${formatBytes(deck.file_size_bytes)}` : ""}
                  </p>
                </div>
                <Button asChild variant="ghost" size="sm" className="shrink-0">
                  <a href="/api/profile/deck" target="_blank" rel="noopener noreferrer">
                    View <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              </div>
            ) : (
              <p className="mt-5 text-muted-foreground text-sm">
                No pitch deck uploaded yet. You can add one now or later.
              </p>
            )}
            <input
              ref={fileInput}
              id="profile-deck-file"
              type="file"
              accept=".pdf,application/pdf"
              onChange={(event) => selectDeck(event.target.files?.[0] ?? null)}
              className="sr-only"
              disabled={saving}
            />
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => fileInput.current?.click()}
                disabled={saving}
              >
                <Upload className="size-4" /> {deck ? "Replace deck" : "Upload deck"}
              </Button>
              <span className="text-muted-foreground text-xs">PDF · maximum 20 MB</span>
            </div>
            {deckFile ? (
              <div className="mt-3 flex items-center gap-2 text-sm">
                <Check className="size-4 text-emerald-600" />
                <span className="truncate">{deckFile.name}</span>
                <span className="shrink-0 text-muted-foreground">{formatBytes(deckFile.size)}</span>
                <button
                  type="button"
                  onClick={() => {
                    setDeckFile(null);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                  className="ml-auto shrink-0 font-medium text-zinc-600 hover:text-zinc-950"
                >
                  Remove
                </button>
              </div>
            ) : null}
            {errors.deck ? (
              <p className="mt-2 text-red-600 text-xs" role="alert">
                {errors.deck}
              </p>
            ) : null}
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 border-zinc-100 border-t bg-zinc-50/60 px-5 py-4 md:px-7">
            <p className="text-muted-foreground text-xs">
              {dirty ? "You have unsaved changes." : "All changes saved."}
            </p>
            <div className="flex items-center gap-2">
              {dirty ? (
                <Button type="button" variant="ghost" onClick={discard} disabled={saving}>
                  <RotateCcw className="size-4" /> Discard
                </Button>
              ) : null}
              <Button
                type="submit"
                disabled={!dirty || saving}
                className="rounded-xl bg-orange-600 hover:bg-orange-700"
              >
                <Save className="size-4" /> {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
          {saveError ? (
            <p
              role="alert"
              className="flex items-center gap-2 border-red-100 border-t bg-red-50 px-5 py-3 text-red-700 text-sm md:px-7"
            >
              <CircleAlert className="size-4 shrink-0" />
              {saveError}
            </p>
          ) : null}
        </div>

        <aside className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs xl:sticky xl:top-20">
          <p className="font-semibold text-sm">Application context</p>
          <p className="mt-1 text-muted-foreground text-xs leading-5">
            These founder-provided details support your Knowledge Base and application drafts.
          </p>
          <div className="mt-5 space-y-3 border-zinc-100 border-y py-4 text-sm">
            <StatusRow label="Founder identity" ready={!!draft.firstName.trim() && !!draft.lastName.trim()} />
            <StatusRow label="Company basics" ready={!!draft.companyName.trim()} />
            <StatusRow label="Website source" ready={!!draft.website.trim()} />
            <StatusRow label="Pitch deck" ready={!!deck || !!deckFile} />
          </div>
          <p className="mt-4 text-muted-foreground text-xs leading-5">
            Approved Knowledge Base information is reviewed separately before it is used in applications.
          </p>
          <Link
            href="/knowledge-base"
            className="mt-4 inline-flex items-center gap-1.5 font-medium text-orange-700 text-sm hover:text-orange-800"
          >
            Open Knowledge Base <ArrowRight className="size-4" />
          </Link>
        </aside>
      </form>
    </div>
  );
}

function SectionHeading({
  id,
  icon: Icon,
  title,
  description,
}: {
  id: string;
  icon: typeof UserRound;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-orange-100 bg-orange-50 text-orange-700">
        <Icon className="size-4" strokeWidth={1.8} />
      </span>
      <div>
        <h2 id={id} className="font-semibold text-base">
          {title}
        </h2>
        <p className="mt-0.5 text-muted-foreground text-sm">{description}</p>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  required,
  type = "text",
  placeholder,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  required?: boolean;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="font-medium text-sm">
        {label}
        {required ? (
          <span className="text-orange-600"> *</span>
        ) : (
          <span className="font-normal text-muted-foreground"> · optional</span>
        )}
      </label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        className="mt-2 h-10 rounded-xl"
      />
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-red-600 text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function StatusRow({ label, ready }: { label: string; ready: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-zinc-700">{label}</span>
      <span className={ready ? "text-emerald-700" : "text-muted-foreground"}>
        {ready ? <Check className="size-4" aria-label="Ready" /> : "Not added"}
      </span>
    </div>
  );
}
