import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page, login: string) {
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByPlaceholder("Enter any login").fill(login);
  await page.getByPlaceholder("and password").fill("local-password");
  await page.getByRole("button", { name: "Sign-in" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL("http://localhost:3100/");
}

test("creates an agent workspace and starts a conversation without horizontal overflow", async ({
  page,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const workspaceName = `Research ${suffix}`;

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Knowledge Agent" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);

  await signIn(page, `workspace-${suffix}`);
  await page.getByLabel("워크스페이스 이름").fill(workspaceName);
  await page.getByRole("button", { name: "만들기" }).click();
  await expect(page.locator("select")).toContainText(workspaceName);
  const mobileSidebar = page.getByRole("button", { name: "대화 및 도구" });
  if (await mobileSidebar.isVisible()) await mobileSidebar.click();
  await expect(page.getByLabel("대화 검색")).toBeVisible();
  await page.getByRole("button", { name: "새 대화" }).click();
  await expect(page.getByRole("heading", { name: "새 대화" })).toBeVisible();
  const question = page.getByLabel("질문");
  await expect(question).toBeEnabled();
  await page
    .getByRole("button", {
      name: "이 코드베이스의 핵심 흐름을 근거와 함께 설명해줘",
    })
    .click();
  await expect(question).toHaveValue(
    "이 코드베이스의 핵심 흐름을 근거와 함께 설명해줘",
  );
  await question.fill("첫 줄");
  await question.press("Control+Enter");
  await expect(question).toHaveValue("첫 줄\n");
  await question.fill("Enter로 전송되는 질문");
  await question.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Enter로 전송되는 질문" }),
  ).toBeVisible();
  const stopButton = page.getByRole("button", { name: "중지" });
  const sendButton = page.getByRole("button", { name: "보내기" });
  await expect(stopButton.or(sendButton)).toBeVisible();
  if (await stopButton.isVisible()) await stopButton.click();
  await expect(question).toHaveValue("Enter로 전송되는 질문");
  await expect(sendButton).toBeVisible();

  const modelButton = page.getByRole("button", { name: /모델 ·/ });
  await modelButton.click();
  await page
    .getByRole("combobox", { name: "모델 제공자" })
    .selectOption("gemini");
  await page
    .getByRole("textbox", { name: "개인 API 키" })
    .fill("e2e-gemini-key");
  await page.getByRole("button", { name: "이 모델 사용" }).click();
  await expect(modelButton).toContainText("Gemini");

  await page.reload();
  await page.getByRole("button", { name: /모델 ·/ }).click();
  await page
    .getByRole("combobox", { name: "모델 제공자" })
    .selectOption("gemini");
  await expect(page.getByText("연결됨 · Gemini")).toBeVisible();
  await page.getByRole("button", { name: "저장된 키 삭제" }).click();
  await expect(page.getByRole("button", { name: /모델 ·/ })).toContainText(
    "로컬 Ollama",
  );
});
