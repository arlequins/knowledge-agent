import { randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { access, copyFile, readFile, writeFile } from "node:fs/promises";
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

const environment = await readFile(target, "utf8");
const encryptionKey = randomBytes(32).toString("base64");
const keyPattern = /^MODEL_CREDENTIAL_ENCRYPTION_KEY=.*$/m;
if (!/^MODEL_CREDENTIAL_ENCRYPTION_KEY=.+$/m.test(environment)) {
  const updated = keyPattern.test(environment)
    ? environment.replace(
        keyPattern,
        `MODEL_CREDENTIAL_ENCRYPTION_KEY=${encryptionKey}`,
      )
    : `${environment.trimEnd()}\nMODEL_CREDENTIAL_ENCRYPTION_KEY=${encryptionKey}\n`;
  await writeFile(target, updated, { mode: 0o600 });
  console.log("Generated the local model credential encryption key.");
}

console.log(
  "Next: pull gemma3:12b and nomic-embed-text, run pnpm agent:model:setup, then run pnpm dev:local",
);
