import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { repeatedNgrams, repeatedSentences } from "./tuning-quality.mjs";

const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(
  await readFile(resolve(root, "config/local-model-comparison.json"), "utf8"),
);
if (config.version !== 1) throw new Error("Unsupported comparison config");
const baseUrl = (
  process.env.MLX_BASE_URL ?? "http://127.0.0.1:8000/v1"
).replace(/\/$/, "");
const outputPath = resolve(root, ".local/evaluations/model-comparison.json");
const requestedProfiles = new Set(process.argv.slice(2));
const models = requestedProfiles.size
  ? config.models.filter((model) => requestedProfiles.has(model.label))
  : config.models;
if (models.length === 0)
  throw new Error("No requested model profile was found");

function normalized(value) {
  return value.normalize("NFKC").toLowerCase();
}

function score(evaluationCase, answer) {
  const normalizedAnswer = normalized(answer);
  const required = evaluationCase.answerMustInclude.map((requirement) => {
    const alternatives = Array.isArray(requirement)
      ? requirement
      : [requirement];
    return {
      matched: alternatives.some((term) =>
        normalizedAnswer.includes(normalized(term)),
      ),
      terms: alternatives,
    };
  });
  const forbidden = evaluationCase.answerMustNotInclude.map((term) => ({
    matched: normalizedAnswer.includes(normalized(term)),
    term,
  }));
  const ngrams = repeatedNgrams(answer);
  const sentences = repeatedSentences(answer);
  return {
    forbidden,
    passed:
      required.every((item) => item.matched) &&
      forbidden.every((item) => !item.matched) &&
      ngrams.length === 0 &&
      sentences.length === 0 &&
      answer.trim().length > 0,
    repeatedNgrams: ngrams,
    repeatedSentences: sentences,
    required,
  };
}

const profiles = [];
for (const model of models) {
  const results = [];
  for (const evaluationCase of config.cases) {
    const startedAt = performance.now();
    const request = {
      max_tokens: evaluationCase.maxTokens ?? 384,
      messages: [
        { content: evaluationCase.system, role: "system" },
        { content: evaluationCase.question, role: "user" },
      ],
      model: model.id,
      repetition_context_size: 512,
      repetition_penalty: model.repetitionPenalty ?? 1.18,
      stream: false,
      temperature: model.temperature,
      top_k: model.topK,
      top_p: model.topP,
    };
    if (model.thinking !== undefined)
      request.chat_template_kwargs = { enable_thinking: model.thinking };
    const response = await fetch(`${baseUrl}/chat/completions`, {
      body: JSON.stringify(request),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(300_000),
    });
    if (!response.ok)
      throw new Error(
        `${model.label}/${evaluationCase.id}: ${response.status}`,
      );
    const body = await response.json();
    const answer = body.choices?.[0]?.message?.content ?? "";
    const reasoning = body.choices?.[0]?.message?.reasoning_content ?? "";
    const result = {
      answer,
      durationMs: Math.round(performance.now() - startedAt),
      id: evaluationCase.id,
      priority: evaluationCase.priority,
      reasoningCharacters: reasoning.length,
      ...score(evaluationCase, answer),
    };
    results.push(result);
    console.log(
      `${result.passed ? "PASS" : "FAIL"} ${model.label}/${result.id} ${result.durationMs}ms`,
    );
  }
  const priorities = Object.fromEntries(
    [...new Set(results.map((result) => result.priority))].map((priority) => {
      const matching = results.filter((result) => result.priority === priority);
      return [
        priority,
        {
          passed: matching.filter((result) => result.passed).length,
          total: matching.length,
        },
      ];
    }),
  );
  profiles.push({
    ...model,
    results,
    summary: {
      averageDurationMs: Math.round(
        results.reduce((sum, result) => sum + result.durationMs, 0) /
          results.length,
      ),
      priorities,
    },
  });
}

let combinedProfiles = profiles;
if (requestedProfiles.size) {
  const previous = await readFile(outputPath, "utf8")
    .then((value) => JSON.parse(value).profiles ?? [])
    .catch(() => []);
  combinedProfiles = [
    ...previous.filter((profile) => !requestedProfiles.has(profile.label)),
    ...profiles,
  ];
}
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(
    { completedAt: new Date().toISOString(), profiles: combinedProfiles },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
console.log(`Report: ${outputPath}`);
