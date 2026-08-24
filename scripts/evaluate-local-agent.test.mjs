import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  scoreEvaluationCase,
  summarizeEvaluation,
} from "./evaluate-local-agent.mjs";

describe("local agent evaluation", () => {
  it("requires every answer term and at least one expected citation", () => {
    assert.deepEqual(
      scoreEvaluationCase(
        {
          answerMustInclude: ["PostgreSQL", "S3 Vectors"],
          citationMustIncludeAny: ["docs/architecture.md", "docs/other.md"],
          id: "retrieval",
        },
        {
          answer: "Use PostgreSQL with optional S3 Vectors.",
          citations: ["docs/architecture.md — Retrieval without OpenSearch"],
        },
      ),
      {
        answerMatches: [
          { matched: true, term: "PostgreSQL" },
          { matched: true, term: "S3 Vectors" },
        ],
        answerPassed: true,
        citationMatches: [
          { matched: true, term: "docs/architecture.md" },
          { matched: false, term: "docs/other.md" },
        ],
        citationPassed: true,
        forbiddenAnswerMatches: [],
        id: "retrieval",
        passed: true,
      },
    );
  });

  it("applies the configured pass-rate gate", () => {
    assert.deepEqual(
      summarizeEvaluation([{ passed: true }, { passed: false }], 0.75),
      {
        cases: 2,
        failed: 1,
        minimumPassRate: 0.75,
        passed: 1,
        passRate: 0.5,
        thresholdPassed: false,
      },
    );
  });

  it("accepts an alternative answer term from a reviewed group", () => {
    const result = scoreEvaluationCase(
      {
        answerMustInclude: [
          ["실시간", "real-time"],
          ["매일", "daily"],
        ],
        citationMustIncludeAny: ["docs/architecture.md"],
        id: "daily-loop",
      },
      {
        answer: "No real-time tuning; run the evaluation daily.",
        citations: ["docs/architecture.md"],
      },
    );
    assert.equal(result.passed, true);
  });

  it("rejects a known unsupported claim", () => {
    const result = scoreEvaluationCase(
      {
        answerMustInclude: [".java", ".rb", ".cs"],
        answerMustNotInclude: [".class", ".rake"],
        citationMustIncludeAny: ["apps/indexer/src/index.ts"],
        id: "legacy-extensions",
      },
      {
        answer: "Use .java, .rb, .rake, and .cs.",
        citations: ["apps/indexer/src/index.ts"],
      },
    );
    assert.equal(result.answerPassed, false);
    assert.equal(result.passed, false);
  });
});
