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
export async function openNoteMore(page: Page) {
  const more = page.getByRole("combobox", {
    name: "笔记更多操作",
    exact: true,
  });
  await expect(more).toBeVisible();
  await more.click();
  return page.getByRole("listbox", { name: "笔记更多操作", exact: true });
}
export async function saveNote(page: Page) {
  const menu = await openNoteMore(page);
  await menu.getByRole("option", { name: "保存", exact: true }).click();
}
export async function openNoteHistory(page: Page) {
  const menu = await openNoteMore(page);
  await menu.getByRole("option", { name: "历史记录", exact: true }).click();
}
export async function pickNoteMore(page: Page, option: string) {
  const menu = await openNoteMore(page);
  await menu.getByRole("option", { name: option, exact: true }).click();
}
