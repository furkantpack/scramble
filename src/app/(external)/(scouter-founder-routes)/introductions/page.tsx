import type { Metadata } from "next";

import { getAcceleratorPrograms } from "@/lib/accelerators/get-programs";
import { getWorkspaceContext } from "@/lib/supabase/context";

import { InterviewLibrary } from "./interview-library";

export const metadata: Metadata = {
  title: "Accelerator Marketplace - AcceleratorPilot",
  description:
    "Discover relevant accelerator programs, understand your eligibility, and prepare stronger applications.",
};

export default async function Page({ searchParams }: { searchParams: Promise<{ program?: string }> }) {
  const { supabase, workspaceId } = await getWorkspaceContext({ requireOnboarding: true });
  const result = await getAcceleratorPrograms(supabase, workspaceId);
  const { program } = await searchParams;
  return <InterviewLibrary accelerators={result.accelerators} loadError={result.loadError} initialProgramId={program} />;
}
