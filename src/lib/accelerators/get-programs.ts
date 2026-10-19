import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables } from "@/types/database";

import { mapProgram } from "./map-program";

export async function getAcceleratorPrograms(supabase: SupabaseClient<Database>, workspaceId: string) {
  const [{ data: programs, error: programError }, { data: applications, error: applicationError }] = await Promise.all([
    supabase.from("accelerator_programs").select("*"),
    supabase
      .from("accelerator_applications")
      .select("id,accelerator_program_id,status,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }),
  ]);

  if (programError || applicationError) {
    console.error("Accelerator marketplace query failed", {
      programs: programError?.code,
      applications: applicationError?.code,
    });
    return { accelerators: [], loadError: true };
  }

  const applicationIds = (applications ?? []).map((application) => application.id);
  const questionCountByApplication = new Map<string, number>();
  if (applicationIds.length > 0) {
    const { data: questions, error: questionError } = await supabase
      .from("application_questions")
      .select("application_id")
      .in("application_id", applicationIds);
    if (questionError) {
      console.error("Application question count query failed", { code: questionError.code });
    } else {
      for (const question of questions ?? []) {
        questionCountByApplication.set(
          question.application_id,
          (questionCountByApplication.get(question.application_id) ?? 0) + 1,
        );
      }
    }
  }

  const latestByProgram = new Map<
    string,
    Pick<Tables<"accelerator_applications">, "id" | "status"> & { questionCount: number }
  >();
  for (const application of applications ?? []) {
    if (application.accelerator_program_id && !latestByProgram.has(application.accelerator_program_id)) {
      latestByProgram.set(application.accelerator_program_id, {
        id: application.id,
        status: application.status,
        questionCount: questionCountByApplication.get(application.id) ?? 0,
      });
    }
  }

  const mapped = (programs ?? []).map((program) => mapProgram(program, latestByProgram.get(program.id)));
  mapped.sort((left, right) => left.sortGroup - right.sortGroup || left.sortTime - right.sortTime || left.accelerator.name.localeCompare(right.accelerator.name));
  return { accelerators: mapped.map((item) => item.accelerator), loadError: false };
}
