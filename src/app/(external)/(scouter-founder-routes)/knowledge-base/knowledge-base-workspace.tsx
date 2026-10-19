"use client";

import { useState } from "react";

import {
  AlertTriangle,
  ArrowRight,
  BadgeDollarSign,
  BookOpenText,
  Bot,
  ChartNoAxesCombined,
  Check,
  CheckCircle2,
  Circle,
  CircleHelp,
  Crosshair,
  ExternalLink,
  FilePenLine,
  FileText,
  Globe2,
  History,
  Info,
  Lightbulb,
  Link2,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  Swords,
  TrendingUp,
  UserRound,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { emptyTractionDraft, formatTractionContent, parseTractionContent, type TractionDraft } from "@/lib/knowledge/traction-content";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { Tables } from "@/types/database";

import { PageIntro } from "../_components/founder-ui";
import { CompanyAnalysisPanel, useCompanyAnalysis } from "./company-analysis";

type KnowledgeStatus = "Approved" | "Needs Review" | "Missing" | "AI Generated" | "Founder Edited";
type CategoryId =
  | "overview"
  | "problem"
  | "solution"
  | "target-customer"
  | "market"
  | "traction"
  | "business-model"
  | "competition"
  | "team"
  | "ask";

type Category = { id: CategoryId; label: string; status: KnowledgeStatus };

const initialCategories: Category[] = [
  { id: "overview", label: "Overview", status: "AI Generated" },
  { id: "problem", label: "Problem", status: "Approved" },
  { id: "solution", label: "Solution", status: "Approved" },
  { id: "target-customer", label: "Target Customer", status: "Needs Review" },
  { id: "market", label: "Market", status: "Needs Review" },
  { id: "traction", label: "Traction", status: "Missing" },
  { id: "business-model", label: "Business Model", status: "Approved" },
  { id: "competition", label: "Competition", status: "AI Generated" },
  { id: "team", label: "Team", status: "Approved" },
  { id: "ask", label: "Ask", status: "Missing" },
];

const categoryIcons = {
  overview: BookOpenText,
  problem: CircleHelp,
  solution: Lightbulb,
  "target-customer": UsersRound,
  market: ChartNoAxesCombined,
  traction: TrendingUp,
  "business-model": BadgeDollarSign,
  competition: Swords,
  team: UserRound,
  ask: Crosshair,
} satisfies Record<CategoryId, typeof BookOpenText>;

const categoryCopy: Partial<
  Record<CategoryId, { intro: string; sections: { title: string; body: string; bullets?: string[] }[] }>
> = {
  problem: {
    intro: "The core customer pain AcceleratorPilot is built to solve.",
    sections: [
      {
        title: "Problem statement",
        body: "Founders repeatedly rewrite the same company story across accelerator applications, losing time and introducing inconsistencies between answers.",
      },
      {
        title: "Why current workflows fail",
        body: "Company context is scattered across websites, decks, notes, and previous applications. Generic AI tools do not preserve a verified, reusable source of truth.",
      },
    ],
  },
  solution: {
    intro: "How AcceleratorPilot turns company context into application-ready intelligence.",
    sections: [
      {
        title: "Product",
        body: "AcceleratorPilot builds a verified company knowledge layer and uses only founder-approved context to draft tailored accelerator applications.",
      },
      {
        title: "Core workflow",
        body: "Analyze sources, structure the company narrative, request missing signals, approve facts, and reuse that trusted context across applications.",
      },
    ],
  },
  "business-model": {
    intro: "How the company plans to create and capture value.",
    sections: [
      {
        title: "Revenue model",
        body: "Subscription software for startup teams, with tiered access based on active applications, collaboration, and intelligence features.",
      },
      {
        title: "Initial wedge",
        body: "Early-stage founders actively applying to multiple accelerators and funding programs in a concentrated period.",
      },
    ],
  },
  competition: {
    intro: "The alternatives founders use today and the intended differentiation.",
    sections: [
      {
        title: "Current alternatives",
        body: "General-purpose AI assistants, consultants, application templates, and manual reuse of answers from documents or spreadsheets.",
      },
      {
        title: "Differentiation",
        body: "A source-aware, founder-approved company memory designed specifically for application quality and consistency.",
      },
    ],
  },
};

const targetCustomerDefault = {
  primary:
    "Early-stage startup founders applying to accelerators and funding programs who need to communicate a consistent, evidence-backed company story.",
  users: ["Founders", "Co-founders", "Startup operators", "Accelerator application advisors"],
  jobs: [
    "Reuse verified company context across applications",
    "Draft stronger answers without starting from zero",
    "Keep claims consistent across the founding team",
    "Identify missing evidence before submitting",
  ],
};

const sourcesByCategory: Record<string, Source[]> = {
  default: [
    {
      type: "Website",
      title: "Website",
      origin: "acceleratorpilot.com",
      quote: "One verified company context for every accelerator application.",
      detail: "Directly extracted",
    },
    {
      type: "Founder",
      title: "Founder Input",
      origin: "Onboarding",
      quote: "We help founders create better accelerator applications without repeating the same work.",
      detail: "Founder provided",
    },
    {
      type: "AI Inference",
      title: "AI Inference",
      origin: "Positioning analysis",
      quote: "The primary user appears to be a founder managing multiple high-stakes application workflows.",
      detail: "Inference — not verified",
    },
  ],
  market: [
    {
      type: "Founder",
      title: "Founder Input",
      origin: "Onboarding",
      quote: "Initial focus is early-stage founders applying to European and US accelerators.",
      detail: "Founder provided",
    },
    {
      type: "AI Inference",
      title: "AI Market Estimate",
      origin: "Category analysis",
      quote: "Available public signals are not sufficient to verify TAM, SAM, or SOM values.",
      detail: "Estimate requires verification",
    },
  ],
};

type Source = {
  type: "Website" | "Founder" | "AI Inference" | "Manual" | "Pitch Deck";
  title: string;
  origin: string;
  quote: string;
  detail: string;
};

type KnowledgeBaseWorkspaceProps = {
  workspaceId: string;
  companyId: string;
  userId: string;
  initialEntries: Tables<"knowledge_base_entries">[];
  initialSources: Tables<"knowledge_sources">[];
  initialSection?: string;
};

export function KnowledgeBaseWorkspace({
  workspaceId,
  companyId,
  userId,
  initialEntries,
  initialSources,
  initialSection,
}: KnowledgeBaseWorkspaceProps) {
  const [selectedId, setSelectedId] = useState<CategoryId>(() => initialCategories.find((category) => category.id === initialSection)?.id ?? "overview");
  const [entries, setEntries] = useState(initialEntries);
  const [categories, setCategories] = useState(() =>
    initialCategories.map((category) => {
      if (category.id === "overview") return category;
      const entry = initialEntries.find((item) => item.category === databaseCategory(category.id));
      return { ...category, status: entry ? displayStatus(entry.status) : ("Missing" as const) };
    }),
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [tractionDraft, setTractionDraft] = useState<TractionDraft>(emptyTractionDraft());
  const [regenerateOpen, setRegenerateOpen] = useState(false);
  const [comparison, setComparison] = useState(false);
  const [rawSourcesOpen, setRawSourcesOpen] = useState(false);
  const analysis = useCompanyAnalysis(companyId);
  const processing = analysis.busy;

  const selected = categories.find((category) => category.id === selectedId) ?? categories[0];
  const readyCount = categories.filter(
    (category) => category.id !== "overview" && category.status !== "Missing",
  ).length;
  const selectedEntry = selectedId === "overview" ? undefined : entries.find((item) => item.category === databaseCategory(selectedId));
  const content = selectedEntry?.content ?? "";
  const sources: Source[] = selectedId === "traction" && selectedEntry?.source_type === "manual"
    ? [{ type: "Founder", title: "Founder input", origin: "Traction editor", quote: "MRR, ARR and traction context entered by the founder.", detail: "Founder-provided · Not independently verified" }]
    : selectedEntry
      ? initialSources.filter((source) => source.knowledge_entry_id === selectedEntry.id).map(sourceView)
      : [];

  const updateStatus = (status: KnowledgeStatus) => {
    setCategories((current) =>
      current.map((category) => (category.id === selectedId ? { ...category, status } : category)),
    );
  };

  const approve = async () => {
    if (!selectedEntry) return toast.error("Add content before approving this section.");
    const supabase = getSupabaseBrowserClient();
    const { error } = await supabase
      .from("knowledge_base_entries")
      .update({ status: "approved", approved_by: userId, approved_at: new Date().toISOString() })
      .eq("id", selectedEntry.id);
    if (error) return toast.error("This section could not be approved.");
    setEntries((current) => current.map((entry) => (entry.id === selectedEntry.id ? { ...entry, status: "approved", approved_by: userId, approved_at: new Date().toISOString() } : entry)));
    updateStatus("Approved");
    await supabase.from("audit_logs").insert({ workspace_id: workspaceId, actor_user_id: userId, action: "knowledge_approved", metadata: { category: selectedEntry.category } });
    toast.success(`${selected.label} approved for application use`);
  };

  const saveEdit = async () => {
    if (selectedId === "overview") return;
    const formatted = selectedId === "traction" ? formatTractionContent(tractionDraft) : { content: draft.trim() };
    if ("error" in formatted) return toast.error(formatted.error);
    const value = formatted.content;
    if (!value) return toast.error("Add information before saving.");
    const supabase = getSupabaseBrowserClient();
    if (selectedEntry) {
      const { error } = await supabase
        .from("knowledge_base_entries")
        .update({ content: value, status: "founder_edited", source_type: "manual", version: selectedEntry.version + 1, approved_by: null, approved_at: null })
        .eq("id", selectedEntry.id);
      if (error) return toast.error("Your changes could not be saved.");
      setEntries((current) => current.map((entry) => (entry.id === selectedEntry.id ? { ...entry, content: value, status: "founder_edited", source_type: "manual", version: entry.version + 1, approved_by: null, approved_at: null } : entry)));
    } else {
      const { data, error } = await supabase
        .from("knowledge_base_entries")
        .insert({ workspace_id: workspaceId, company_id: companyId, category: databaseCategory(selectedId), content: value, source_type: "manual", status: "founder_edited", version: 1 })
        .select("*")
        .single();
      if (error) return toast.error("Your changes could not be saved.");
      setEntries((current) => [...current, data]);
    }
    setEditing(false);
    updateStatus("Founder Edited");
    await supabase.from("audit_logs").insert({ workspace_id: workspaceId, actor_user_id: userId, action: "knowledge_edited", metadata: { category: databaseCategory(selectedId) } });
    toast.success("Founder edits saved");
  };

  const refreshSources = analysis.start;

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        eyebrow="Company intelligence"
        title="Knowledge Base"
        description="The verified company context AcceleratorPilot uses to write your applications."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setRawSourcesOpen(true)}>
              <ScanSearch /> View raw sources
            </Button>
            <Button onClick={refreshSources} className="bg-orange-600 hover:bg-orange-700" disabled={processing}>
              <RefreshCw className={cn(processing && "animate-spin")} />{" "}
              {processing ? "Refreshing…" : "Refresh sources"}
            </Button>
          </div>
        }
      />

      <CompanyAnalysisPanel analysis={analysis} />

      <div className="lg:hidden">
        <Select value={selectedId} onValueChange={(value) => setSelectedId(value as CategoryId)}>
          <SelectTrigger className="h-11 w-full bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {categories.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.label} · {category.status}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <CategoryNavigation
          categories={categories}
          selectedId={selectedId}
          onSelect={setSelectedId}
          readyCount={readyCount}
        />

        <main className="min-w-0 space-y-5">
          {selectedId === "overview" ? (
            <OverviewPanel
              onSelect={setSelectedId}
              categories={categories}
              entries={entries}
              sources={initialSources}
            />
          ) : (
            <KnowledgePanel
              category={selected}
              editing={editing}
              draft={draft}
              tractionDraft={tractionDraft}
              manualTraction={selectedEntry?.source_type === "manual"}
              content={content}
              onDraftChange={setDraft}
              onTractionDraftChange={setTractionDraft}
              onEdit={() => {
                setDraft(content);
                setTractionDraft(selectedEntry?.source_type === "manual" ? parseTractionContent(content) : emptyTractionDraft(content));
                setEditing(true);
              }}
              onCancel={() => setEditing(false)}
              onSave={saveEdit}
              onApprove={approve}
              onRegenerate={() => {
                toast("AI regeneration is not connected yet", {
                  description: "Existing founder edits and approvals remain unchanged.",
                });
              }}
            />
          )}
          <SourcesPanel sources={sources} />
        </main>
      </div>

      <RegenerateDialog
        open={regenerateOpen}
        onOpenChange={setRegenerateOpen}
        category={selected.label}
        comparison={comparison}
        onCompare={() => setComparison(true)}
          current={content}
        onUseSuggestion={() => {
          updateStatus("Needs Review");
          setRegenerateOpen(false);
          toast.success("New suggestion applied — review before approving");
        }}
      />

      <Sheet open={rawSourcesOpen} onOpenChange={setRawSourcesOpen}>
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>Raw sources</SheetTitle>
            <SheetDescription>Inputs currently available to the company knowledge engine.</SheetDescription>
          </SheetHeader>
          <div className="space-y-3 p-5">
            {initialSources.length > 0 ? initialSources.map((source) => {
              const view = sourceView(source);
              return <SourceCard key={source.id} source={view} />;
            }) : (
              <p className="rounded-xl border border-dashed p-5 text-center text-muted-foreground text-sm">
                No Knowledge Base sources have been added yet.
              </p>
            )}
            <p className="rounded-xl bg-zinc-50 p-4 text-muted-foreground text-sm leading-6">
              Refreshing sources creates suggestions for review. It never replaces founder-approved information
              automatically.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CategoryNavigation({
  categories,
  selectedId,
  onSelect,
  readyCount,
}: {
  categories: Category[];
  selectedId: CategoryId;
  onSelect: (id: CategoryId) => void;
  readyCount: number;
}) {
  return (
    <aside className="sticky top-16 hidden rounded-xl border bg-card p-2.5 lg:block">
      <div className="px-2 pb-4 pt-2">
        <p className="font-semibold">Company Knowledge</p>
        <p className="mt-1 text-muted-foreground text-xs">{readyCount} of 9 sections populated</p>
        <Progress value={Math.round((readyCount / 9) * 100)} className="mt-3 h-1.5" />
      </div>
      <nav className="space-y-0.5 border-t pt-3">
        {categories.map((category) => {
          const Icon = categoryIcons[category.id];
          return (
            <button
              type="button"
              key={category.id}
              onClick={() => onSelect(category.id)}
              className={cn(
                "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                selectedId === category.id
                  ? "bg-zinc-950 font-medium text-white"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950",
              )}
            >
              <Icon
                strokeWidth={1.75}
                className={cn(
                  "size-4 shrink-0",
                  selectedId === category.id ? "text-orange-300" : "text-zinc-400 group-hover:text-zinc-700",
                )}
              />
              <span className="min-w-0 flex-1 truncate">{category.label}</span>
              <StatusDot status={category.status} />
            </button>
          );
        })}
      </nav>
      <div className="mt-3 rounded-xl bg-zinc-50 p-3 text-muted-foreground text-xs leading-5">
        Only approved information can be used in application answers.
      </div>
    </aside>
  );
}

function KnowledgePanel({
  category,
  editing,
  draft,
  tractionDraft,
  manualTraction,
  content,
  onDraftChange,
  onTractionDraftChange,
  onEdit,
  onCancel,
  onSave,
  onApprove,
  onRegenerate,
}: {
  category: Category;
  editing: boolean;
  draft: string;
  tractionDraft: TractionDraft;
  manualTraction: boolean;
  content: string;
  onDraftChange: (value: string) => void;
  onTractionDraftChange: (value: TractionDraft) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onApprove: () => void;
  onRegenerate: () => void;
}) {
  const meta = manualTraction && category.id === "traction"
    ? "Founder-provided · Not independently verified"
    : category.status === "Missing"
      ? "No information yet"
      : category.status === "Founder Edited"
        ? "Founder edited"
        : "AI generated · Website + Founder Input";

  return (
    <section className="overflow-hidden rounded-xl border bg-card">
      <div className="border-b px-5 py-5 md:px-7">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <KnowledgeStatusBadge status={category.status} />
            <span className="text-muted-foreground text-xs">{meta}</span>
          </div>
          <h2 className="mt-3 font-semibold text-2xl tracking-tight">{category.label}</h2>
          <p className="mt-1 max-w-3xl text-muted-foreground text-sm leading-6">
            {category.id === "target-customer"
              ? "Who receives the most value, who uses the product, and what they hire it to do."
              : category.id === "market"
                ? "Market scope with a clear boundary between verified figures and AI estimates."
                : category.id === "traction"
                  ? "Verified evidence that the company is gaining momentum."
                  : category.id === "team"
                    ? "Founder and team context supported by available sources."
                    : category.id === "ask"
                      ? "The funding and accelerator support the company is seeking."
                      : categoryCopy[category.id]?.intro}
          </p>
        </div>
      </div>

      <div className="px-5 py-5 md:px-7 md:py-6">
        {editing && category.id === "traction" ? (
          <TractionEditor draft={tractionDraft} onChange={onTractionDraftChange} />
        ) : editing ? (
          <Textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            className="min-h-72 resize-y border-0 bg-zinc-50 p-5 text-sm leading-7 shadow-none focus-visible:ring-1"
            placeholder={`Add verified ${category.label.toLowerCase()} information…`}
          />
        ) : content && category.id === "traction" && manualTraction ? (
          <TractionDocument content={content} />
        ) : content ? (
          <article className="mx-auto max-w-4xl whitespace-pre-wrap border-y py-6 text-[15px] leading-7 text-zinc-700">
            {content}
          </article>
        ) : (
          <div className="mx-auto max-w-2xl py-14 text-center">
            <CircleHelp className="mx-auto size-6 text-zinc-400" />
            <h3 className="mt-4 font-semibold">No verified information yet</h3>
            <p className="mt-2 text-muted-foreground text-sm">
              {category.id === "traction"
                ? "Add your MRR and ARR in USD, plus any customer, growth or pilot context you can substantiate."
                : "Add founder-provided information for this section. AcceleratorPilot will not invent missing claims."}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3 border-t bg-zinc-50/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-7">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          {category.status === "Approved" ? (
            <>
              <CheckCircle2 className="size-4 text-emerald-600" /> Approved by you
            </>
          ) : category.status === "Founder Edited" ? (
            <>
              <FilePenLine className="size-4 text-sky-600" /> Manual edits take priority over AI content
            </>
          ) : (
            <>
              <Info className="size-4 text-amber-600" /> Review before using in applications
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
              <Button onClick={onSave} className="bg-orange-600 hover:bg-orange-700">
                Save changes
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={onEdit}>
                <FilePenLine /> {content ? "Edit" : "Add information"}
              </Button>
              <Button variant="outline" onClick={onRegenerate}>
                <RotateCcw /> Regenerate
              </Button>
              <Button onClick={onApprove} className="bg-orange-600 hover:bg-orange-700">
                <Check /> Approve
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function TractionEditor({ draft, onChange }: { draft: TractionDraft; onChange: (value: TractionDraft) => void }) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h3 className="font-medium text-sm">Revenue metrics</h3>
        <p className="mt-1 text-muted-foreground text-xs">Enter actual USD figures. Leave a field empty if it is not available.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {([
            { key: "mrr", label: "Monthly recurring revenue", short: "MRR" },
            { key: "arr", label: "Annual recurring revenue", short: "ARR" },
          ] as const).map((metric) => (
            <label key={metric.key} className="block rounded-xl border bg-white p-4" htmlFor={`traction-${metric.key}`}>
              <span className="text-muted-foreground text-xs">{metric.label}</span>
              <span className="mt-2 flex items-center gap-2">
                <span className="text-muted-foreground text-lg">$</span>
                <Input
                  id={`traction-${metric.key}`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft[metric.key]}
                  onChange={(event) => onChange({ ...draft, [metric.key]: event.target.value })}
                  placeholder="0.00"
                  aria-label={`${metric.short} in US dollars`}
                  className="h-9 border-0 px-0 text-lg shadow-none focus-visible:ring-0"
                />
                <span className="text-muted-foreground text-xs">USD</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div>
        <label htmlFor="traction-details" className="font-medium text-sm">Additional traction</label>
        <p className="mt-1 text-muted-foreground text-xs">Add customers, pilots, growth, partnerships or reporting-period context. Keep claims factual.</p>
        <Textarea
          id="traction-details"
          value={draft.details}
          onChange={(event) => onChange({ ...draft, details: event.target.value })}
          maxLength={4_000}
          placeholder="For example: 12 paying customers as of June 2026; two active pilots…"
          className="mt-3 min-h-40 resize-y bg-white text-sm leading-7"
        />
      </div>
      <p className="text-muted-foreground text-xs">These figures are founder-provided, not independently verified. Review and approve them before application use.</p>
    </div>
  );
}

function TractionDocument({ content }: { content: string }) {
  const { mrr, arr, details } = parseTractionContent(content);
  const metrics = [
    { label: "MRR", value: mrr },
    { label: "ARR", value: arr },
  ].filter((metric) => metric.value !== "");
  return (
    <article className="mx-auto max-w-4xl border-y py-5">
      {metrics.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {metrics.map((metric) => (
            <div key={metric.label} className="rounded-xl border bg-zinc-50 px-4 py-4">
              <p className="text-muted-foreground text-xs">{metric.label} · USD</p>
              <p className="mt-2 font-semibold text-2xl tracking-tight">
                {Number(metric.value).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 })}
              </p>
            </div>
          ))}
        </div>
      )}
      {details && (
        <div className={cn(metrics.length > 0 && "mt-6")}>
          <h3 className="font-medium text-sm">Additional traction</h3>
          <p className="mt-2 whitespace-pre-wrap text-[15px] leading-7 text-zinc-700">{details}</p>
        </div>
      )}
    </article>
  );
}

function TargetCustomerContent({
  editing,
  draft,
  primaryCustomer,
  onDraftChange,
}: {
  editing: boolean;
  draft: string;
  primaryCustomer: string;
  onDraftChange: (value: string) => void;
}) {
  return (
    <article className="mx-auto max-w-4xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">Structured company context</h3>
          <p className="mt-1 text-muted-foreground text-xs">A single, readable view of the company knowledge.</p>
        </div>
        <Badge variant="outline" className="font-normal text-xs">
          3 sections
        </Badge>
      </div>
      <div className="divide-y border-y">
        <section className="py-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-semibold text-sm">Primary customer</h4>
            <span className="text-amber-700 text-[10px]">Needs review</span>
          </div>
          <div className="mt-3 text-zinc-700 text-sm leading-7">
            {editing ? (
              <Textarea
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                className="min-h-32 resize-none bg-white leading-7"
              />
            ) : (
              <p>{primaryCustomer}</p>
            )}
          </div>
        </section>
        <section className="py-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-semibold text-sm">Primary users</h4>
            <span className="text-emerald-700 text-[10px]">Founder supported</span>
          </div>
          <div className="mt-3 text-zinc-700 text-sm leading-7">
            <BulletList items={targetCustomerDefault.users} />
          </div>
        </section>
        <section className="py-5">
          <div className="flex items-center justify-between gap-3">
            <h4 className="font-semibold text-sm">Core jobs-to-be-done</h4>
            <span className="text-emerald-700 text-[10px]">4 signals mapped</span>
          </div>
          <div className="mt-3 text-zinc-700 text-sm leading-7">
            <BulletList items={targetCustomerDefault.jobs} />
          </div>
        </section>
      </div>
    </article>
  );
}

function MarketContent() {
  return (
    <article className="mx-auto max-w-4xl divide-y border-y">
      <section className="py-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald-700" />
          <span className="text-emerald-700 text-[10px]">Verified</span>
        </div>
        <h3 className="mt-3 font-semibold text-sm">Initial market focus</h3>
        <p className="mt-2 text-sm leading-7">
          Early-stage founders applying to accelerator and non-dilutive funding programs in Europe and the United
          States.
        </p>
        <p className="mt-3 text-emerald-800 text-xs">Source: Founder onboarding</p>
      </section>
      <section className="py-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 text-amber-700" strokeWidth={1.8} />
          <span className="text-amber-700 text-[10px]">AI Estimate — Needs Verification</span>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <MarketMetric label="TAM" value="$2.4B" />
          <MarketMetric label="SAM" value="$410M" />
          <MarketMetric label="SOM" value="$32M" />
        </div>
        <p className="mt-4 text-amber-900/70 text-xs leading-5">
          Directional estimate based on startup formation and application-software benchmarks. No reliable source has
          been approved yet.
        </p>
      </section>
    </article>
  );
}

function MissingTraction() {
  const metrics = [
    "Revenue / ARR / MRR",
    "Active users",
    "Growth",
    "Customers",
    "Pilots",
    "Partnerships",
    "Funding raised",
  ];
  return (
    <article className="mx-auto max-w-4xl border-y py-6">
      <div className="flex size-9 items-center justify-center rounded-lg bg-amber-50">
        <AlertTriangle className="size-5 text-amber-600" />
      </div>
      <h3 className="mt-4 font-semibold text-lg">We couldn&apos;t verify your traction yet.</h3>
      <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
        Add metrics that should be available to application-answer generation. AcceleratorPilot will never invent these
        values.
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {metrics.map((metric) => (
          <Badge key={metric} variant="outline" className="bg-white px-3 py-1.5 font-normal">
            {metric}
          </Badge>
        ))}
      </div>
      <Button className="mt-6 bg-orange-600 hover:bg-orange-700" onClick={() => toast("Traction editor opened")}>
        Add traction <ArrowRight />
      </Button>
    </article>
  );
}

function TeamContent() {
  return (
    <article className="mx-auto max-w-4xl border-y py-5">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-zinc-950 font-semibold text-white">
          FE
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-lg">Furkan Emre Topcuoğlu</h3>
              <p className="text-muted-foreground text-sm">Founder</p>
            </div>
            <Button variant="outline" size="sm">
              Edit profile
            </Button>
          </div>
          <button
            type="button"
            onClick={() => toast("LinkedIn profile preview")}
            className="mt-4 inline-flex items-center gap-1.5 text-orange-600 text-sm"
          >
            LinkedIn <ExternalLink className="size-3.5" />
          </button>
          <p className="mt-4 max-w-2xl text-sm leading-7">
            Product-focused founder building AI-native workflows that help startup teams turn verified company knowledge
            into stronger accelerator applications.
          </p>
          <p className="mt-3 text-muted-foreground text-xs">
            Generated only from founder-provided profile and public LinkedIn summary.
          </p>
        </div>
      </div>
    </article>
  );
}

function AskContent() {
  const fields = [
    ["Fundraising status", "Not provided"],
    ["Amount raising", "Not provided"],
    ["Intended use of funds", "Not provided"],
    ["Accelerator goals", "Product validation · Network · Fundraising readiness"],
    ["Support needed", "GTM strategy and warm investor introductions"],
  ];
  return (
    <article className="mx-auto max-w-4xl">
      <div className="mb-5 border-amber-300 border-l-2 pl-4 text-amber-950 text-sm leading-6">
        This section usually requires founder input and may be adapted for each accelerator.
      </div>
      <dl className="divide-y border-y">
        {fields.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between">
            <dt className="text-muted-foreground text-sm">{label}</dt>
            <dd className={cn("text-sm", value === "Not provided" ? "text-amber-700" : "font-medium")}>{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function GenericContent({ categoryId }: { categoryId: CategoryId }) {
  const content = categoryCopy[categoryId];
  if (!content) return null;
  return (
    <article className="mx-auto max-w-4xl divide-y border-y">
      {content.sections.map((section) => (
        <DocumentSection key={section.title} title={section.title}>
          <p>{section.body}</p>
          {section.bullets && <BulletList items={section.bullets} />}
        </DocumentSection>
      ))}
    </article>
  );
}

function OverviewPanel({
  onSelect,
  categories,
  entries,
  sources,
}: {
  onSelect: (id: CategoryId) => void;
  categories: Category[];
  entries: Tables<"knowledge_base_entries">[];
  sources: Tables<"knowledge_sources">[];
}) {
  const sections = categories.filter((category) => category.id !== "overview");
  const populated = sections.filter((category) => category.status !== "Missing").length;
  const approved = sections.filter((category) => category.status === "Approved").length;
  const review = sections.filter((category) =>
    ["Needs Review", "AI Generated", "Founder Edited"].includes(category.status),
  ).length;
  const missing = sections.filter((category) => category.status === "Missing");
  const completion = Math.round((populated / Math.max(1, sections.length)) * 100);
  const recent = [...entries].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 3);
  return (
    <div className="space-y-4">
      <section className="rounded-2xl border bg-card p-5 shadow-xs md:p-7">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-muted-foreground text-sm">Company Knowledge Health</p>
            <p className="mt-2 font-semibold text-5xl tracking-tight">{completion}%</p>
            <p className="mt-2 text-muted-foreground text-sm">Complete and ready for review</p>
          </div>
          <div className="grid flex-1 gap-3 sm:grid-cols-4 md:max-w-2xl">
            <HealthMetric value={String(populated)} label="Populated" tone="text-emerald-700" />
            <HealthMetric value={String(approved)} label="Approved" tone="text-sky-700" />
            <HealthMetric value={String(review)} label="Need review" tone="text-amber-700" />
            <HealthMetric value={String(missing.length)} label="Missing signals" tone="text-zinc-700" />
          </div>
        </div>
        <Progress value={completion} className="mt-7 h-2" />
      </section>
      <section className="rounded-2xl border bg-card p-5 shadow-xs md:p-7">
        <h2 className="font-semibold text-lg">Needs attention</h2>
        <p className="mt-1 text-muted-foreground text-sm">Resolve these gaps before generating application answers.</p>
        <div className="mt-5 divide-y rounded-xl border">
          {missing.length > 0 ? missing.map((category) => (
            <AttentionRow
              key={category.id}
              title={`${category.label} is missing`}
              text={missingInformationForCategory(category.id, entries, sources)}
              action={`Add ${category.label}`}
              onClick={() => onSelect(category.id)}
            />
          )) : <p className="p-5 text-muted-foreground text-sm">All Knowledge Base sections contain founder-reviewed information.</p>}
        </div>
      </section>
      <section className="rounded-2xl border bg-card p-5 shadow-xs md:p-7">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-lg">Recently updated</h2>
            <p className="mt-1 text-muted-foreground text-sm">Latest changes to your company knowledge.</p>
          </div>
          <History className="size-5 text-orange-600" />
        </div>
        <div className="mt-5 space-y-4">
          {recent.length > 0 ? recent.map((entry) => (
            <TimelineItem
              key={entry.id}
              title={`${categoryLabel(entry.category)} updated`}
              detail={displayStatus(entry.status)}
              time={new Date(entry.updated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
            />
          )) : <p className="text-muted-foreground text-sm">No Knowledge Base changes yet.</p>}
        </div>
      </section>
    </div>
  );
}

function SourcesPanel({ sources }: { sources: Source[] }) {
  return (
    <section className="border-t py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid size-6 place-items-center rounded-md bg-zinc-100 text-zinc-500">
            <Link2 className="size-3" strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="font-medium text-sm">Sources</h2>
            <p className="text-muted-foreground text-[11px]">Evidence supporting this section.</p>
          </div>
        </div>
        <span className="text-muted-foreground text-[11px]">{sources.length} references</span>
      </div>
      <div className="mt-3 grid border-y bg-white sm:grid-cols-[repeat(auto-fit,minmax(180px,1fr))] sm:divide-x">
        {sources.map((source) => (
          <SourceCard key={`${source.type}-${source.origin}`} source={source} />
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-muted-foreground text-[10px]">
        <Info className="size-3 shrink-0" strokeWidth={1.75} />
        AI inferences remain unverified until approval.
      </div>
    </section>
  );
}

function SourceCard({ source }: { source: Source }) {
  const config = {
    Website: { icon: Globe2, className: "text-sky-600" },
    Founder: { icon: UserRound, className: "text-emerald-600" },
    "AI Inference": { icon: Bot, className: "text-violet-600" },
    Manual: { icon: FilePenLine, className: "text-orange-600" },
    "Pitch Deck": { icon: FileText, className: "text-amber-600" },
  }[source.type];
  const Icon = config.icon;
  return (
    <article className="border-b px-3 py-3 last:border-b-0 sm:border-b-0">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-zinc-50">
          <Icon className={cn("size-3.5", config.className)} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium text-xs">{source.title}</p>
            <span className="text-muted-foreground text-[9px]">{source.type}</span>
          </div>
          <p className="truncate text-muted-foreground text-[10px]">{source.origin}</p>
          <p className="mt-1.5 line-clamp-1 text-zinc-600 text-[11px]">“{source.quote}”</p>
        </div>
      </div>
    </article>
  );
}

function RegenerateDialog({
  open,
  onOpenChange,
  category,
  comparison,
  onCompare,
  current,
  onUseSuggestion,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: string;
  comparison: boolean;
  onCompare: () => void;
  current: string;
  onUseSuggestion: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Regenerate {category}</DialogTitle>
          <DialogDescription>
            AI creates a suggestion for review. Approved content is never overwritten automatically.
          </DialogDescription>
        </DialogHeader>
        {!comparison ? (
          <div className="space-y-5 pt-2">
            <div className="space-y-3 rounded-xl border p-4">
              <OptionSwitch title="Use existing sources" description="Website and founder onboarding" checked />
              <OptionSwitch title="Focus more on website content" description="Prioritize direct product language" />
              <OptionSwitch title="Keep my manual edits" description="Preserve founder-authored language" checked />
            </div>
            <div>
              <label htmlFor="ai-context" className="font-medium text-sm">
                Add additional context
              </label>
              <Textarea
                id="ai-context"
                className="mt-2 min-h-28 resize-none"
                placeholder="Tell AI what to improve..."
              />
            </div>
            <Button className="w-full bg-orange-600 hover:bg-orange-700" onClick={onCompare}>
              <RotateCcw /> Regenerate suggestion
            </Button>
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            <VersionCard label="Current version" text={current} />
            <VersionCard
              label="New suggestion"
              suggested
              text="Ambitious early-stage founders preparing multiple accelerator applications who need a trusted company narrative that stays consistent, evidence-backed, and ready to reuse."
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Keep current
              </Button>
              <Button className="bg-orange-600 hover:bg-orange-700" onClick={onUseSuggestion}>
                Use new version
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DocumentSection({
  title,
  children,
  editable = false,
}: {
  title: string;
  children: React.ReactNode;
  editable?: boolean;
}) {
  return (
    <section className={cn("group relative py-5 transition-colors", editable && "bg-orange-50/50 px-4")}>
      <div className="flex items-center gap-2">
        <h3 className="font-semibold text-sm">{title}</h3>
        {editable && (
          <Badge variant="outline" className="bg-white text-[10px]">
            Editing
          </Badge>
        )}
      </div>
      <div className="mt-3 text-zinc-700 text-sm leading-7">{children}</div>
    </section>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <Check className="mt-1 size-3.5 shrink-0 text-orange-600" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}
function StatusDot({ status }: { status: KnowledgeStatus }) {
  const color = {
    Approved: "bg-emerald-500",
    "Needs Review": "bg-amber-500",
    Missing: "border border-zinc-400 bg-transparent",
    "AI Generated": "bg-violet-500",
    "Founder Edited": "bg-sky-500",
  }[status];
  return <span className={cn("size-2 shrink-0 rounded-full", color)} />;
}
function KnowledgeStatusBadge({ status }: { status: KnowledgeStatus }) {
  const style = {
    Approved: "border-emerald-200 bg-emerald-50 text-emerald-700",
    "Needs Review": "border-amber-200 bg-amber-50 text-amber-700",
    Missing: "border-zinc-200 bg-zinc-50 text-zinc-600",
    "AI Generated": "border-violet-200 bg-violet-50 text-violet-700",
    "Founder Edited": "border-sky-200 bg-sky-50 text-sky-700",
  }[status];
  return (
    <Badge variant="outline" className={style}>
      {status === "Approved" && <Check />} {status}
    </Badge>
  );
}
function MarketMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-white/70 p-3">
      <p className="text-amber-800 text-xs">{label}</p>
      <p className="mt-1 font-semibold text-xl">{value}</p>
    </div>
  );
}
function HealthMetric({ value, label, tone }: { value: string; label: string; tone: string }) {
  return (
    <div className="rounded-xl border bg-zinc-50/60 p-4">
      <p className={cn("font-semibold text-2xl", tone)}>{value}</p>
      <p className="mt-1 text-muted-foreground text-xs">{label}</p>
    </div>
  );
}
function AttentionRow({
  title,
  text,
  action,
  onClick,
}: {
  title: string;
  text: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="mt-1 text-muted-foreground text-xs leading-5">{text}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onClick}>
        {action} <ArrowRight />
      </Button>
    </div>
  );
}
function TimelineItem({ title, detail, time }: { title: string; detail: string; time: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1.5 size-2 rounded-full bg-orange-500" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{title}</p>
        <p className="text-muted-foreground text-xs">{detail}</p>
      </div>
      <span className="text-muted-foreground text-xs">{time}</span>
    </div>
  );
}
function OptionSwitch({
  title,
  description,
  checked = false,
}: {
  title: string;
  description: string;
  checked?: boolean;
}) {
  const [active, setActive] = useState(checked);
  return (
    <div className="flex items-center justify-between gap-4">
      <span>
        <span className="block font-medium text-sm">{title}</span>
        <span className="text-muted-foreground text-xs">{description}</span>
      </span>
      <Switch aria-label={title} checked={active} onCheckedChange={setActive} />
    </div>
  );
}
function VersionCard({ label, text, suggested = false }: { label: string; text: string; suggested?: boolean }) {
  return (
    <div className={cn("rounded-xl border p-4", suggested && "border-orange-200 bg-orange-50/50")}>
      <div className="flex items-center justify-between">
        <p className="font-medium text-sm">{label}</p>
        {suggested && (
          <Badge className="bg-orange-100 text-orange-700">
            <Bot /> AI suggestion
          </Badge>
        )}
      </div>
      <p className="mt-3 text-sm leading-7">{text}</p>
    </div>
  );
}

function databaseCategory(id: CategoryId): Tables<"knowledge_base_entries">["category"] {
  return id.replaceAll("-", "_") as Tables<"knowledge_base_entries">["category"];
}

function categoryLabel(category: Tables<"knowledge_base_entries">["category"]) {
  return initialCategories.find((item) => item.id === category.replaceAll("_", "-"))?.label ?? category;
}

function displayStatus(status: Tables<"knowledge_base_entries">["status"]): KnowledgeStatus {
  return {
    approved: "Approved",
    needs_review: "Needs Review",
    missing: "Missing",
    generated: "AI Generated",
    founder_edited: "Founder Edited",
  }[status] as KnowledgeStatus;
}

function sourceView(source: Tables<"knowledge_sources">): Source {
  const type = {
    website: "Website",
    founder: "Founder",
    ai_inferred: "AI Inference",
    manual: "Manual",
    pitch_deck: "Pitch Deck",
  }[source.source_type] as Source["type"];
  return {
    type,
    title: source.source_label ?? type,
    origin: source.source_url ?? "Source record",
    quote: source.excerpt ?? "No excerpt available",
    detail: "Stored source evidence",
  };
}

function missingInformationForCategory(
  categoryId: CategoryId,
  entries: Tables<"knowledge_base_entries">[],
  sources: Tables<"knowledge_sources">[],
) {
  const entry = entries.find((item) => item.category === databaseCategory(categoryId));
  if (!entry) return "No verified founder or source-supported information is available for this section.";
  const missing = sources
    .filter((source) => source.knowledge_entry_id === entry.id)
    .flatMap((source) => {
      const metadata = source.metadata;
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
      const values = metadata.missingInformation;
      return Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
    });
  return missing.length > 0
    ? `Founder input needed: ${missing.slice(0, 3).join(" · ")}`
    : "No verified founder or source-supported information is available for this section.";
}

function RawSource({
  icon: Icon,
  title,
  detail,
  status,
}: {
  icon: typeof Globe2;
  title: string;
  detail: string;
  status: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border p-4">
      <div className="grid size-10 place-items-center rounded-lg bg-zinc-100">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{title}</p>
        <p className="text-muted-foreground text-xs">{detail}</p>
      </div>
      <Badge variant="outline">{status}</Badge>
    </div>
  );
}
