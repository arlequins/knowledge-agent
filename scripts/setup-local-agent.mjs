import { constants } from "node:fs";
import { access, copyFile } from "node:fs/promises";
import { resolve } from "node:path";

const source = resolve(".env.localhost.example");
const target = resolve(".env.localhost");

try {
  await access(target, constants.F_OK);
  console.log(".env.localhost already exists; no values were overwritten.");
} catch {
  await copyFile(source, target);
  console.log("Created .env.localhost from the local agent template.");
}

console.log(
  "Next: pull gemma3:12b and nomic-embed-text, run pnpm agent:model:setup, then run pnpm dev:local",
);
