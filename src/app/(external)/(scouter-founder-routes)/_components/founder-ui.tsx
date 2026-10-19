import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function PageIntro({
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
      <div className="max-w-3xl">
        <div className="font-medium text-orange-600 text-sm">{eyebrow}</div>
        <h1 className="mt-2 font-semibold text-3xl tracking-tight md:text-4xl">{title}</h1>
        <p className="mt-2 text-muted-foreground leading-7">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function MiniMetric({
  label,
  value,
  note,
  accent = "bg-orange-500",
}: {
  label: string;
  value: string;
  note: string;
  accent?: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-xs">
      <div className="text-muted-foreground text-sm">{label}</div>
      <div className="mt-2 font-semibold text-3xl tracking-tight">{value}</div>
      <div className="mt-4 text-muted-foreground text-xs">{note}</div>
      <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-zinc-100">
        <div className={cn("h-full w-2/3 rounded-full", accent)} />
      </div>
    </div>
  );
}
