import { onboardingPrefill, pitchDeckPageSchema, pitchDeckProfileSchema } from "../schema";
import assert from "node:assert/strict";
import test from "node:test";

const extracted = pitchDeckProfileSchema.parse({
  company_name: "Deck Company",
  one_liner: "AI-powered operations for founders",
  problem: null,
  solution: null,
  product_description: null,
  industry: null,
  target_customer: null,
  business_model: null,
  business_model_details: null,
  market: { tam: null, sam: null, som: null },
  traction: null,
  metrics: [],
  competitors: [],
  competitive_advantage: null,
  team: [],
  fundraising: { stage: "Seed", raising: null, amount: null, previous_funding: null },
});

test("deck suggestions fill only empty onboarding fields", () => {
  const original = {
    companyName: "Founder Company",
    description: "",
    stage: "pre_seed",
    website: "https://example.com",
  };
  assert.deepEqual(onboardingPrefill(original, extracted), {
    ...original,
    description: "AI-powered operations for founders",
  });
});

test("deck suggestions may fill stage only when founder has not chosen one", () => {
  const draft = { companyName: "", description: "", stage: "" };
  assert.deepEqual(onboardingPrefill(draft, extracted), {
    companyName: "Deck Company",
    description: "AI-powered operations for founders",
    stage: "seed",
  });
});

test("incomplete analysis is rejected instead of fabricating fields", () => {
  assert.equal(pitchDeckProfileSchema.safeParse({ company_name: "Only a name" }).success, false);
});

test("deck extraction keeps chart and table evidence with a real page number", () => {
  assert.equal(
    pitchDeckPageSchema.safeParse({
      page: 3,
      text: "ARR",
      tables: ["2025: $100k"],
      charts: ["Revenue trend"],
      visuals: [],
    }).success,
    true,
  );
  assert.equal(
    pitchDeckPageSchema.safeParse({ page: 0, text: "ARR", tables: [], charts: [], visuals: [] }).success,
    false,
  );
});
