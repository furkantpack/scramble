import { NextResponse } from "next/server";

import { GeminiIntegrationError } from "@/lib/gemini/errors";
import { generateCompanyKnowledge } from "@/lib/gemini/generate-knowledge";
import { getKnowledgeGenerationContext } from "@/lib/knowledge/generation-context";
import { generateKnowledgeRequestSchema } from "@/lib/knowledge/internal-api-schema";
import { saveGeneratedKnowledge } from "@/lib/knowledge/save-generated-knowledge";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = generateKnowledgeRequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid generation request." }, { status: 400 });

  const context = await getKnowledgeGenerationContext(supabase, user.id, parsed.data.companyId);
  if (!context) return NextResponse.json({ error: "Company not found." }, { status: 404 });

  try {
    const generation = await generateCompanyKnowledge({ ...context, scrapedSources: parsed.data.scrapedSources });
    const saved = await saveGeneratedKnowledge(supabase, context, generation);
    return NextResponse.json({
      companySummary: generation.result.companySummary,
      sections: generation.result.sections,
      model: generation.model,
      usage: generation.usage,
      saved,
    });
  } catch (error) {
    if (error instanceof GeminiIntegrationError) {
      console.error("Knowledge generation failed", { code: error.code });
      return NextResponse.json({ error: error.code }, { status: statusForGeminiError(error.code) });
    }
    console.error("Knowledge persistence failed");
    return NextResponse.json({ error: "KNOWLEDGE_SAVE_FAILED" }, { status: 500 });
  }
}

function statusForGeminiError(code: GeminiIntegrationError["code"]) {
  if (code === "GEMINI_AUTH_ERROR") return 503;
  if (code === "GEMINI_RATE_LIMIT") return 429;
  if (code === "GEMINI_TIMEOUT") return 504;
  return 502;
}
