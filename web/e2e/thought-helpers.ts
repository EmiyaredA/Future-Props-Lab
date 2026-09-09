import { expect, type Page } from "@playwright/test";
export async function newDocument(page: Page) {
  if (!page.url().includes("/knowledge-bases/")) {
    await page.getByRole("button", { name: "创建知识库", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "创建知识库",
      exact: true,
    });
    await dialog.getByRole("textbox").fill(`测试知识库 ${Date.now()}`);
    await dialog.getByRole("button", { name: "确认", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "编辑首页", exact: true }),
    ).toBeVisible();
  }
  await page.locator(".knowledge-directory-add").click();
  await expect(page.getByLabel("笔记标题", { exact: true })).toBeVisible();
}
export async function setThoughtTheme(page: Page, theme: string) {
  if (page.viewportSize()!.width <= 1200)
    await page.getByRole("button", { name: "目录", exact: true }).click();
  await page
    .getByRole("button", {
      name: theme === "light" ? "浅色" : "深色",
      exact: true,
    })
    .click();
  if (page.viewportSize()!.width <= 1200) await page.keyboard.press("Escape");
}
