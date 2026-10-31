import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyAnswerQualityGates,
  hasRepeatedSentence,
  scoreEvaluationCase,
  serializeEvaluationReport,
  summarizeEvaluation,
  validateConfig,
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

  it("rejects duplicate cases, repeated loops, and duplicate answers", () => {
    assert.throws(() =>
      validateConfig({
        cases: [
          {
            answerMustInclude: ["source"],
            citationMustIncludeAny: ["README.md"],
            id: "same",
            question: "Q",
          },
          {
            answerMustInclude: ["source"],
            citationMustIncludeAny: ["README.md"],
            id: "same",
            question: "Q2",
          },
        ],
        minimumPassRate: 1,
        version: 1,
      }),
    );
    assert.equal(
      hasRepeatedSentence(
        "This is a repeated sentence which must not be accepted. ".repeat(2),
      ),
      true,
    );
    const gated = applyAnswerQualityGates([
      { answer: "A source-supported answer.", id: "one", passed: true },
      { answer: "A source-supported answer.", id: "two", passed: true },
    ]);
    assert.equal(gated[0].passed, true);
    assert.deepEqual(gated[1].qualityFailures, ["duplicate answer: one"]);
    assert.equal(gated[1].passed, false);
  });

  it("persists bounded review evidence without runtime identifiers", () => {
    const report = serializeEvaluationReport({
      baseUrl: "http://localhost:3000",
      completedAt: "2026-09-08T00:00:00.000Z",
      configPath: "config/local-agent-evaluation.json",
      model: "local-model",
      results: [
        {
          answer: "Grounded answer",
          answerMatches: [],
          answerPassed: true,
          citationMatches: [],
          citationPassed: true,
          citations: ["README.md — source"],
          durationMs: 1,
          forbiddenAnswerMatches: [],
          id: "purpose",
          passed: true,
          privateMessageId: "not persisted",
          qualityFailures: [],
          question: "What is the purpose?",
        },
      ],
      summary: { passed: 1 },
    });
    assert.equal(report.results[0].privateMessageId, undefined);
    assert.throws(() =>
      serializeEvaluationReport({
        baseUrl: "http://localhost:3000",
        completedAt: "now",
        configPath: "config",
        model: "model",
        results: [],
        summary: {},
      }),
    );
  });
});
