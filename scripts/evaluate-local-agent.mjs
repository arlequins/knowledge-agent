import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const DEFAULT_CONFIG_PATH = "config/local-agent-evaluation.json";
const DEFAULT_REPORT_PATH = ".local/evaluations/latest.json";

function normalized(value) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
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

function validateConfig(config) {
  if (config.version !== 1)
    throw new Error("Unsupported evaluation config version");
  if (
    !Number.isFinite(config.minimumPassRate) ||
    config.minimumPassRate < 0 ||
    config.minimumPassRate > 1
  )
    throw new Error("minimumPassRate must be between 0 and 1");
  if (!Array.isArray(config.cases) || config.cases.length === 0)
    throw new Error("At least one evaluation case is required");
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
  }
}

async function signIn(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page
    .getByPlaceholder("Enter any login")
    .fill(process.env.LOCAL_AGENT_USER ?? "local-user");
  await page
    .getByPlaceholder("and password")
    .fill(process.env.LOCAL_AGENT_PASSWORD ?? "local-password");
  await page.getByRole("button", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(`${baseUrl}/`);
}

async function ask(page, evaluationCase) {
  await page.getByRole("button", { name: "새 대화" }).first().click();
  const question = page.getByLabel("질문");
  const composer = page.locator("form").filter({ has: question });
  const send = composer.getByRole("button").last();
  await question.fill(evaluationCase.question);
  await send.click();
  await expect(send).toBeDisabled();
  await expect(send).toHaveText("보내기", { timeout: 180_000 });
  const assistant = page
    .locator("article")
    .filter({
      has: page.getByRole("button", { name: "정확함" }),
    })
    .last();
  await expect(assistant).toBeVisible();
  const answer = (await assistant.locator("p").first().innerText()).trim();
  const citations = await assistant.locator("details li").allTextContents();
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
  const summary = summarizeEvaluation(results, config.minimumPassRate);
  const report = {
    baseUrl,
    completedAt: new Date().toISOString(),
    configPath: DEFAULT_CONFIG_PATH,
    model: process.env.LOCAL_AGENT_MODEL ?? "configured-local-model",
    results,
    summary,
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
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
