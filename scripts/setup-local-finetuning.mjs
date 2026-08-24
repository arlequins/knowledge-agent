import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tuningRoot = resolve(root, ".local/tuning");
const venv = resolve(tuningRoot, "venv");
await mkdir(tuningRoot, { recursive: true });

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited with status ${result.status}`);
}

run("uv", ["venv", "--python", "3.12", venv]);
run("uv", [
  "pip",
  "install",
  "--python",
  resolve(venv, "bin/python"),
  "mlx-lm[train]",
]);
console.log("Local MLX-LM fine-tuning runtime is ready.");
