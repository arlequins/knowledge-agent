import { createHash } from "node:crypto";

export const MINIMUM_DISTINCT_TUNING_EXAMPLES = 6;

export type SplittableTuningExample = {
  answer: string;
  investigationId: string;
  question: string;
};

function fingerprint(value: string) {
  return createHash("sha256")
    .update(value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase())
    .digest("hex");
}

function stableOrder(example: SplittableTuningExample) {
  return createHash("sha256").update(example.investigationId).digest("hex");
}

export function splitDistinctTuningExamples<T extends SplittableTuningExample>(
  examples: T[],
) {
  if (examples.length < MINIMUM_DISTINCT_TUNING_EXAMPLES)
    throw new Error(
      `At least ${MINIMUM_DISTINCT_TUNING_EXAMPLES} distinct approved tuning examples are required; found ${examples.length}`,
    );
  const questionFingerprints = new Set<string>();
  const answerFingerprints = new Set<string>();
  for (const example of examples) {
    const question = fingerprint(example.question);
    const answer = fingerprint(example.answer);
    if (questionFingerprints.has(question) || answerFingerprints.has(answer))
      throw new Error(
        "Approved tuning examples must have distinct questions and answers before splitting",
      );
    questionFingerprints.add(question);
    answerFingerprints.add(answer);
  }

  const ordered = [...examples].sort((left, right) =>
    stableOrder(left).localeCompare(stableOrder(right)),
  );
  const holdoutSize = Math.max(1, Math.floor(ordered.length * 0.2));
  const test = ordered.slice(0, holdoutSize);
  const valid = ordered.slice(holdoutSize, holdoutSize * 2);
  const train = ordered.slice(holdoutSize * 2);
  if (train.length < 2)
    throw new Error("The tuning training split requires at least two examples");
  return { test, train, valid };
}
