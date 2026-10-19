"use client";

import { useMemo, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Check,
  CheckCircle2,
  CircleHelp,
  type Clock3,
  FileQuestion,
  HandCoins,
  MapPin,
  Search,
  ShieldCheck,
  Target,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { PageIntro } from "../_components/founder-ui";
import { AcceleratorApplicationDrawer } from "./accelerator-application-drawer";
import { AcceleratorLogo } from "./accelerator-logo";

type MarketplaceTab = "All" | "Best matches" | "Closing soon" | "Rolling" | "My applications";
type DeadlineState = "Closes soon" | "Open" | "Rolling" | "Upcoming" | "Closed";
type ApplicationStatus = "Not started" | "Draft" | "Agent working" | "Review" | "Submitting" | "Submitted" | "Needs verification" | "Failed";
type EligibilityState = "eligible" | "issue" | "unknown";

export type Accelerator = {
  id: string;
  initials: string;
  logoUrl: string;
  name: string;
  organization?: string;
  description?: string;
  location: string;
  type: "Accelerator" | "Incubator" | "Grant" | "Venture Program" | "Corporate Program" | "Program";
  accent: string;
  match?: number;
  matchReasons: string[];
  gaps: string[];
  tags: string[];
  deadline?: string;
  deadlineDate?: string;
  deadlineState: DeadlineState;
  offer?: string;
  equity?: string;
  effort: string;
  applicationStatus: ApplicationStatus;
  rawApplicationStatus?: string;
  applicationRecordId?: string;
  website: string;
  websiteUrl?: string;
  sourceUrls?: string[];
  applicationUrl: string;
  program: {
    location: string;
    format: string;
    duration: string;
    cohort: string;
    starts: string;
  };
  terms: { label: string; value: string }[];
  criteria: { label: string; value: string }[];
  thesis: string[];
  eligibility: { label: string; value?: string; state: EligibilityState }[];
  benefits: string[];
  application: {
    questions: number;
    estimate: string;
    format: string;
    materials: string[];
    ready: number;
    missing: string[];
  };
  alumni: { name: string; category: string; initials: string }[];
  verified: string;
};

const tabs: MarketplaceTab[] = ["All", "Best matches", "Closing soon", "Rolling", "My applications"];

export function InterviewLibrary({ accelerators, loadError = false, initialProgramId }: { accelerators: Accelerator[]; loadError?: boolean; initialProgramId?: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [activeTab, setActiveTab] = useState<MarketplaceTab>("All");
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [selected, setSelected] = useState<Accelerator | null>(() => accelerators.find((item) => item.id === initialProgramId) ?? null);

  const visible = useMemo(() => {
    return accelerators.filter((accelerator) => {
      const matchesQuery = `${accelerator.name} ${accelerator.organization ?? ""} ${accelerator.tags.join(" ")}`
        .toLowerCase()
        .includes(query.toLowerCase());
      const matchesStage = stage === "all" || accelerator.tags.some((tag) => tag.toLowerCase() === stage);
      const matchesTab =
        activeTab === "All" ||
        (activeTab === "Best matches" && accelerator.match !== undefined && accelerator.match >= 85) ||
        (activeTab === "Closing soon" && accelerator.deadlineState === "Closes soon") ||
        (activeTab === "Rolling" && accelerator.deadlineState === "Rolling") ||
        (activeTab === "My applications" && accelerator.applicationStatus !== "Not started");
      return matchesQuery && matchesStage && matchesTab;
    });
  }, [activeTab, query, stage, accelerators]);

  return (
    <div className="flex flex-col gap-6">
      <PageIntro
        eyebrow="Accelerator marketplace"
        title="Find the right program. Apply with confidence."
        description="Discover accelerator programs matched to your company, understand eligibility and terms, and see how ready you are to apply."
        action={
          <Button
            variant="outline"
            onClick={() =>
              toast("Marketplace data refreshed", {
                description: "Deadlines and terms were checked against available program sources.",
              })
            }
          >
            <BadgeCheck /> Verify program data
          </Button>
        }
      />

      <section className="rounded-2xl border bg-card p-3 shadow-xs">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Accelerator filters">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "shrink-0 rounded-xl px-3.5 py-2 font-medium text-sm transition-colors",
                  activeTab === tab
                    ? "bg-zinc-950 text-white"
                    : "text-muted-foreground hover:bg-zinc-50 hover:text-zinc-950",
                )}
              >
                {tab} <span className="ml-1 text-xs opacity-60">{tabCount(tab, accelerators)}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1 xl:w-60">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search programs…"
                className="pl-9"
              />
            </div>
            <Select value={stage} onValueChange={setStage}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All stages</SelectItem>
                <SelectItem value="pre-seed">Pre-Seed</SelectItem>
                <SelectItem value="seed">Seed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">{visible.length} programs</span> matched to your company profile
        </p>
        <p className="hidden items-center gap-1.5 text-muted-foreground sm:flex">
          <ShieldCheck className="size-4 text-emerald-600" /> Facts are source-labeled and regularly verified
        </p>
      </div>

      {loadError ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50/60 p-10 text-center">
          <AlertTriangle className="mx-auto size-6 text-rose-600" />
          <h2 className="mt-4 font-semibold">Programs could not be loaded</h2>
          <p className="mt-1 text-muted-foreground text-sm">Check your connection and try loading the marketplace again.</p>
          <Button
            className="mt-5"
            variant="outline"
            disabled={refreshing}
            onClick={() => startRefresh(() => router.refresh())}
          >
            {refreshing ? "Retrying…" : "Retry"}
          </Button>
        </section>
      ) : visible.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((accelerator) => (
            <AcceleratorCard key={accelerator.id} accelerator={accelerator} onOpen={() => setSelected(accelerator)} />
          ))}
        </div>
      ) : (
        <section className="rounded-2xl border border-dashed bg-zinc-50 p-10 text-center">
          <Search className="mx-auto size-6 text-muted-foreground" />
          <h2 className="mt-4 font-semibold">
            {accelerators.length === 0 ? "No programs available yet" : "No matching programs"}
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">
            {accelerators.length === 0
              ? "New accelerator and funding opportunities will appear here as they are verified."
              : "Try another stage or search term."}
          </p>
        </section>
      )}

      <section className="grid gap-6 rounded-2xl bg-zinc-950 p-6 text-white shadow-xs md:grid-cols-[1fr_auto] md:items-center md:p-7">
        <div>
          <p className="flex items-center gap-2 text-orange-400 text-sm">
            <ShieldCheck className="size-4" strokeWidth={1.8} /> Knowledge-powered applications
          </p>
          <h2 className="mt-2 font-semibold text-xl">Your best applications start with verified company context.</h2>
          <p className="mt-2 max-w-2xl text-sm text-zinc-400">
            Complete missing Knowledge Base signals once, then reuse them across every accelerator application.
          </p>
        </div>
        <Button asChild className="bg-orange-600 hover:bg-orange-700">
          <a href="/knowledge-base">
            Review Knowledge Base <ArrowRight />
          </a>
        </Button>
      </section>

      <Sheet open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="!w-full !max-w-none lg:!w-[62vw] xl:!w-[60vw] overflow-y-auto p-0">
          {selected && <AcceleratorApplicationDrawer key={selected.id} accelerator={selected} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function AcceleratorCard({ accelerator, onOpen }: { accelerator: Accelerator; onOpen: () => void }) {
  return (
    <article className="group flex min-h-[420px] flex-col rounded-2xl border bg-card p-5 shadow-xs transition-[border-color,box-shadow] hover:border-zinc-300 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <AcceleratorLogo logoUrl={accelerator.logoUrl} initials={accelerator.initials} accent={accelerator.accent} />
        {accelerator.match !== undefined && (
          <Badge
            variant="outline"
            className="shrink-0 gap-1 border-orange-200 bg-orange-50 px-2 py-1 font-medium text-[11px] text-orange-700"
          >
            <Target className="size-3" /> {accelerator.match}% Match
          </Badge>
        )}
      </div>

      <div className="mt-3 min-w-0">
        <h2 className="line-clamp-1 font-semibold leading-6">{accelerator.name}</h2>
        {accelerator.organization && (
          <p className="mt-0.5 line-clamp-1 text-muted-foreground text-xs">{accelerator.organization}</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-xs">
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="size-3.5" /> {accelerator.location}
        </span>
        <span className="text-zinc-300">•</span>
        <span>{accelerator.type}</span>
      </div>

      {accelerator.description && (
        <p className="mt-4 line-clamp-2 text-muted-foreground text-xs leading-5">{accelerator.description}</p>
      )}

      <div className="mt-4 flex flex-wrap gap-1.5 border-b pb-4">
        {accelerator.tags.slice(0, 3).map((tag) => (
          <Badge key={tag} variant="outline" className="border-zinc-200 bg-transparent font-normal text-[11px]">
            {tag}
          </Badge>
        ))}
        {accelerator.tags.length > 3 && (
          <Badge variant="outline" className="border-zinc-200 bg-zinc-50 font-normal text-[11px] text-muted-foreground">
            +{accelerator.tags.length - 3}
          </Badge>
        )}
      </div>

      <div className="mt-1 divide-y">
        {accelerator.deadline && (
          <CardFact
            icon={CalendarClock}
            label={accelerator.deadline}
            urgent={accelerator.deadlineState === "Closes soon"}
            badge={accelerator.deadlineState}
          />
        )}
        {accelerator.offer && <CardFact icon={HandCoins} label={accelerator.offer} detail={accelerator.equity} />}
        <CardFact icon={FileQuestion} label="Application" detail={accelerator.effort} />
      </div>

      <Button
        onClick={onOpen}
        className={cn(
          "mt-auto w-full transition-colors",
          accelerator.applicationStatus !== "Submitted" && "bg-orange-600 hover:bg-orange-700",
        )}
        variant={accelerator.applicationStatus === "Submitted" ? "outline" : "default"}
      >
        {ctaLabel(accelerator.applicationStatus)} <ArrowRight />
      </Button>
    </article>
  );
}

function CardFact({
  icon: Icon,
  label,
  detail,
  urgent,
  badge,
}: {
  icon: typeof Clock3;
  label: string;
  detail?: string;
  urgent?: boolean;
  badge?: DeadlineState;
}) {
  return (
    <div className="flex items-center gap-3 py-2.5 text-sm">
      <Icon className={cn("size-3.5 shrink-0", urgent ? "text-rose-600" : "text-zinc-400")} />
      <div className="min-w-0 flex-1">
        <p className={cn("truncate font-medium text-[13px]", urgent && "text-rose-700")}>{label}</p>
        {detail && <p className="mt-0.5 truncate text-muted-foreground text-xs">{detail}</p>}
      </div>
      {badge && <DeadlineBadge state={badge} label={badge} compact />}
    </div>
  );
}

function DeadlineBadge({ state, label, compact = false }: { state: DeadlineState; label: string; compact?: boolean }) {
  const style = {
    "Closes soon": "border-rose-200 bg-rose-50 text-rose-700",
    Open: "border-emerald-200 bg-emerald-50 text-emerald-700",
    Rolling: "border-sky-200 bg-sky-50 text-sky-700",
    Upcoming: "border-violet-200 bg-violet-50 text-violet-700",
    Closed: "border-zinc-200 bg-zinc-100 text-zinc-600",
  }[state];
  return (
    <Badge variant="outline" className={cn(style, compact && "text-[10px]")}>
      {label}
    </Badge>
  );
}

function _DrawerSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Target;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 border-b pb-6 last:border-0">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-lg bg-zinc-100">
          <Icon className="size-4" />
        </span>
        <h3 className="font-semibold text-lg">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function _ReasonList({ items, tone }: { items: string[]; tone: "positive" | "warning" | "neutral" }) {
  const Icon = tone === "positive" ? CheckCircle2 : tone === "warning" ? AlertTriangle : Check;
  const color = tone === "positive" ? "text-emerald-600" : tone === "warning" ? "text-amber-600" : "text-zinc-500";
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2 text-sm leading-6">
          <Icon className={cn("mt-1 size-3.5 shrink-0", color)} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function _FactGrid({ facts }: { facts: string[][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {facts.map(([label, value]) => (
        <div key={label}>
          <dt className="text-muted-foreground text-xs">{label}</dt>
          <dd className="mt-1 font-medium text-sm">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function _EligibilityRow({ item }: { item: { label: string; state: EligibilityState } }) {
  const config = {
    eligible: { icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-50" },
    issue: { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-50" },
    unknown: { icon: CircleHelp, color: "text-zinc-500", bg: "bg-zinc-50" },
  }[item.state];
  const Icon = config.icon;
  return (
    <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm", config.bg)}>
      <Icon className={cn("size-4 shrink-0", config.color)} /> {item.label}
    </div>
  );
}

function ctaLabel(status: ApplicationStatus) {
  if (status === "Draft") return "Continue Application";
  if (status === "Agent working") return "Agent Working";
  if (status === "Review") return "Review Application";
  if (status === "Submitting") return "Submitting";
  if (status === "Submitted") return "View Application";
  if (status === "Needs verification") return "Check Submission";
  if (status === "Failed") return "Review Issue";
  return "Start Application";
}

function tabCount(tab: MarketplaceTab, accelerators: Accelerator[]) {
  if (tab === "Best matches") return accelerators.filter((item) => item.match !== undefined && item.match >= 85).length;
  if (tab === "Closing soon") return accelerators.filter((item) => item.deadlineState === "Closes soon").length;
  if (tab === "Rolling") return accelerators.filter((item) => item.deadlineState === "Rolling").length;
  if (tab === "My applications") return accelerators.filter((item) => item.applicationStatus !== "Not started").length;
  return accelerators.length;
}
