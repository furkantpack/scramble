import assert from "node:assert/strict";
import test from "node:test";

import { planKnowledgeSectionSave } from "@/lib/knowledge/save-generated-knowledge";
import type { Tables } from "@/types/database";

function entry(status: Tables<"knowledge_base_entries">["status"], version: number) {
  return {
    id: `entry-${version}`,
    workspace_id: "workspace",
    company_id: "company",
    category: "problem" as const,
    content: "Existing content",
    source_type: "founder" as const,
    status,
    confidence: 0.8,
    version,
    approved_by: status === "approved" ? "user" : null,
    approved_at: status === "approved" ? "2026-01-01T00:00:00Z" : null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  } satisfies Tables<"knowledge_base_entries">;
}

test("approved content is preserved and a new generation becomes a review proposal", () => {
  const approved = entry("approved", 3);
  const plan = planKnowledgeSectionSave([approved], { category: "problem", status: "generated" });
  assert.equal(plan.protectedEntry?.id, approved.id);
  assert.equal(plan.version, 4);
  assert.equal(plan.disposition, "proposal");
  assert.equal(plan.status, "needs_review");
});

test("unprotected generation becomes the current next version", () => {
  const plan = planKnowledgeSectionSave([entry("generated", 2)], { category: "problem", status: "generated" });
  assert.equal(plan.protectedEntry, undefined);
  assert.equal(plan.version, 3);
  assert.equal(plan.disposition, "current");
  assert.equal(plan.status, "generated");
});
