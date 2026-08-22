import { spawnSync } from "node:child_process";
import { mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tuningRoot = resolve(root, ".local/tuning");
const runId = new Date().toISOString().replaceAll(":", "-");
const runDirectory = resolve(tuningRoot, "runs", runId);
const dataDirectory = resolve(runDirectory, "data");
const adapters = resolve(runDirectory, "adapters");
const current = resolve(tuningRoot, "current");
const candidate = resolve(tuningRoot, `.current-${runId}`);
const venvBin = resolve(tuningRoot, "venv/bin");
const baseModelSource =
  process.env.LOCAL_TUNING_BASE_MODEL ??
  "mlx-community/Qwen2.5-14B-Instruct-4bit";
const baseModel = baseModelSource;
const iterations = process.env.LOCAL_TUNING_ITERS ?? "40";
const evaluationSystemPrompt =
  "근거로 확인된 사실만 답하고, 설계와 현재 활성화된 구성을 구분한다. 시간대 근거 없이 cron을 현지 시각으로 바꾸지 않는다.";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited with status ${result.status}`);
  return result.stdout ?? "";
}

await mkdir(runDirectory, { recursive: true });
if (!baseModelSource.startsWith("/") && !baseModelSource.startsWith("."))
  run(resolve(venvBin, "hf"), [
    "download",
    baseModelSource,
    "README.md",
    ".gitattributes",
  ]);
run("pnpm", [
  "exec",
  "dotenv",
  "-e",
  ".env.localhost",
  "--",
  "pnpm",
  "-C",
  "packages/db-backbone",
  "exec",
  "tsx",
  "scripts/export-approved-tuning.ts",
  "--output",
  dataDirectory,
]);

run(resolve(venvBin, "mlx_lm.lora"), [
  "--model",
  baseModel,
  "--train",
  "--data",
  dataDirectory,
  "--adapter-path",
  adapters,
  "--iters",
  iterations,
  "--batch-size",
  "1",
  "--num-layers",
  "8",
  "--max-seq-length",
  "1024",
  "--learning-rate",
  "1e-5",
  "--mask-prompt",
  "--grad-checkpoint",
]);

const manifest = JSON.parse(
  await readFile(resolve(dataDirectory, "manifest.json"), "utf8"),
);
const probeResults = [];
for (const example of manifest.examples) {
  const answer = run(
    resolve(venvBin, "mlx_lm.generate"),
    [
      "--model",
      baseModel,
      "--adapter-path",
      adapters,
      "--prompt",
      example.question,
      "--system-prompt",
      evaluationSystemPrompt,
      "--max-tokens",
      "512",
      "--temp",
      "0.1",
      "--verbose",
      "false",
    ],
    { capture: true },
  );
  const required = example.requiredTerms.map((term) => ({
    matched: answer.includes(term),
    term,
  }));
  const forbidden = example.forbiddenTerms.map((term) => ({
    matched: answer.includes(term),
    term,
  }));
  const unexpectedChinese =
    /[\u4e00-\u9fff]/u.test(answer) && /[가-힣]/u.test(example.question);
  probeResults.push({
    answer,
    feedbackId: example.feedbackId,
    passed:
      required.every((item) => item.matched) &&
      forbidden.every((item) => !item.matched) &&
      !unexpectedChinese,
    required,
    forbidden,
    unexpectedChinese,
  });
}
const passed = probeResults.every((result) => result.passed);
await writeFile(
  resolve(runDirectory, "evaluation.json"),
  `${JSON.stringify({ baseModel, baseModelSource, iterations, passed, probeResults, runId }, null, 2)}\n`,
  { mode: 0o600 },
);
if (!passed)
  throw new Error("Tuned candidate failed its evidence regression gate");

await symlink(adapters, candidate);
await rename(candidate, current);
console.log(`Promoted reviewed LoRA adapter: ${adapters}`);
