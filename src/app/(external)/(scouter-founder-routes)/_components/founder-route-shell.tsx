import type { ReactNode } from "react";

import Link from "next/link";

import { ArrowLeft, ArrowRight, type LucideIcon } from "lucide-react";

import { ScrambleLogo } from "@/components/branding/scramble-logo";

export function FounderRouteShell({
  eyebrow,
  title,
  description,
  icon: Icon,
  children,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: LucideIcon;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-zinc-50">
      <header className="border-b bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/dashboard/founder-dashboard" className="flex items-center gap-2 font-semibold">
            <ScrambleLogo markClassName="h-7" wordmarkClassName="text-xl" />
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-5 py-10 md:py-14">
        <Link
          href="/dashboard/founder-dashboard"
          className="inline-flex items-center gap-1.5 text-muted-foreground text-sm hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Founder dashboard
        </Link>
        <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="flex items-center gap-2 font-medium text-orange-600 text-sm">
              <Icon className="size-4" /> {eyebrow}
            </p>
            <h1 className="mt-3 font-semibold text-3xl tracking-tight md:text-4xl">{title}</h1>
            <p className="mt-3 text-muted-foreground">{description}</p>
          </div>
          {action}
        </div>
        {children ?? (
          <section className="mt-10 rounded-2xl border bg-white p-6 shadow-xs md:p-8">
            <p className="font-medium">This Scramble workspace is ready for the next product pass.</p>
            <p className="mt-2 max-w-2xl text-muted-foreground text-sm">
              The route is active and connected to the founder dashboard. Live data can replace this local state later.
            </p>
            <Link
              href="/dashboard/founder-dashboard"
              className="mt-6 inline-flex items-center gap-1 text-orange-600 text-sm"
            >
              Return to dashboard <ArrowRight className="size-4" />
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
