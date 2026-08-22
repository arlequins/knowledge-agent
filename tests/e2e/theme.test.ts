import { expect, test } from "@playwright/test";

test("switches between light and dark themes and remembers the choice", async ({
  page,
}) => {
  await page.goto("/");

  const themeToggle = page.getByRole("button", { name: "테마 변경" });

  await themeToggle.click();
  await page.getByRole("menuitem", { name: "라이트" }).click();
  await expect(page.locator("html")).toHaveClass(/\blight\b/);

  await themeToggle.click();
  await page.getByRole("menuitem", { name: "다크" }).click();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
});
