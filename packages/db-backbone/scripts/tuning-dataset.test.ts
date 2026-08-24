import { describe, expect, it } from "vitest";
import {
  MINIMUM_DISTINCT_TUNING_EXAMPLES,
  splitDistinctTuningExamples,
} from "./tuning-dataset";

const examples = Array.from(
  { length: MINIMUM_DISTINCT_TUNING_EXAMPLES },
  (_, index) => ({
    answer: `answer-${index}`,
    investigationId: `investigation-${index}`,
    question: `question-${index}`,
  }),
);

describe("tuning dataset splits", () => {
  it("creates deterministic, disjoint train, validation, and test splits", () => {
    const first = splitDistinctTuningExamples(examples);
    const second = splitDistinctTuningExamples([...examples].reverse());
    expect(first).toEqual(second);
    const ids = Object.values(first).flatMap((split) =>
      split.map((example) => example.investigationId),
    );
    expect(new Set(ids).size).toBe(examples.length);
    expect(first.train.length).toBeGreaterThanOrEqual(2);
    expect(first.valid).toHaveLength(1);
    expect(first.test).toHaveLength(1);
  });

  it("rejects undersized or duplicated approved examples", () => {
    expect(() => splitDistinctTuningExamples(examples.slice(0, 5))).toThrow(
      "At least 6 distinct",
    );
    expect(() =>
      splitDistinctTuningExamples([
        ...examples.slice(0, 5),
        { ...examples[5]!, answer: examples[0]!.answer },
      ]),
    ).toThrow("distinct questions and answers");
  });
});
