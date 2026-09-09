import { newDocument, setThoughtTheme } from "./thought-helpers";
import { expect, test, type Page } from "@playwright/test";

const markdown = `有些想法不必立刻完整，先把它们留下来。

## 让写作回到简单

一个安静的空间，一段不被打断的时间。把注意力留给内容，让零散的灵感慢慢长成清晰的思路。

> 好的工具，让你更靠近自己的想法。

## 今天想做的三件事

- [x] 记录一个值得继续探索的想法
- [ ] 整理最近的阅读与观察
- [ ] 为下一次创作留一个开头
`;

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true);
}

for (const width of [1600, 1280, 390]) {
  test(`writing layout, menus and panels at ${width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(90000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({
      width,
      height: width === 1600 ? 1000 : width === 1280 ? 800 : 844,
    });
    await page.goto("/apps/thought-workshop");
    await newDocument(page);
    const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
    await expect(prose).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await setThoughtTheme(page, theme);
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`empty-${theme}.png`),
        fullPage: true,
      });
    }
    const more = page.getByRole("combobox", { name: "知识库更多操作" });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("option", { name: "重命名", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("option", { name: "修改简介", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "导入", exact: true }).click();
    await (
      await chooser
    ).setFiles({
      name: "把想法，慢慢写清楚.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(markdown),
    });
    await expect(prose).toContainText("让写作回到简单");
    await page
      .getByRole("textbox", { name: "笔记标题", exact: true })
      .fill("把想法，慢慢写清楚");
    const tasks = prose.locator('ul[data-type="taskList"] > li');
    await expect(tasks).toHaveCount(3);
    const checkbox = tasks.first().getByRole("checkbox");
    const checkBox = (await checkbox.boundingBox())!;
    const textBox = (await tasks.first().locator("div > p").boundingBox())!;
    expect(
      Math.abs(
        checkBox.y + checkBox.height / 2 - textBox.y - textBox.height / 2,
      ),
    ).toBeLessThan(5);
    await expect(checkbox).toBeChecked();
    await page.getByRole("button", { name: "编辑标签", exact: true }).click();
    await page
      .getByRole("textbox", { name: "笔记标签", exact: true })
      .fill("产品思考，灵感");
    await page
      .getByRole("textbox", { name: "笔记标签", exact: true })
      .press("ControlOrMeta+s");
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.locator(".thought-tag")).toHaveText(["产品思考", "灵感"]);
    const toolbar = page.getByRole("group", {
      name: "排版工具栏",
      exact: true,
    });
    const title = page.getByRole("textbox", { name: "笔记标题", exact: true });
    expect((await toolbar.boundingBox())!.y).toBeLessThan(
      (await title.boundingBox())!.y,
    );
    for (const theme of ["light", "dark"]) {
      await setThoughtTheme(page, theme);
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`editor-${theme}.png`),
        fullPage: true,
      });
    }
    await page.getByRole("combobox", { name: "插入内容", exact: true }).click();
    const menu = page.getByRole("listbox", { name: "插入内容", exact: true });
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "文字颜色", exact: true }).click();
    const colors = page.locator(".custom-color-picker-popover");
    const colorBox = (await colors.boundingBox())!;
    expect(colorBox.x).toBeGreaterThanOrEqual(0);
    expect(colorBox.x + colorBox.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "笔记目录", exact: true }).click();
    await expect(page.locator(".knowledge-sidebar")).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("directory-dark.png"),
      fullPage: true,
    });
    if (width <= 1200) {
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "笔记目录", exact: true }),
      ).toBeFocused();
    }
    await page.route("**/v1/thought-workshop/models", (route) =>
      route.fulfill({ json: [] }),
    );
    await page.getByRole("button", { name: "AI 写作", exact: true }).click();
    await expect(page.locator(".thought-assistant")).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("assistant-dark.png"),
      fullPage: true,
    });
    if (width <= 1200) {
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "AI 写作", exact: true }),
      ).toBeFocused();
    } else await page.getByRole("button", { name: "关闭写作助手" }).click();
    await prose.fill("长正文内容与边界检查。".repeat(300));
    await noOverflow(page);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("adopting a server version replaces displayed and editable tags", async ({
  page,
  context,
}) => {
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  await expect(
    page.getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toBeVisible();
  const id = page.url().split("/").pop()!;
  const server = await (
    await page.request.get(`/v1/thought-workshop/notes/${id}`)
  ).json();
  const csrf = (await context.cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const response = await page.request.put(`/v1/thought-workshop/notes/${id}`, {
    headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
    data: {
      title: server.title,
      document: server.document,
      schema_version: 2,
      tags: ["服务器标签"],
      favorite: false,
      pinned: false,
      knowledge_base_id: server.knowledge_base_id,
      folder_id: server.folder_id,
      expected_revision: server.revision,
    },
  });
  expect(response.ok()).toBe(true);
  await page.getByRole("button", { name: "编辑标签", exact: true }).click();
  await page
    .getByRole("textbox", { name: "笔记标签", exact: true })
    .fill("本地标签");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("保存冲突", { exact: true })).toBeVisible();
  await expect(page.locator(".thought-tag")).toHaveText(["本地标签"]);
  await page
    .getByRole("button", { name: "采用服务器版本", exact: true })
    .click();
  await expect(page.locator(".thought-tag")).toHaveText(["服务器标签"]);
  await page.getByRole("button", { name: "编辑标签", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "笔记标签", exact: true }),
  ).toHaveValue("服务器标签");
});
