import {
  newDocument,
  pickNoteMore,
  saveNote,
  setThoughtTheme,
} from "./thought-helpers";
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

test("code and image blocks keep compact spacing when image controls appear", async ({
  page,
}, testInfo) => {
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await page.locator('input[accept=".zip,.md,.markdown"]').setInputFiles({
    name: "块间距.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "```text\nClaude Code = 一个 agent loop\n  + 工具\n```",
    ),
  });
  const code = prose.locator(".document-code-block");
  await expect(code).toBeVisible();
  await code.locator("pre").click();
  await prose.press("ControlOrMeta+End");
  await page
    .locator('.thought-rich-editor input[accept^="image/"]')
    .setInputFiles({
      name: "spacing.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGN8Wh3JQApgIkk1w6gG4gATkergYFQDMYDkUAIAeAUB2WkfhqEAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  const image = prose.locator(".thought-image img");
  await expect(image).toBeVisible();
  for (const width of [1600, 390]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.getByLabel("笔记标题", { exact: true }).click();
      const codeBox = (await code.boundingBox())!;
      const proseBox = (await prose.boundingBox())!;
      const imageBox = (await image.boundingBox())!;
      expect(codeBox.y - proseBox.y).toBeLessThanOrEqual(40);
      expect(imageBox.y - codeBox.y - codeBox.height).toBeGreaterThanOrEqual(0);
      expect(imageBox.y - codeBox.y - codeBox.height).toBeLessThanOrEqual(24);
      await image.hover();
      const toolbar = page.getByRole("toolbar", { name: "图片操作" });
      await expect(toolbar).toHaveCount(0);
      await image.click();
      await expect(toolbar).toBeVisible();
      expect((await image.boundingBox())!.y).toBe(imageBox.y);
      const toolbarBox = (await toolbar.boundingBox())!;
      expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(
        imageBox.y - 8,
      );
      await toolbar.getByRole("button", { name: "裁剪", exact: true }).focus();
      await expect(
        toolbar.getByRole("button", { name: "裁剪", exact: true }),
      ).toBeFocused();
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`spacing-${width}-${theme}.png`),
      });
    }
  }
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "裁剪图片" })).toBeVisible();
});

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
    const more = page.getByRole("button", { name: "笔记更多操作" });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("menuitem", { name: "保存", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("menuitem", { name: "历史记录", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    const chooser = page.waitForEvent("filechooser");
    await pickNoteMore(page, "导入");
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
    const reading = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        new URL(response.url()).pathname ===
          "/v1/thought-workshop/preferences/reading",
    );
    await page.reload();
    expect((await reading).ok()).toBeTruthy();
    await expect(page.locator(".thought-tag")).toHaveText(["产品思考", "灵感"]);
    await page.locator(".knowledge-main").evaluate(async (main) => {
      await new Promise(requestAnimationFrame);
      main.scrollTop = 0;
    });
    const topbar = page.locator(".knowledge-topbar");
    const title = page.getByRole("textbox", { name: "笔记标题", exact: true });
    const topbarBox = (await topbar.boundingBox())!;
    expect(topbarBox.y + topbarBox.height).toBeLessThanOrEqual(
      (await title.boundingBox())!.y,
    );
    const newDocumentButton = page
      .getByRole("button", { name: "新建文档", exact: true })
      .last();
    for (const action of [more, newDocumentButton])
      expect((await action.boundingBox())!.height).toBe(width <= 700 ? 36 : 40);
    if (width >= 1280) expect(topbarBox.height).toBeLessThanOrEqual(60);
    for (const theme of ["light", "dark"]) {
      await setThoughtTheme(page, theme);
      await noOverflow(page);
      await page.screenshot({
        path: testInfo.outputPath(`editor-${theme}.png`),
        fullPage: true,
      });
    }
    await more.click();
    const menu = page.getByRole("menu", {
      name: "笔记更多操作",
      exact: true,
    });
    await expect(menu.getByRole("menuitem", { name: /^更多$/ })).toHaveCount(0);
    const box = (await menu.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    const directory = page.getByRole("button", {
      name: "笔记目录",
      exact: true,
    });
    if (width <= 1200) await directory.click();
    await expect(page.locator(".knowledge-sidebar")).toBeVisible();
    await noOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("directory-dark.png"),
      fullPage: true,
    });
    if (width <= 1200) {
      await page.keyboard.press("Escape");
      await expect(directory).toBeFocused();
    }
    await prose.fill("长正文内容与边界检查。".repeat(300));
    await noOverflow(page);
    await saveNote(page);
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
  await saveNote(page);
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
