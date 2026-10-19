import assert from "node:assert/strict";
import test from "node:test";

import type { Tables } from "@/types/database";

import { buildFounderDashboardModel, type DashboardInput } from "../founder-dashboard-model";

const company = {
  id: "company-1", name: "Example", website_url: null, stage: "pre_seed",
} as Tables<"companies">;

function input(overrides: Partial<DashboardInput> = {}): DashboardInput {
  return {
    firstName: "Ada", lastName: "Lovelace", linkedinUrl: null, company,
    needsCount: 1, applications: [], programs: [], questions: [], answers: [], knowledge: [],
    knowledgeSources: [], snapshots: [], assets: [], unreadNotifications: 0, activity: [],
    ...overrides,
  };
}

function application(status: Tables<"accelerator_applications">["status"], id: string, confirmation: string | null = null) {
  return {
    id, status, accelerator_program_id: null, submission_confirmation: confirmation,
    created_at: "2026-09-25T10:00:00Z", program_name_snapshot: `Program ${id}`,
  } as Tables<"accelerator_applications">;
}

test("new founders see honest zero counts and a program-discovery action", () => {
  const view = buildFounderDashboardModel(input());
  assert.equal(view.summary.applications, 0);
  assert.equal(view.summary.submitted, 0);
  assert.equal(view.pipeline.completed, 0);
  assert.equal(view.primaryAction.label, "Find programs");
  assert.equal(view.opportunities.length, 0);
  assert.ok(view.actions.some((action) => action.title === "Connect your company website"));
});

test("pipeline separates draft, review, final approval, and actual submission statuses", () => {
  const view = buildFounderDashboardModel(input({
    linkedinUrl: "https://linkedin.com/in/ada",
    applications: [
      application("draft", "draft"),
      application("answers_review_pending", "review"),
      application("agent_filled_pending_final_approval", "ready"),
      application("submitted", "submitted", "Confirmation code"),
    ],
  }));
  assert.equal(view.summary.applications, 4);
  assert.equal(view.summary.drafts, 2);
  assert.equal(view.summary.submitted, 1);
  assert.equal(view.summary.confirmed, 1);
  assert.equal(view.pipeline.preparing, 2);
  assert.equal(view.pipeline.ready, 1);
  assert.equal(view.pipeline.submitted, 1);
  assert.equal(view.primaryAction.label, "Review application");
});

test("only approved knowledge counts as application-ready", () => {
  const knowledge = [
    { id: "k1", category: "problem", status: "approved", content: "Problem", version: 1 },
    { id: "k2", category: "traction", status: "founder_edited", content: "MRR (USD): $1,000", version: 1 },
    { id: "k3", category: "solution", status: "generated", content: "Solution", version: 1 },
  ] as Tables<"knowledge_base_entries">[];
  const view = buildFounderDashboardModel(input({ knowledge, knowledgeSources: [{ knowledge_entry_id: "k1" }] }));
  assert.equal(view.readyKnowledge, 1);
  assert.equal(view.knowledgeSourceCount, 1);
  assert.equal(view.knowledge.find((item) => item.category === "problem")?.status, "Ready");
  assert.equal(view.knowledge.find((item) => item.category === "traction")?.status, "Needs review");
  assert.equal(view.knowledge.find((item) => item.category === "market")?.status, "Missing");
});

test("opportunities use a program website icon when no logo was supplied", () => {
  const program = {
    id: "program-1",
    slug: "example-accelerator",
    name: "Example Accelerator",
    operator_name: null,
    program_type: "accelerator",
    description: null,
    website_url: "https://accelerator.example/program",
    application_url: null,
    logo_url: null,
    location: "Remote",
    format: "remote",
    duration_text: null,
    cohort_name: null,
    stages: ["pre_seed"],
    industries: [],
    business_models: [],
    geographies: [],
    funding_amount: null,
    funding_currency: null,
    equity_percent: null,
    funding_terms: null,
    benefits: [],
    eligibility: {},
    required_materials: [],
    source_urls: [],
    deadline: null,
    rolling: false,
    program_start_date: null,
    application_open: true,
    last_verified_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } satisfies Tables<"accelerator_programs">;
  const view = buildFounderDashboardModel(input({ programs: [program] }));
  assert.equal(view.opportunities[0]?.logoUrl, "https://www.google.com/s2/favicons?domain=accelerator.example&sz=128");
});
