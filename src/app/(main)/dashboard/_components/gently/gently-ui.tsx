import type { ReactNode } from "react";

import Link from "next/link";

import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl space-y-2">
        <div className="font-medium text-orange-600 text-sm">{eyebrow}</div>
        <h1 className="font-semibold text-3xl tracking-tight md:text-4xl">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  delta,
  accent = "orange",
  note,
  valueClassName,
}: {
  label: string;
  value: string;
  delta: string;
  accent?: "orange" | "green" | "blue" | "violet";
  note?: string;
  valueClassName?: string;
}) {
  const accents = {
    orange: "bg-orange-500",
    green: "bg-emerald-500",
    blue: "bg-sky-500",
    violet: "bg-violet-500",
  };

  return (
    <Card className="overflow-hidden rounded-2xl border-zinc-200 shadow-xs">
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardDescription>{label}</CardDescription>
          <CardTitle className={cn("mt-2 font-semibold text-3xl", valueClassName)}>{value}</CardTitle>
        </div>
        <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-700 text-xs">{delta}</span>
      </CardHeader>
      <CardContent>
        <div className="h-2 rounded-full bg-zinc-100">
          <div className={cn("h-2 w-2/3 rounded-full", accents[accent])} />
        </div>
        {note ? <p className="mt-3 text-muted-foreground text-xs">{note}</p> : null}
      </CardContent>
    </Card>
  );
}

export function SectionCard({
  title,
  description,
  children,
  actionHref,
  actionLabel,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  actionHref?: string;
  actionLabel?: string;
  className?: string;
}) {
  return (
    <Card className={cn("rounded-2xl border-zinc-200 shadow-xs", className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription className="mt-1">{description}</CardDescription> : null}
        </div>
        {actionHref && actionLabel ? (
          <Button asChild size="sm" variant="outline">
            <Link prefetch={false} href={actionHref}>
              {actionLabel}
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function RibbonMark({ className }: { className?: string }) {
  return (
    <div className={cn("relative size-10 overflow-hidden rounded-full bg-orange-100", className)}>
      <div className="absolute top-2 -left-3 h-5 w-16 rotate-[-28deg] rounded-full bg-orange-500" />
      <div className="absolute top-1 -right-4 h-5 w-16 rotate-[34deg] rounded-full bg-amber-300" />
      <div className="absolute top-5 left-2 h-5 w-12 rotate-[20deg] rounded-full bg-violet-500" />
    </div>
  );
}
