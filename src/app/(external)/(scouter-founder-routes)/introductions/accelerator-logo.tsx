"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

export function AcceleratorLogo({
  logoUrl,
  initials,
  accent,
  className,
}: {
  logoUrl: string;
  initials: string;
  accent: string;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasLogo = Boolean(logoUrl?.trim());
  const showLogo = hasLogo && failedUrl !== logoUrl;

  return (
    <span
      className={cn(
        "grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl border bg-white",
        !showLogo && accent,
        className,
      )}
    >
      {!showLogo ? (
        <span className="font-semibold text-sm">{initials}</span>
      ) : (
        <img src={logoUrl} alt="" className="size-full object-contain p-1.5" onError={() => setFailedUrl(logoUrl)} />
      )}
    </span>
  );
}
