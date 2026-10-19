import { formatTractionContent, parseTractionContent } from "../traction-content";
import assert from "node:assert/strict";
import test from "node:test";

test("founder MRR and ARR are saved as explicit USD values with context", () => {
  const result = formatTractionContent({
    mrr: "12000",
    arr: "144000.50",
    details: "14 paying customers as of June 2026.",
  });
  assert.deepEqual(result, {
    content:
      "MRR (USD): $12,000\n\nARR (USD): $144,000.50\n\nAdditional traction:\n14 paying customers as of June 2026.",
  });
  if ("content" in result) {
    assert.deepEqual(parseTractionContent(result.content), {
      mrr: "12000",
      arr: "144000.50",
      details: "14 paying customers as of June 2026.",
    });
  }
});

test("existing freeform traction survives the structured editor", () => {
  assert.deepEqual(parseTractionContent("Three customer pilots are underway."), {
    mrr: "",
    arr: "",
    details: "Three customer pilots are underway.",
  });
});

test("invalid, negative and empty traction values are rejected", () => {
  assert.ok("error" in formatTractionContent({ mrr: "-20", arr: "", details: "" }));
  assert.ok("error" in formatTractionContent({ mrr: "12.345", arr: "", details: "" }));
  assert.ok("error" in formatTractionContent({ mrr: "", arr: "", details: "" }));
});
