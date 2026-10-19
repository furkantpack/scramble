import Link from "next/link";

import { ArrowRight, Bell, BookOpenCheck, Check, CheckCircle2, CircleAlert, Compass, FileText } from "lucide-react";

import { AcceleratorLogo } from "@/app/(external)/(scouter-founder-routes)/introductions/accelerator-logo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

import { PageHeader, SectionCard } from "../gently/gently-ui";
import type { DashboardView } from "./founder-dashboard-model";

const actionTone = {
  amber: "bg-amber-100 text-amber-700",
  sky: "bg-sky-100 text-sky-700",
  violet: "bg-violet-100 text-violet-700",
};

export function FounderDashboard({ data }: { data: DashboardView }) {
  const summary = [
    { label: "Applications", value: data.summary.applications, detail: `${data.summary.active} active`, note: "Accelerator and startup program applications", icon: BookOpenCheck },
    { label: "Drafts", value: data.summary.drafts, detail: "Needs preparation", note: "Applications that still need work", icon: FileText },
    { label: "Submitted", value: data.summary.submitted, detail: `${data.summary.confirmed} confirmed`, note: "Applications actually submitted", icon: CheckCircle2 },
    { label: "Notifications", value: data.summary.notifications, detail: data.summary.notifications ? "Unread" : "All caught up", note: "Workspace updates", icon: Bell },
  ];
  const pipeline = [
    { label: "Found", value: data.pipeline.found, hint: "Programs in marketplace" },
    { label: "Preparing", value: data.pipeline.preparing, hint: "Work in progress" },
    { label: "Ready to submit", value: data.pipeline.ready, hint: "Final approval needed" },
    { label: "Submitted", value: data.pipeline.submitted, hint: "Sent to program" },
    { label: "Completed", value: data.pipeline.completed, hint: "Outcome not tracked yet" },
  ];
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`Welcome back, ${data.firstName}.`}
        title="Your application workspace"
        description="Find relevant programs, prepare applications and keep everything moving from one place."
        action={data.summary.applications > 0 ? (
          <Button asChild className="bg-orange-600 hover:bg-orange-700">
            <Link prefetch={false} href={data.primaryAction.href}>{data.primaryAction.label}<ArrowRight /></Link>
          </Button>
        ) : undefined}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summary.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs">
              <div className="flex items-start justify-between gap-3">
                <p className="text-muted-foreground text-sm">{item.label}</p>
                <Icon className="size-4 text-orange-600" strokeWidth={1.8} />
              </div>
              <p className="mt-3 font-semibold text-3xl tabular-nums tracking-tight">{item.value}</p>
              <p className="mt-2 font-medium text-sm text-zinc-700">{item.detail}</p>
              <p className="mt-1 text-muted-foreground text-xs">{item.note}</p>
            </div>
          );
        })}
      </div>

      {data.summary.applications === 0 ? (
        <section className="rounded-2xl bg-zinc-950 p-6 text-white md:p-7">
          <div className="max-w-2xl">
            <p className="flex items-center gap-2 text-orange-300 text-sm"><Compass className="size-4" strokeWidth={1.8} /> Next step</p>
            <h2 className="mt-3 font-semibold text-2xl">Let&apos;s find your first opportunities.</h2>
            <p className="mt-2 text-sm leading-6 text-zinc-300">
              Scouter can use your founder profile, company, stage{data.needsCount ? ", current needs" : ""}{data.sources[2]?.status === "Ready" ? ", website" : ""}{data.sources[3]?.status === "Ready" ? ", and pitch deck" : ""} to help you explore accelerator and startup programs.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild className="bg-orange-600 hover:bg-orange-700"><Link prefetch={false} href={data.primaryAction.href}>{data.primaryAction.label}<ArrowRight /></Link></Button>
              <Button asChild variant="outline" className="border-white/20 bg-white/5 text-white hover:bg-white/10 hover:text-white"><Link prefetch={false} href="/profile">Review my profile</Link></Button>
            </div>
          </div>
        </section>
      ) : (
        <section className="rounded-2xl bg-zinc-950 p-6 text-white md:p-7">
          <div>
            <h2 className="font-semibold text-xl">Your application pipeline</h2>
            <p className="mt-1 text-sm text-zinc-400">Applications currently moving through your workspace.</p>
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-5">
            {pipeline.map((stage, index) => (
              <div key={stage.label} className="relative rounded-xl border border-white/10 bg-white/5 px-4 py-4">
                <p className="text-sm text-zinc-300">{stage.label}</p>
                <p className="mt-3 font-semibold text-3xl tabular-nums">{stage.value}</p>
                <p className="mt-1 text-[11px] text-zinc-400">{stage.hint}</p>
                {index < pipeline.length - 1 && <ArrowRight className="absolute top-1/2 -right-3 z-10 hidden size-4 -translate-y-1/2 text-orange-300 sm:block" />}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[1.02fr_0.98fr]">
        <SectionCard title="What needs your attention" description="A few things that will help move your applications forward.">
          {data.actions.length ? (
            <div className="space-y-2.5">
              {data.actions.map((action) => (
                <Link key={`${action.title}:${action.href}`} prefetch={false} href={action.href} className="flex items-center gap-3 rounded-xl border bg-zinc-50 p-3.5 transition-colors hover:bg-zinc-100">
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", actionTone[action.tone])}><CircleAlert className="size-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block font-medium text-sm">{action.title}</span><span className="mt-1 block text-muted-foreground text-xs">{action.description}</span></span>
                  <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              ))}
            </div>
          ) : <p className="py-7 text-center text-muted-foreground text-sm">Nothing needs your input right now.</p>}
        </SectionCard>

        <SectionCard title="Your opportunities" description="Programs in the marketplace you can explore." actionHref="/introductions" actionLabel="View all">
          {data.opportunities.length ? (
            <div className="divide-y">
              {data.opportunities.map((program) => (
                <Link key={program.id} prefetch={false} href={program.href} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
                  <AcceleratorLogo logoUrl={program.logoUrl ?? ""} initials={program.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()} accent="bg-orange-50 text-orange-700" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-sm">{program.name}</span>
                    <span className="mt-0.5 block text-muted-foreground text-xs">{program.type} · {program.stage}</span>
                    <span className="mt-1 block text-muted-foreground text-xs">{program.geography} · {program.deadline}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge variant="outline" className="font-normal text-[10px]">{program.status}</Badge>
                    {program.relevance && <span className="text-[10px] text-emerald-700">{program.relevance}</span>}
                  </span>
                </Link>
              ))}
            </div>
          ) : <p className="py-7 text-center text-muted-foreground text-sm">No open programs are available in the marketplace yet.</p>}
        </SectionCard>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title="What we know about you" description="The information Scouter uses to prepare your applications.">
          <div className="grid gap-2.5 sm:grid-cols-2">
            {data.sources.map((source) => (
              <Link key={source.title} href={source.href} prefetch={false} className="rounded-xl border p-3.5 transition-colors hover:bg-zinc-50">
                <div className="flex items-center justify-between gap-2"><span className="font-medium text-sm">{source.title}</span><span className={cn("text-[11px]", source.status === "Ready" ? "text-emerald-700" : "text-amber-700")}>{source.status}</span></div>
                <p className="mt-2 text-muted-foreground text-xs">{source.detail}</p>
              </Link>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Application readiness" description="How prepared Scouter is to work on your applications.">
          <div className="divide-y">
            {data.readiness.map((item) => (
              <div key={item.title} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                <span className="text-sm">{item.title}</span><span className={cn("text-sm", item.ready ? "font-medium text-emerald-700" : "text-muted-foreground")}>{item.value}</span>
              </div>
            ))}
          </div>
          <p className="mt-5 text-muted-foreground text-xs">Application access is not scored until a connection is recorded.</p>
        </SectionCard>
      </div>

      <SectionCard title="Application knowledge" description="How ready your company information is for applications." actionHref="/knowledge-base" actionLabel="Review knowledge">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-semibold text-xl">{data.readyKnowledge} / 9 <span className="font-normal text-muted-foreground text-sm">sections approved</span></p>
          <p className="text-muted-foreground text-xs">{data.knowledgeSourceCount} source links recorded</p>
        </div>
        <Progress value={Math.round((data.readyKnowledge / 9) * 100)} className="mt-4 h-1.5 [&_[data-slot=progress-indicator]]:bg-orange-500" />
        <div className="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.knowledge.map((item) => (
            <Link key={item.category} href={`/knowledge-base?section=${item.category.replaceAll("_", "-")}`} prefetch={false} className="flex items-center justify-between gap-3 text-sm hover:text-orange-700">
              <span>{item.label}</span><span className={cn("text-xs", item.status === "Ready" ? "text-emerald-700" : item.status === "Needs review" ? "text-amber-700" : "text-muted-foreground")}>{item.status}</span>
            </Link>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Recent activity" description="The latest activity across your applications and company profile.">
        {data.activity.length ? (
          <div className="divide-y">
            {data.activity.map((item, index) => (
              <Link key={`${item.title}:${item.time}:${index}`} href={item.href} prefetch={false} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                <span className="min-w-0 flex-1"><span className="block font-medium text-sm">{item.title}</span><span className="mt-1 block text-muted-foreground text-xs">{item.subtitle}</span></span>
                <time className="shrink-0 text-muted-foreground text-xs" dateTime={item.time}>{new Date(item.time).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })}</time>
              </Link>
            ))}
          </div>
        ) : <p className="py-7 text-center text-muted-foreground text-sm">No application or company activity has been recorded yet.</p>}
      </SectionCard>
    </div>
  );
}
