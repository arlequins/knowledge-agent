import assert from "node:assert/strict";
import test from "node:test";
import { scoreTuningProbe } from "./tuning-quality.mjs";

const example = {
  answer:
    "daily_tuning은 비활성 상태이며 근거에 기록된 예약 시각은 03:00입니다.",
  evidence: [
    {
      content: "daily_tuning: enabled=false, scheduled_at=03:00",
    },
  ],
  forbiddenTerms: ["weekly_evaluation"],
  question: "일일 학습은 몇 시에 실행되나요?",
  requiredTerms: ["비활성", "03:00"],
};

test("rejects repeated sentences", () => {
  const sentence =
    "daily_tuning은 비활성 상태이며 근거에 기록된 예약 시각은 03:00입니다.";
  const result = scoreTuningProbe(example, `${sentence} ${sentence}`);
  assert.equal(result.passed, false);
  assert.equal(result.repeatedSentences.length, 1);
});

test("rejects technical claims absent from evidence", () => {
  const result = scoreTuningProbe(
    example,
    "daily_tuning은 비활성이고 weekly_evaluation은 05:00에 실행됩니다.",
  );
  assert.equal(result.passed, false);
  assert.ok(result.unsupportedClaims.includes("weekly_evaluation"));
  assert.ok(result.unsupportedClaims.includes("05:00"));
});

test("accepts a concise evidence-grounded answer", () => {
  const result = scoreTuningProbe(
    example,
    "daily_tuning은 현재 비활성 상태입니다. 설정에 적힌 시각은 03:00입니다.",
  );
  assert.equal(result.passed, true);
});

test("accepts a supported filename wrapped in Markdown code", () => {
  const result = scoreTuningProbe(
    {
      ...example,
      answer: "설정은 index.ts에 있습니다.",
      evidence: [{ content: "index.ts contains the active configuration." }],
      requiredTerms: ["index.ts"],
    },
    "설정은 `index.ts`에 있습니다.",
  );
  assert.equal(result.passed, true);
});
