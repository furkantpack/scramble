import assert from "node:assert/strict";
import test from "node:test";

import type { Tables } from "@/types/database";

import { formatDeadline } from "../formatting";
import { mapProgram } from "../map-program";

const baseProgram: Tables<"accelerator_programs"> = {
  id: "program-1",
  slug: "test-program",
  name: "Test Program",
  operator_name: "Test Operator",
  program_type: "accelerator",
  description: "A verified program description.",
  website_url: "https://example.com",
  application_url: "https://example.com/apply",
  logo_url: null,
  location: "Remote",
  format: "remote",
  duration_text: null,
  cohort_name: "2027",
  stages: ["pre_seed"],
  industries: [],
  business_models: ["B2B"],
  geographies: ["Global"],
  funding_amount: null,
  funding_currency: null,
  equity_percent: null,
  funding_terms: null,
  benefits: [],
  eligibility: {},
  required_materials: [],
  deadline: null,
  rolling: false,
  program_start_date: null,
  application_open: true,
  source_urls: ["https://example.com/source"],
  last_verified_at: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

test("omits unknown optional values and uses the official website icon when a logo is missing", () => {
  const { accelerator } = mapProgram(baseProgram);
  assert.equal(accelerator.logoUrl, "https://www.google.com/s2/favicons?domain=example.com&sz=128");
  assert.equal(accelerator.offer, undefined);
  assert.equal(accelerator.equity, undefined);
  assert.equal(accelerator.program.duration, "");
  assert.deepEqual(accelerator.tags, ["Pre-Seed"]);
  assert.equal(accelerator.deadline, "Open");
});

test("prefers an explicit program logo over its website icon", () => {
  const { accelerator } = mapProgram({ ...baseProgram, logo_url: "https://example.com/logo.svg" });
  assert.equal(accelerator.logoUrl, "https://example.com/logo.svg");
});

test("formats a non-dilutive grant without a fake equity line", () => {
  const { accelerator } = mapProgram({
    ...baseProgram,
    program_type: "grant",
    funding_amount: 75_000,
    funding_currency: "USD",
    equity_percent: 0,
  });
  assert.equal(accelerator.offer, "$75K grant");
  assert.equal(accelerator.equity, undefined);
});

test("renders generic eligibility JSON as readable labels and values", () => {
  const { accelerator } = mapProgram({
    ...baseProgram,
    eligibility: { location_requirement: "Massachusetts", stage: "Early stage" },
  });
  assert.deepEqual(accelerator.eligibility, [
    { label: "Location Requirement", value: "Massachusetts", state: "unknown" },
    { label: "Stage", value: "Early stage", state: "unknown" },
  ]);
});

test("maps active and submitted applications without inventing match data", () => {
  const draft = mapProgram(baseProgram, { id: "app-1", status: "draft" }).accelerator;
  const submitted = mapProgram(baseProgram, { id: "app-2", status: "submitted" }).accelerator;
  const uncertain = mapProgram(baseProgram, { id: "app-3", status: "submission_unverified" }).accelerator;
  assert.equal(draft.applicationStatus, "Draft");
  assert.equal(submitted.applicationStatus, "Submitted");
  assert.equal(uncertain.applicationStatus, "Needs verification");
  assert.equal(draft.match, undefined);
});

test("deadline rules cover rolling, closed, null, and closing soon", () => {
  const now = new Date("2026-09-24T12:00:00Z");
  assert.equal(formatDeadline({ ...baseProgram, rolling: true }, now).state, "Rolling");
  assert.equal(formatDeadline({ ...baseProgram, application_open: false }, now).state, "Closed");
  assert.equal(formatDeadline({ ...baseProgram, deadline: "2026-09-20" }, now).state, "Closed");
  assert.equal(formatDeadline({ ...baseProgram, deadline: "2026-09-30" }, now).state, "Closes soon");
});
