import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const DEFAULT_CONFIG_PATH = "config/local-agent-evaluation.json";
const DEFAULT_REPORT_PATH = ".local/evaluations/latest.json";
const MAX_ANSWER_CHARS = 100_000;
const MAX_CASES = 50;
const MAX_CITATION_CHARS = 50_000;
const MAX_CITATIONS = 12;
const MAX_IDENTIFIER_CHARS = 256;

function normalized(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function boundedString(value, field, limit) {
  if (typeof value !== "string" || value.length > limit)
    throw new Error(`Invalid ${field} in local evaluation evidence`);
  return value;
}

export function hasRepeatedSentence(value) {
  const seen = new Set();
  for (const match of value.matchAll(/[^.!?。！？]{20,}[.!?。！？]/gu)) {
    const sentence = normalized(match[0] ?? "")
      .replace(/\s+/gu, " ")
      .trim();
    if (seen.has(sentence)) return true;
    seen.add(sentence);
  }
  return false;
}

export function scoreEvaluationCase(evaluationCase, response) {
  const answer = normalized(response.answer);
  const citations = normalized(response.citations.join("\n"));
  const answerMatches = evaluationCase.answerMustInclude.map((requirement) => {
    const terms = Array.isArray(requirement) ? requirement : [requirement];
    return {
      matched: terms.some((term) => answer.includes(normalized(term))),
      term: terms.join(" | "),
    };
  });
  const forbiddenAnswerMatches = (
    evaluationCase.answerMustNotInclude ?? []
  ).map((term) => ({
    matched: answer.includes(normalized(term)),
    term,
  }));
  const citationMatches = evaluationCase.citationMustIncludeAny.map((term) => ({
    matched: citations.includes(normalized(term)),
    term,
  }));
  const answerPassed =
    answerMatches.every((match) => match.matched) &&
    forbiddenAnswerMatches.every((match) => !match.matched);
  const citationPassed = citationMatches.some((match) => match.matched);
  return {
    answerMatches,
    answerPassed,
    citationMatches,
    citationPassed,
    forbiddenAnswerMatches,
    id: evaluationCase.id,
    passed: answerPassed && citationPassed,
  };
}

export function summarizeEvaluation(results, minimumPassRate) {
  const passed = results.filter((result) => result.passed).length;
  const passRate = results.length === 0 ? 0 : passed / results.length;
  return {
    cases: results.length,
    failed: results.length - passed,
    minimumPassRate,
    passed,
    passRate,
    thresholdPassed: passRate >= minimumPassRate,
  };
}

export function validateConfig(config) {
  if (config.version !== 1)
    throw new Error("Unsupported evaluation config version");
  if (
    !Number.isFinite(config.minimumPassRate) ||
    config.minimumPassRate < 0 ||
    config.minimumPassRate > 1
  )
    throw new Error("minimumPassRate must be between 0 and 1");
  if (
    !Array.isArray(config.cases) ||
    config.cases.length === 0 ||
    config.cases.length > MAX_CASES
  )
    throw new Error("At least one evaluation case is required");
  const caseIds = new Set();
  for (const evaluationCase of config.cases) {
    if (
      !evaluationCase.id ||
      !evaluationCase.question ||
      !evaluationCase.answerMustInclude?.length ||
      !evaluationCase.citationMustIncludeAny?.length
    )
      throw new Error(
        `Invalid evaluation case: ${evaluationCase.id ?? "unknown"}`,
      );
    if (caseIds.has(evaluationCase.id))
      throw new Error(`Duplicate evaluation case id: ${evaluationCase.id}`);
    caseIds.add(evaluationCase.id);
  }
}

/**
 * Keeps persisted review evidence intentionally small and non-executable.
 * It is never reloaded as configuration, prompts, or model input.
 */
export function serializeEvaluationReport(report) {
  if (
    !Array.isArray(report?.results) ||
    report.results.length === 0 ||
    report.results.length > MAX_CASES
  )
    throw new Error("Invalid local evaluation report");
  return {
    baseUrl: boundedString(report.baseUrl, "base URL", MAX_IDENTIFIER_CHARS),
    completedAt: boundedString(
      report.completedAt,
      "completion timestamp",
      MAX_IDENTIFIER_CHARS,
    ),
    configPath: boundedString(
      report.configPath,
      "config path",
      MAX_IDENTIFIER_CHARS,
    ),
    model: boundedString(report.model, "model", MAX_IDENTIFIER_CHARS),
    results: report.results.map((result) => {
      if (
        !Array.isArray(result.citations) ||
        result.citations.length > MAX_CITATIONS
      )
        throw new Error("Invalid citations in local evaluation evidence");
      return {
        answer: boundedString(result.answer, "answer", MAX_ANSWER_CHARS),
        answerMatches: result.answerMatches,
        answerPassed: Boolean(result.answerPassed),
        citationMatches: result.citationMatches,
        citationPassed: Boolean(result.citationPassed),
        citations: result.citations.map((citation) =>
          boundedString(citation, "citation", MAX_CITATION_CHARS),
        ),
        durationMs:
          Number.isSafeInteger(result.durationMs) && result.durationMs >= 0
            ? result.durationMs
            : 0,
        forbiddenAnswerMatches: result.forbiddenAnswerMatches,
        id: boundedString(result.id, "case id", MAX_IDENTIFIER_CHARS),
        passed: Boolean(result.passed),
        qualityFailures: result.qualityFailures,
        question: boundedString(result.question, "question", MAX_ANSWER_CHARS),
      };
    }),
    summary: report.summary,
  };
}

export function applyAnswerQualityGates(results) {
  const owners = new Map();
  return results.map((result) => {
    const qualityFailures = [];
    const answer = normalized(result.answer).replace(/\s+/gu, " ").trim();
    if (hasRepeatedSentence(result.answer))
      qualityFailures.push("repeated sentence");
    const owner = owners.get(answer);
    if (owner && owner !== result.id)
      qualityFailures.push(`duplicate answer: ${owner}`);
    else if (answer) owners.set(answer, result.id);
    return {
      ...result,
      passed: result.passed && qualityFailures.length === 0,
      qualityFailures,
    };
  });
}

async function signIn(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  const signInButton = page.getByRole("button", {
    name: "Sign in",
    exact: true,
  });
  if ((await signInButton.count()) === 0) {
    const googleSurface = page.getByLabel("Google로 로그인");
    if ((await googleSurface.count()) > 0) {
      throw new Error(
        "Local agent evaluation requires the isolated OIDC test profile; the app is running in Google mode. Run `pnpm test:e2e` or start the app with .env.e2e before replaying the evaluator.",
      );
    }
    throw new Error(
      "Local agent evaluation could not find the OIDC test sign-in surface. Check that the web app is running with the local OIDC profile.",
    );
  }
  await signInButton.click();
  await page
    .getByPlaceholder("Enter any login")
    .fill(process.env.LOCAL_AGENT_USER ?? "local-user");
  await page
    .getByPlaceholder("and password")
    .fill(process.env.LOCAL_AGENT_PASSWORD ?? "local-password");
  await page.getByRole("button", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(`${baseUrl}/`);
  await expect(
    page.getByRole("button", { name: "새 대화" }).first(),
  ).toBeVisible();
}

async function ask(page, evaluationCase) {
  await page.getByRole("button", { name: "새 대화" }).first().click();
  const question = page.getByLabel("질문");
  const composer = page.locator("form").filter({ has: question });
  const send = composer.getByRole("button").last();
  await question.fill(evaluationCase.question);
  await send.click();
  await expect(send).toHaveText("중지");
  await expect(send).toHaveText("보내기", { timeout: 180_000 });
  const assistant = page
    .locator("article")
    .filter({
      has: page.getByRole("button", { name: "정확함" }),
    })
    .last();
  await expect(assistant).toBeVisible();
  const answer = (
    await assistant.getByTestId("message-markdown").innerText()
  ).trim();
  const citations = await assistant.locator("details li").allTextContents();
  await page.getByRole("button", { name: "대화 보관" }).click();
  await expect(page.getByRole("heading", { name: "새 대화" })).toBeVisible();
  return { answer, citations };
}

export async function runLocalAgentEvaluation(options = {}) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const configPath = resolve(root, options.configPath ?? DEFAULT_CONFIG_PATH);
  const reportPath = resolve(root, options.reportPath ?? DEFAULT_REPORT_PATH);
  const baseUrl = (
    options.baseUrl ??
    process.env.LOCAL_AGENT_URL ??
    "http://localhost:3000"
  ).replace(/\/$/, "");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  validateConfig(config);
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    const page = await browser.newPage();
    await signIn(page, baseUrl);
    for (const evaluationCase of config.cases) {
      const startedAt = Date.now();
      const response = await ask(page, evaluationCase);
      const score = scoreEvaluationCase(evaluationCase, response);
      const result = {
        ...score,
        answer: response.answer,
        citations: response.citations,
        durationMs: Date.now() - startedAt,
        question: evaluationCase.question,
      };
      results.push(result);
      console.log(
        `${result.passed ? "PASS" : "FAIL"} ${result.id} (${result.durationMs}ms)`,
      );
    }
  } finally {
    await browser.close();
  }
  const gatedResults = applyAnswerQualityGates(results);
  const summary = summarizeEvaluation(gatedResults, config.minimumPassRate);
  const report = serializeEvaluationReport({
    baseUrl,
    completedAt: new Date().toISOString(),
    configPath: DEFAULT_CONFIG_PATH,
    model: process.env.LOCAL_AGENT_MODEL ?? "configured-local-model",
    results: gatedResults,
    summary,
  });
  await mkdir(dirname(reportPath), { recursive: true, mode: 0o700 });
  // codeql[js/http-to-file-access]: bounded review evidence is ignored local data, never executable or configuration.
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(reportPath, 0o600);
  console.log(
    `Evaluation: ${summary.passed}/${summary.cases} passed (${Math.round(summary.passRate * 100)}%, required ${Math.round(summary.minimumPassRate * 100)}%)`,
  );
  console.log(`Report: ${reportPath}`);
  return report;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runLocalAgentEvaluation().then(
    (report) => {
      if (!report.summary.thresholdPassed) process.exitCode = 1;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
