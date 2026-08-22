import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const tuningRoot = resolve(root, ".local/tuning");
const current = resolve(tuningRoot, "current");
const logs = resolve(tuningRoot, "logs");
const launchAgents = resolve(homedir(), "Library/LaunchAgents");
const userId = process.getuid?.();
if (userId === undefined) throw new Error("A macOS user session is required");
await readFile(resolve(current, "adapter_config.json"), "utf8");
await mkdir(logs, { recursive: true });
await mkdir(launchAgents, { recursive: true });

const serverLabel = "com.arlequins.knowledge-agent.mlx-server";
const tuningLabel = "com.arlequins.knowledge-agent.daily-tuning";
const serverPlist = resolve(launchAgents, `${serverLabel}.plist`);
const tuningPlist = resolve(launchAgents, `${tuningLabel}.plist`);
const python = resolve(tuningRoot, "venv/bin/python");
const mlxServer = resolve(root, "scripts/mlx-reviewed-server.py");
const baseModel =
  process.env.LOCAL_TUNING_BASE_MODEL ??
  "mlx-community/Qwen2.5-14B-Instruct-4bit";
const pnpm = spawnSync("command", ["-v", "pnpm"], {
  encoding: "utf8",
  shell: true,
}).stdout.trim();
if (!pnpm) throw new Error("pnpm was not found");
const dailyCommand = `cd '${root.replaceAll("'", "'\\''")}' && '${pnpm}' agent:tune:daily`;

function plist(label, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
${body}
</dict></plist>
`;
}

await writeFile(
  serverPlist,
  plist(
    serverLabel,
    `<key>ProgramArguments</key><array><string>${python}</string><string>${mlxServer}</string><string>--model</string><string>${baseModel}</string><string>--adapter-path</string><string>${current}</string><string>--port</string><string>8000</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>${resolve(logs, "mlx-server.log")}</string>
<key>StandardErrorPath</key><string>${resolve(logs, "mlx-server.error.log")}</string>`,
  ),
);
await writeFile(
  tuningPlist,
  plist(
    tuningLabel,
    `<key>ProgramArguments</key><array><string>/bin/zsh</string><string>-lc</string><string>${dailyCommand}</string></array>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
<key>StandardOutPath</key><string>${resolve(logs, "daily-tuning.log")}</string>
<key>StandardErrorPath</key><string>${resolve(logs, "daily-tuning.error.log")}</string>`,
  ),
);

function launchctl(args, allowFailure = false) {
  const result = spawnSync("launchctl", args, { stdio: "inherit" });
  if (!allowFailure && result.status !== 0)
    throw new Error(`launchctl ${args[0]} failed`);
}
launchctl(["bootout", `gui/${userId}`, serverPlist], true);
launchctl(["bootout", `gui/${userId}`, tuningPlist], true);
launchctl(["bootstrap", `gui/${userId}`, serverPlist]);
launchctl(["bootstrap", `gui/${userId}`, tuningPlist]);

let ready = false;
for (let attempt = 0; attempt < 90; attempt += 1) {
  try {
    const response = await fetch("http://127.0.0.1:8000/v1/models");
    if (response.ok) {
      ready = true;
      break;
    }
  } catch {
    // Model loading can take several seconds.
  }
  await new Promise((resolve) => setTimeout(resolve, 1_000));
}
if (!ready) throw new Error("MLX-LM server did not become ready");

const environmentPath = resolve(root, ".env.localhost");
let environment = await readFile(environmentPath, "utf8");
function setEnvironment(name, value) {
  const pattern = new RegExp(`^${name}=.*$`, "m");
  environment = pattern.test(environment)
    ? environment.replace(pattern, `${name}=${value}`)
    : `${environment.trimEnd()}\n${name}=${value}\n`;
}
setEnvironment("MLX_BASE_URL", "http://127.0.0.1:8000/v1");
setEnvironment("MLX_MODEL", baseModel);
await writeFile(environmentPath, environment, { mode: 0o600 });
console.log("Installed daily 03:00 local tuning and the reviewed MLX server.");
