import { NextResponse } from "next/server";

import { GeminiIntegrationError } from "@/lib/gemini/errors";
import { regenerateKnowledgeSection } from "@/lib/gemini/regenerate-section";
import { getKnowledgeGenerationContext } from "@/lib/knowledge/generation-context";
import { regenerateKnowledgeRequestSchema } from "@/lib/knowledge/internal-api-schema";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = regenerateKnowledgeRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid regeneration request." }, { status: 400 });
  const context = await getKnowledgeGenerationContext(supabase, user.id, parsed.data.companyId);
  if (!context) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  try {
    const result = await regenerateKnowledgeSection({
      ...context,
      category: parsed.data.category,
      currentContent: parsed.data.currentContent,
      founderInstruction: parsed.data.founderInstruction,
      scrapedSources: parsed.data.scrapedSources,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GeminiIntegrationError) {
      console.error("Knowledge section regeneration failed", { code: error.code });
      return NextResponse.json({ error: error.code }, { status: error.code === "GEMINI_RATE_LIMIT" ? 429 : 502 });
    }
    return NextResponse.json({ error: "GEMINI_UNKNOWN" }, { status: 502 });
  }
}
