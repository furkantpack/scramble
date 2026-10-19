import type { Metadata } from "next";

import Link from "next/link";

import {
  ArrowUpRight,
  Bell,
  Building2,
  Check,
  FileText,
  LockKeyhole,
  Settings,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getWorkspaceContext } from "@/lib/supabase/context";

import { FounderRouteShell } from "../_components/founder-route-shell";

export const metadata: Metadata = {
  title: "Settings - Scramble",
  description: "Manage your Scramble workspace, company sources, and application preferences.",
};

const navigation = [
  { label: "Account & workspace", href: "#account", icon: UserRound },
  { label: "Company intelligence", href: "#intelligence", icon: Sparkles },
  { label: "Application safety", href: "#applications", icon: ShieldCheck },
  { label: "Notifications", href: "#notifications", icon: Bell },
];

export default async function Page() {
  const { supabase, workspaceId, user, membership, founderProfile, company } = await getWorkspaceContext({
    requireOnboarding: true,
  });
  if (!founderProfile || !company) throw new Error("Founder workspace is unavailable");

  const { data: deck } = await supabase
    .from("company_assets")
    .select("file_name,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("company_id", company.id)
    .eq("type", "pitch_deck")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const founderName = [founderProfile.first_name, founderProfile.last_name].filter(Boolean).join(" ");
  const stage = company.stage.replaceAll("_", " ");

  return (
    <FounderRouteShell
      eyebrow="Settings"
      title="Your workspace, your rules."
      description="Keep your startup information current and choose how Scramble supports each application."
      icon={Settings}
      action={
        <Button asChild className="bg-orange-600 hover:bg-orange-700">
          <Link href="/profile">
            Edit company profile <ArrowUpRight />
          </Link>
        </Button>
      }
    >
      <div className="mt-10 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border bg-white p-2 shadow-xs lg:sticky lg:top-6">
          <p className="px-3 pb-2 pt-3 font-medium text-muted-foreground text-xs uppercase tracking-wider">Settings</p>
          <nav className="space-y-1" aria-label="Settings sections">
            {navigation.map((item, index) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-zinc-50 ${
                    index === 0 ? "bg-orange-50 font-medium text-orange-700" : "text-zinc-600"
                  }`}
                >
                  <Icon className="size-4" /> {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="space-y-6">
          <SettingsSection
            id="account"
            icon={UserRound}
            title="Account & workspace"
            description="The identity connected to this founder workspace."
          >
            <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-6">
              <InfoField label="Founder" value={founderName || "Founder"} />
              <InfoField label="Email" value={user.email ?? "No email available"} />
              <InfoField label="Company" value={company.name} />
              <InfoField label="Workspace role" value={membership.role === "owner" ? "Owner" : "Member"} />
            </div>
          </SettingsSection>

          <SettingsSection
            id="intelligence"
            icon={Sparkles}
            title="Company intelligence"
            description="Scramble uses these sources to prepare relevant, consistent answers."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href="/knowledge-base">Open knowledge base</Link>
              </Button>
            }
          >
            <div className="divide-y">
              <SourceRow
                icon={Building2}
                title="Company profile"
                detail={`${company.name} · ${stage}`}
                status={company.profile_confirmed_at ? "Founder approved" : "Review needed"}
                statusTone={company.profile_confirmed_at ? "ready" : "attention"}
                href="/profile"
              />
              <SourceRow
                icon={FileText}
                title="Pitch deck"
                detail={deck?.file_name ?? "No pitch deck uploaded"}
                status={deck ? "Connected" : "Optional"}
                statusTone={deck ? "ready" : "neutral"}
                href="/profile/deck"
              />
              <SourceRow
                icon={Sparkles}
                title="Company website"
                detail={company.website_url ?? "No website connected"}
                status={company.website_url ? "Connected" : "Optional"}
                statusTone={company.website_url ? "ready" : "neutral"}
                href="/profile"
              />
            </div>
          </SettingsSection>

          <SettingsSection
            id="applications"
            icon={ShieldCheck}
            title="Application safety"
            description="These guardrails apply whenever Scramble helps with an application."
          >
            <div className="divide-y">
              <PreferenceRow
                title="Use founder-approved information only"
                description="Drafts are grounded in your confirmed profile and reviewed knowledge base."
                label="Always on"
              />
              <PreferenceRow
                title="Review before submission"
                description="You see the completed application before anything is sent externally."
                label="Required"
              />
              <PreferenceRow
                title="Automatic submission"
                description="No application is submitted without explicit approval for that application."
                label="Off by default"
                muted
              />
            </div>
            <div className="flex gap-3 border-t bg-emerald-50/60 px-5 py-4 text-emerald-900 text-sm sm:px-6">
              <LockKeyhole className="mt-0.5 size-4 shrink-0" />
              <p>Your private deck and application answers remain scoped to this workspace.</p>
            </div>
          </SettingsSection>

          <SettingsSection
            id="notifications"
            icon={Bell}
            title="Notifications"
            description="A lightweight summary of the updates Scramble will surface in the product."
          >
            <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
              <NotificationCard title="Application updates" description="Status changes, review requests, and submission results." />
              <NotificationCard title="New program matches" description="Relevant accelerator opportunities and approaching deadlines." />
            </div>
            <p className="border-t px-5 py-4 text-muted-foreground text-xs sm:px-6">
              Email notification controls will appear here when outbound notifications are enabled.
            </p>
          </SettingsSection>
        </div>
      </div>
    </FounderRouteShell>
  );
}

function SettingsSection({
  id,
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  id: string;
  icon: typeof Settings;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 overflow-hidden rounded-2xl border bg-white shadow-xs">
      <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-700">
            <Icon className="size-5" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">{title}</h2>
            <p className="mt-0.5 text-muted-foreground text-sm">{description}</p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-zinc-50/70 px-4 py-3.5">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 truncate font-medium text-sm" title={value}>
        {value}
      </p>
    </div>
  );
}

function SourceRow({
  icon: Icon,
  title,
  detail,
  status,
  statusTone,
  href,
}: {
  icon: typeof Settings;
  title: string;
  detail: string;
  status: string;
  statusTone: "ready" | "attention" | "neutral";
  href: string;
}) {
  const badgeClass =
    statusTone === "ready"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : statusTone === "attention"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "bg-zinc-50 text-zinc-500";

  return (
    <Link href={href} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-zinc-50/80 sm:px-6">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg border bg-white text-zinc-500">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{title}</p>
        <p className="mt-0.5 truncate text-muted-foreground text-xs">{detail}</p>
      </div>
      <Badge variant="outline" className={badgeClass}>
        {status}
      </Badge>
      <ArrowUpRight className="size-4 text-zinc-300 transition-colors group-hover:text-orange-600" />
    </Link>
  );
}

function PreferenceRow({
  title,
  description,
  label,
  muted = false,
}: {
  title: string;
  description: string;
  label: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-start gap-4 px-5 py-4 sm:px-6">
      <div
        className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${
          muted ? "bg-zinc-100 text-zinc-500" : "bg-emerald-50 text-emerald-700"
        }`}
      >
        {muted ? <LockKeyhole className="size-3.5" /> : <Check className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{title}</p>
        <p className="mt-1 text-muted-foreground text-xs leading-5">{description}</p>
      </div>
      <Badge variant="outline" className="hidden sm:inline-flex">
        {label}
      </Badge>
    </div>
  );
}

function NotificationCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex gap-3 rounded-xl border p-4">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-orange-50 text-orange-700">
        <Check className="size-4" />
      </div>
      <div>
        <p className="font-medium text-sm">{title}</p>
        <p className="mt-1 text-muted-foreground text-xs leading-5">{description}</p>
      </div>
    </div>
  );
}
