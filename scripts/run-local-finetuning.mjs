import { spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  readlink,
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { resolve } from "node:path";
import { scoreTuningProbe } from "./tuning-quality.mjs";

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
  process.env.LOCAL_TUNING_BASE_MODEL ?? "ornith-ai/Ornith-1.5-9B-MLX-4bit";
const baseModel = baseModelSource;
const iterations = process.env.LOCAL_TUNING_ITERS ?? "40";
const maximumSequenceLength = process.env.LOCAL_TUNING_MAX_SEQ_LENGTH ?? "768";
const tunedLayers = process.env.LOCAL_TUNING_NUM_LAYERS ?? "2";
const reloadCommand = process.env.LOCAL_TUNING_RELOAD_COMMAND?.trim();

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
  tunedLayers,
  "--max-seq-length",
  maximumSequenceLength,
  "--learning-rate",
  "1e-5",
  "--mask-prompt",
  "--grad-checkpoint",
]);

const manifest = JSON.parse(
  await readFile(resolve(dataDirectory, "manifest.json"), "utf8"),
);
if (manifest.version !== 2 || !Array.isArray(manifest.splits?.test))
  throw new Error(
    "A version 2 manifest with an isolated test split is required",
  );
const probeResults = [];
for (const example of manifest.splits.test) {
  const prompts = example.systemPrompts;
  for (const [promptIndex, systemPrompt] of prompts.entries()) {
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
        systemPrompt,
        "--max-tokens",
        "512",
        "--temp",
        "0.1",
        ...(baseModel.toLowerCase().includes("ornith")
          ? ["--chat-template-config", '{"enable_thinking":false}']
          : []),
        "--verbose",
        "false",
      ],
      { capture: true },
    );
    probeResults.push({
      answer,
      feedbackId: example.feedbackId,
      ...scoreTuningProbe(example, answer),
      promptIndex,
    });
  }
}
const passed = probeResults.every((result) => result.passed);
await writeFile(
  resolve(runDirectory, "evaluation.json"),
  `${JSON.stringify({ baseModel, baseModelSource, iterations, passed, probeResults, runId }, null, 2)}\n`,
  { mode: 0o600 },
);
if (!passed)
  throw new Error("Tuned candidate failed its evidence regression gate");

const previousTarget = await readlink(current).catch(() => undefined);
await symlink(adapters, candidate);
await rename(candidate, current);
if (reloadCommand) {
  const reload = spawnSync(process.env.SHELL ?? "zsh", ["-lc", reloadCommand], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      KNOWLEDGE_AGENT_ADAPTER_PATH: adapters,
      KNOWLEDGE_AGENT_RELOAD_REASON: "promoted",
    },
    stdio: "inherit",
  });
  if (reload.status !== 0) {
    const rollback = resolve(tuningRoot, `.rollback-${runId}`);
    if (previousTarget) {
      await symlink(previousTarget, rollback);
      await rename(rollback, current);
    } else {
      await unlink(current).catch(() => undefined);
    }
    throw new Error(
      "Model reload failed; the previous adapter pointer was restored",
    );
  }
}
console.log(`Promoted reviewed LoRA adapter: ${adapters}`);
