export const KNOWLEDGE_CATEGORIES = [
  "problem",
  "solution",
  "target_customer",
  "market",
  "traction",
  "business_model",
  "competition",
  "team",
  "ask",
] as const;

export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];
export type KnowledgeStatus = "generated" | "needs_review" | "missing";
export type EvidenceType = "direct" | "pitch_deck" | "founder_input" | "inference";

export type ScrapedSource = {
  url: string;
  title?: string | null;
  markdown: string;
};

export type FounderContext = {
  firstName?: string;
  lastName?: string;
  linkedinUrl?: string | null;
  selectedNeeds?: string[];
  additionalContext?: string | null;
};

export type CompanyContext = {
  stage?: string | null;
  shortDescription?: string | null;
};

export type GenerateKnowledgeInput = {
  workspaceId: string;
  companyId: string;
  companyName: string;
  companyUrl?: string | null;
  founderContext?: FounderContext;
  companyContext?: CompanyContext;
  scrapedSources: ScrapedSource[];
  deckSource?: { assetId: string; extractedText: string; pages: { page: number; text: string; tables: string[]; charts: string[]; visuals: string[] }[] } | null;
};

export type KnowledgeEvidence = {
  sourceUrl: string | null;
  sourceLabel: string;
  excerpt: string;
  evidenceType: EvidenceType;
};

export type KnowledgeSection = {
  category: KnowledgeCategory;
  status: KnowledgeStatus;
  content: string | null;
  confidence: number | null;
  evidence: KnowledgeEvidence[];
  missingInformation: string[];
  notes: string[];
};

export type KnowledgeGenerationResult = {
  companySummary: string | null;
  sections: KnowledgeSection[];
};

export type GeminiUsage = {
  promptTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type KnowledgeGenerationResponse = {
  result: KnowledgeGenerationResult;
  usage: GeminiUsage;
  model: string;
};

export type RegenerateKnowledgeSectionInput = Omit<GenerateKnowledgeInput, "workspaceId" | "companyId"> & {
  category: KnowledgeCategory;
  currentContent: string | null;
  founderInstruction?: string | null;
};

export type RegenerateKnowledgeSectionResult = {
  currentVersion: string | null;
  proposedVersion: KnowledgeSection;
  usage: GeminiUsage;
  model: string;
};

export type GeminiJsonRequest = {
  systemInstruction: string;
  prompt: string;
  schema: Record<string, unknown>;
};

export type GeminiJsonResponse = {
  text: string;
  model: string;
  usage: GeminiUsage;
};

export type GeminiJsonGenerator = (request: GeminiJsonRequest) => Promise<GeminiJsonResponse>;
