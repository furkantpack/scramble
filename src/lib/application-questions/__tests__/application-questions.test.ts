import { parseJsonOutput } from "../firecrawl-provider";
import { questionExtractionIsReady, validateCompletedDiscovery } from "../model";
import { publicExtractionFailure } from "../service";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const question = {
  label: "What problem are you solving?",
  fieldType: "textarea" as const,
  selectorHint: "#problem",
  required: true,
  maxWords: 200,
  maxCharacters: null,
  options: [],
  sectionName: "Company",
  externalFieldId: "problem",
  evidence: {
    pageUrl: "https://apply.example.com/form",
    pageTitle: "Application",
    labelText: "What problem are you solving?",
    controlType: "textarea",
    selector: "#problem",
    step: "Company",
  },
};

test("completed extraction with source evidence is accepted", () => {
  const result = validateCompletedDiscovery({
    completedInspection: true,
    observedApplicationForm: true,
    visitedUrls: ["https://apply.example.com/form"],
    blockers: [],
    questions: [question],
    verifiedNoQuestions: false,
    noQuestionsReason: null,
  });
  assert.equal(result.questions[0].evidence.selector, "#problem");
});

test("empty and failed extraction is never treated as success", () => {
  assert.throws(
    () =>
      validateCompletedDiscovery({
        completedInspection: false,
        observedApplicationForm: false,
        visitedUrls: ["https://apply.example.com/form"],
        blockers: ["login"],
        questions: [],
        verifiedNoQuestions: false,
        noQuestionsReason: null,
      }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "QUESTION_EXTRACTION_LOGIN",
  );
  assert.throws(() =>
    validateCompletedDiscovery({
      completedInspection: true,
      observedApplicationForm: true,
      visitedUrls: ["https://apply.example.com/form"],
      blockers: [],
      questions: [],
      verifiedNoQuestions: false,
      noQuestionsReason: null,
    }),
  );
});

test("discovery blockers keep actionable failure codes", () => {
  for (const [blocker, code] of [
    ["otp", "QUESTION_EXTRACTION_OTP"],
    ["captcha", "QUESTION_EXTRACTION_CAPTCHA"],
    ["access_denied", "QUESTION_EXTRACTION_ACCESS_DENIED"],
    ["unsupported_navigation", "QUESTION_EXTRACTION_UNSUPPORTED_NAVIGATION"],
  ] as const) {
    assert.throws(
      () =>
        validateCompletedDiscovery({
          completedInspection: false,
          observedApplicationForm: true,
          visitedUrls: ["https://apply.example.com/form"],
          blockers: [blocker],
          questions: [],
          verifiedNoQuestions: false,
          noQuestionsReason: null,
        }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === code,
    );
  }
});

test("provider failures surface actionable messages instead of zero questions", () => {
  assert.deepEqual(publicExtractionFailure("FIRECRAWL_RATE_LIMIT"), {
    status: 503,
    message: "Form discovery is temporarily rate limited. Try again shortly.",
  });
  assert.deepEqual(publicExtractionFailure("FIRECRAWL_TIMEOUT"), {
    status: 504,
    message: "Form discovery timed out before the complete form could be verified.",
  });
});

test("explicit verified no-questions result is accepted only with completed evidence", () => {
  const result = validateCompletedDiscovery({
    completedInspection: true,
    observedApplicationForm: true,
    visitedUrls: ["https://apply.example.com/form"],
    blockers: [],
    questions: [],
    verifiedNoQuestions: true,
    noQuestionsReason: "The complete form only requests an account selection and contains no applicant questions.",
  });
  assert.equal(result.verifiedNoQuestions, true);
});

test("Skyvern readiness rejects missing, failed, stale, and unverified extraction", () => {
  const extractionId = "extraction-1";
  assert.equal(questionExtractionIsReady({ applicationStatus: "draft", questionCount: 0, auditMetadata: null }), false);
  assert.equal(
    questionExtractionIsReady({
      applicationStatus: "failed",
      questionCount: 1,
      auditMetadata: { outcome: "questions", questionCount: 1, extractionId },
    }),
    false,
  );
  assert.equal(
    questionExtractionIsReady({
      applicationStatus: "form_questions_ready",
      questionCount: 0,
      auditMetadata: { outcome: "questions", questionCount: 1, extractionId },
    }),
    false,
  );
  assert.equal(
    questionExtractionIsReady({
      applicationStatus: "form_questions_ready",
      questionCount: 0,
      auditMetadata: { outcome: "verified_no_questions", questionCount: 0, verifiedNoQuestions: false, extractionId },
    }),
    false,
  );
});

test("Skyvern readiness accepts persisted questions or a verified no-questions audit", () => {
  assert.equal(
    questionExtractionIsReady({
      applicationStatus: "form_questions_ready",
      questionCount: 2,
      auditMetadata: { outcome: "questions", questionCount: 2, extractionId: "extraction-1" },
    }),
    true,
  );
  assert.equal(
    questionExtractionIsReady({
      applicationStatus: "form_questions_ready",
      questionCount: 0,
      auditMetadata: {
        outcome: "verified_no_questions",
        questionCount: 0,
        verifiedNoQuestions: true,
        extractionId: "extraction-2",
      },
    }),
    true,
  );
});

test("Firecrawl interaction output parser accepts fenced JSON and rejects prose", () => {
  assert.deepEqual(parseJsonOutput('```json\n{"ok":true}\n```'), { ok: true });
  assert.throws(() => parseJsonOutput("inspection failed"));
});

test("Gemini 3.8 callers do not send deprecated sampling parameters", () => {
  for (const path of ["src/lib/gemini/client.ts", "src/lib/pitch-deck/analyze.ts"]) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /\btemperature\s*:/);
    assert.doesNotMatch(source, /\btop_[pk]\s*:/);
    assert.match(source, /responseJsonSchema/);
  }
});
