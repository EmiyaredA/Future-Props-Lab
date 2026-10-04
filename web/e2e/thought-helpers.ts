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
  const previousUrl = page.url();
  await page
    .getByRole("button", { name: "新建文档", exact: true })
    .last()
    .click();
  await page.getByRole("menuitem", { name: "空白文档", exact: true }).click();
  await expect(page).not.toHaveURL(previousUrl);
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(
    "未命名文档",
  );
}
export async function setThoughtTheme(page: Page, theme: string) {
  if (page.viewportSize()!.width <= 1200) {
    const noteDirectory = page.getByRole("button", {
      name: "笔记目录",
      exact: true,
    });
    if (await noteDirectory.isVisible().catch(() => false))
      await noteDirectory.click();
    else await page.getByRole("button", { name: "目录", exact: true }).click();
  }
  await page
    .getByRole("button", {
      name: theme === "light" ? "浅色" : "深色",
      exact: true,
    })
    .click();
  if (page.viewportSize()!.width <= 1200) await page.keyboard.press("Escape");
}
export async function openNoteMore(page: Page) {
  const more = page.getByRole("button", {
    name: "笔记更多操作",
    exact: true,
  });
  await expect(more).toBeVisible();
  await more.click();
  return page.getByRole("menu", { name: "笔记更多操作", exact: true });
}
export async function saveNote(page: Page) {
  const menu = await openNoteMore(page);
  await menu.getByRole("menuitem", { name: "保存", exact: true }).click();
}
export async function openNoteHistory(page: Page) {
  const menu = await openNoteMore(page);
  await menu.getByRole("menuitem", { name: "历史记录", exact: true }).click();
}
export async function pickNoteMore(page: Page, option: string) {
  const menu = await openNoteMore(page);
  await menu.getByRole("menuitem", { name: option, exact: true }).click();
}
export async function pickProjectMore(page: Page, option: string) {
  let more = page.getByRole("button", {
    name: "知识库更多操作",
    exact: true,
  });
  await expect
    .poll(
      async () =>
        (await more.isVisible()) ||
        (await page
          .getByRole("button", { name: "笔记更多操作", exact: true })
          .isVisible()),
    )
    .toBeTruthy();
  if (!(await more.isVisible().catch(() => false))) {
    await page
      .locator(".knowledge-breadcrumb")
      .getByRole("button")
      .first()
      .click();
    more = page.getByRole("button", {
      name: "知识库更多操作",
      exact: true,
    });
  }
  await expect(more).toBeVisible();
  await more.click();
  await page
    .getByRole("menu", { name: "知识库更多操作", exact: true })
    .getByRole("menuitem", { name: option, exact: true })
    .click();
}
