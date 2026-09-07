import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ENDPOINTS = [
  ["function_url", "AWS_SMOKE_FUNCTION_URL"],
  ["gateway_url", "AWS_SMOKE_GATEWAY_URL"],
];

function isNonPublicIpv4(hostname) {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
}

function isNonPublicIpv6(hostname) {
  const normalized = hostname.replace(/^\[|\]$/gu, "").toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    /^f[cd]/u.test(normalized) ||
    /^fe[89ab]/u.test(normalized)
  );
}

export function validateAwsSmokeEndpoint(value, variableName) {
  if (!value) {
    throw new Error(
      `Missing ${variableName}. Configure it in the sandbox GitHub Environment or provide the matching workflow input.`,
    );
  }
  if (value !== value.trim() || /[\r\n]/u.test(value)) {
    throw new Error(
      `${variableName} must not contain surrounding whitespace or line breaks.`,
    );
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid absolute URL.`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`${variableName} must use HTTPS.`);
  }
  if (url.username || url.password) {
    throw new Error(`${variableName} must not contain credentials.`);
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    isNonPublicIpv4(hostname) ||
    isNonPublicIpv6(hostname)
  ) {
    throw new Error(
      `${variableName} must be reachable from a GitHub-hosted runner.`,
    );
  }

  return url.href;
}

export function validateAwsSmokeConfig(environment = process.env) {
  const result = {};
  const errors = [];

  for (const [outputName, variableName] of ENDPOINTS) {
    try {
      result[outputName] = validateAwsSmokeEndpoint(
        environment[variableName],
        variableName,
      );
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      `AWS smoke configuration is invalid:\n- ${errors.join("\n- ")}`,
    );
  }

  return result;
}

function main() {
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: GitHub Actions injects this command-file path.
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) throw new Error("GITHUB_OUTPUT is required.");

  const endpoints = validateAwsSmokeConfig();
  for (const [name, value] of Object.entries(endpoints)) {
    appendFileSync(outputFile, `${name}=${value}\n`, "utf8");
  }
  process.stdout.write(
    "AWS smoke endpoints are configured and safe to test.\n",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
