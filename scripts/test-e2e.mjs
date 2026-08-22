import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate an E2E PostgreSQL port"));
        return;
      }
      server.close((error) =>
        error ? reject(error) : resolve(String(address.port)),
      );
    });
  });
}

const fileEnv = Object.fromEntries(
  readFileSync(".env.e2e", "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => {
      const separator = line.indexOf("=");
      if (separator <= 0) throw new Error(`Invalid .env.e2e line: ${line}`);
      return [line.slice(0, separator), line.slice(separator + 1)];
    }),
);
const postgresPort = await availablePort();
const e2eEnv = {
  ...process.env,
  ...fileEnv,
  DATABASE_PORT: postgresPort,
  E2E_POSTGRES_PORT: postgresPort,
};

const composeArgs = [
  "compose",
  "-p",
  "knowledge-agent-e2e",
  "-f",
  "compose.e2e.yml",
];

function run(command, args, env = e2eEnv) {
  const result = spawnSync(command, args, {
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

try {
  run("pnpm", ["turbo", "run", "build", "--filter=@arlequins/api..."]);
  run("docker", [...composeArgs, "up", "-d", "--wait", "postgres-e2e"]);
  run("pnpm", ["db:migrate"]);
  run("pnpm", ["exec", "playwright", "test", ...process.argv.slice(2)]);
} finally {
  run("docker", [...composeArgs, "down", "--volumes"]);
}
