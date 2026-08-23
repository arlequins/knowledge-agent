import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const GOOGLE_CLIENT_ID_PATTERN = /^[a-z0-9-]+\.apps\.googleusercontent\.com$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setEnvValue(source, key, value) {
  const line = `${key}=${value}`;
  const expression = new RegExp(`^#?\\s*${key}=.*$`, "m");
  return expression.test(source)
    ? source.replace(expression, line)
    : `${source.replace(/\n?$/, "\n")}${line}\n`;
}

export function configureGoogleAuthEnv(source, { clientId, email }) {
  const normalizedClientId = clientId.trim();
  const normalizedEmail = email.trim().toLowerCase();
  if (!GOOGLE_CLIENT_ID_PATTERN.test(normalizedClientId)) {
    throw new Error(
      "Google 웹 클라이언트 ID는 *.apps.googleusercontent.com 형식이어야 합니다.",
    );
  }
  if (!EMAIL_PATTERN.test(normalizedEmail)) {
    throw new Error("허용할 Google 이메일 주소가 올바르지 않습니다.");
  }

  return [
    ["OIDC_ISSUER_URL", "https://accounts.google.com"],
    ["OIDC_AUDIENCE", normalizedClientId],
    ["OIDC_ALLOWED_ALGORITHMS", "RS256"],
    ["AUTH_PROVIDER", "google"],
    ["AUTH_ALLOWED_EMAILS", normalizedEmail],
    ["NEXT_PUBLIC_AUTH_PROVIDER", "google"],
    ["NEXT_PUBLIC_GOOGLE_CLIENT_ID", normalizedClientId],
  ].reduce(
    (configured, [key, value]) => setEnvValue(configured, key, value),
    source,
  );
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] === "--") arguments_.shift();
  const [clientId, email] = arguments_;
  if (!clientId || !email) {
    throw new Error(
      "사용법: pnpm auth:google:local -- <google-client-id> <allowed-email>",
    );
  }
  const environmentPath = resolve(".env.localhost");
  const temporaryPath = `${environmentPath}.tmp`;
  const source = await readFile(environmentPath, "utf8");
  const configured = configureGoogleAuthEnv(source, { clientId, email });
  await writeFile(temporaryPath, configured, { mode: 0o600 });
  await rename(temporaryPath, environmentPath);
  console.log(
    `Google 로컬 로그인을 ${email.trim().toLowerCase()} 계정으로 제한했습니다.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main();
}
