import type { ReactNode } from "react";

import Image from "next/image";

import { Radar } from "lucide-react";

import { ScrambleLogo } from "@/components/branding/scramble-logo";
import { cn } from "@/lib/utils";

export function ScouterLogo({
  inverse = false,
  brand = "Scramble",
}: {
  inverse?: boolean;
  brand?: "Scouter" | "Scramble";
}) {
  let subtitle = "Founder intelligence";
  if (brand === "Scramble") subtitle = "Find it. Apply. Move on.";

  return (
    <div className="flex items-center gap-3">
      <span className="flex flex-col gap-0.5">
        <ScrambleLogo inverse={inverse} markClassName="h-9" wordmarkClassName="text-[27px]" />
        <span className={cn("block text-muted-foreground text-xs", inverse && "text-zinc-400")}>{subtitle}</span>
      </span>
    </div>
  );
}

export function AuthShell({ children, mode }: { children: ReactNode; mode: "login" | "register" }) {
  const authCopy = getAuthCopy(mode);
  return (
    <main className="grid min-h-dvh bg-zinc-50 lg:grid-cols-[minmax(0,1fr)_minmax(520px,0.92fr)]">
      <section className="flex items-center justify-center px-5 py-8 sm:px-8 lg:px-12">
        <div className="w-full max-w-[560px]">{children}</div>
      </section>
      <section className="relative hidden min-h-dvh overflow-hidden bg-[#faf6f2] p-10 text-zinc-900 lg:block xl:p-14">
        <Image
          src="/auth/founder-pastel.webp"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 48vw, 0px"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(250,247,244,0.36)_0%,transparent_22%,transparent_46%,rgba(250,247,244,0.66)_69%,rgba(250,247,244,0.96)_100%)]" />
        <div className="relative flex h-full flex-col justify-between">
          <ScouterLogo brand="Scramble" />
          <div className="max-w-xl space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/75 bg-white/75 px-3 py-1 text-sm text-zinc-700 shadow-sm backdrop-blur-sm">
              <Radar className="size-4" strokeWidth={1.8} />
              Founder context, before the call
            </div>
            <h2 className="font-semibold text-5xl tracking-tight xl:text-6xl">{authCopy.title}</h2>
            <p className="max-w-lg text-lg text-zinc-600 leading-8">{authCopy.description}</p>
          </div>
        </div>
      </section>
    </main>
  );
}

function getAuthCopy(mode: "login" | "register") {
  if (mode === "register") {
    return {
      title: "Give Scramble context. Keep the conversation human.",
      description: "Share the minimum. Scramble researches the rest and prepares for the questions that matter.",
    };
  }
  return {
    title: "Start where your deck ends.",
    description:
      "Scramble learns your company before you speak, so every conversation can focus on judgment, change, and fit.",
  };
}

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="w-fit rounded-full bg-zinc-100 px-2.5 py-1 font-medium text-xs text-zinc-700">
      {children}
    </label>
  );
}
