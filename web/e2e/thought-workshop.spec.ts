import {
  newDocument,
  pickNoteMore,
  pickProjectMore,
  saveNote,
} from "./thought-helpers";
import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";

test("rich notes persist and archives import", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/apps");
  await page.getByRole("button", { name: "效率协作", exact: true }).click();
  await page
    .locator("article")
    .filter({ hasText: "思绪工坊" })
    .getByRole("button")
    .click();
  await expect(
    page.getByRole("heading", { name: "我的知识库", exact: true }),
  ).toBeVisible();
  await newDocument(page);
  const title = `笔记验收 ${Date.now()}`;
  await expect(page.getByLabel("笔记标题", { exact: true })).toBeVisible();
  await page.getByLabel("笔记标题", { exact: true }).fill(title);
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await prose.fill("记录今天的灵感。保留丰富格式。");
  await prose.press("End");
  await prose.press("Enter");
  await prose.pressSequentially("/");
  await page
    .locator(".thought-insert-menu")
    .getByRole("option", { name: /表格/ })
    .click();
  await expect(prose.locator("table")).toBeVisible();
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("笔记标题", { exact: true })).toHaveValue(title);
  await expect(prose).toContainText("记录今天的灵感");
  await expect(prose.locator("table")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("editor-light.png"),
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({
    path: testInfo.outputPath("editor-dark.png"),
    fullPage: true,
  });
  const backupPromise = page.waitForEvent("download");
  await pickProjectMore(page, "导出知识库");
  const backup = await backupPromise;
  const path = await backup.path();
  expect(path).toBeTruthy();
  const imported = page.waitForResponse(
    (response) =>
      response.url().includes("/thought-workshop/imports") &&
      response.request().method() === "POST",
  );
  await page
    .locator('input[type="file"][accept=".zip,.md,.markdown"]')
    .setInputFiles({
      name: "backup.zip",
      mimeType: "application/zip",
      buffer: await fs.readFile(path!),
    });
  expect((await imported).ok()).toBe(true);
  await expect(page.getByText("正在处理…", { exact: true })).not.toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "所有知识库", exact: true }).click();
  await expect(
    page
      .locator(".knowledge-cards .workshop-project-card")
      .filter({ hasText: "测试知识库" })
      .count(),
  ).resolves.toBeGreaterThanOrEqual(2);
  await page.screenshot({
    path: testInfo.outputPath("library-dark.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".knowledge-main")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 2,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("Markdown image packages preserve formulas and diagrams in offline exports", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  const { zipSync, unzipSync, strToU8, strFromU8 } = await import("fflate");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // A small generated fixture, not a production or demonstration asset.
  const validPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGN8Wh3JQApgIkk1w6gG4gATkergYFQDMYDkUAIAeAUB2WkfhqEAAAAASUVORK5CYII=",
    "base64",
  );
  const markdown =
    "# 离线笔记\n\n**重要想法**与 $x^2$。\n\n![橙色图片](images/note.png)\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- [ ] 完成笔记\n\n$$\na+b\n$$\n\n```mermaid\ngraph TD; A-->B\n```\n\n尾部文字";
  await page.goto("/apps/thought-workshop");
  const imported = page.waitForResponse(
    (response) =>
      response.url().includes("/thought-workshop/imports") &&
      response.request().method() === "POST",
  );
  await page
    .locator('input[type="file"][accept=".zip,.md,.markdown"]')
    .setInputFiles({
      name: "markdown.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(
        zipSync({
          "离线笔记.md": strToU8(markdown),
          "images/note.png": validPng,
        }),
      ),
    });
  const response = await imported;
  expect(response.ok(), await response.text()).toBe(true);
  const id = (await response.json()).note_ids[0];
  await page.goto(`/apps/thought-workshop/notes/${id}`);
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await expect(prose.locator("table")).toBeVisible();
  await expect(prose.locator(".thought-image img")).toBeVisible();
  await expect(prose.locator(".katex")).toHaveCount(2);
  await expect(prose.locator(".thought-mermaid-preview svg")).toBeVisible();
  await page.getByRole("button", { name: "编辑图表", exact: true }).click();
  await page.getByLabel("Mermaid 源码").fill("invalid diagram source");
  await expect(page.getByText("图表语法有误，请编辑源码")).toBeVisible();
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.getByLabel("Mermaid 源码").fill("graph TD; A-->B");
  await expect(prose.locator(".thought-mermaid-preview svg")).toBeVisible();
  await page.getByRole("button", { name: "收起源码", exact: true }).click();
  await page
    .locator('.thought-rich-editor input[type="file"][accept^="image/"]')
    .setInputFiles({
      name: "upload.png",
      mimeType: "image/png",
      buffer: validPng,
    });
  await expect(prose.locator(".thought-image img")).toHaveCount(2);
  await prose.press("ControlOrMeta+End");
  await prose.press("Enter");
  await prose.pressSequentially("撤销验证");
  await prose.press("ControlOrMeta+z");
  await expect(prose).not.toContainText("撤销验证");
  await prose.press("ControlOrMeta+Shift+z");
  await expect(prose).toContainText("撤销验证");
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  const saved = await (
    await page.request.get(`/v1/thought-workshop/notes/${id}`)
  ).json();
  expect(JSON.stringify(saved.document)).not.toMatch(/"src"|blob:/);
  await page.reload();
  await expect(prose.locator(".thought-image img")).toHaveCount(2);
  await expect(prose.locator(".katex")).toHaveCount(2);
  const htmlDownload = page.waitForEvent("download");
  await pickNoteMore(page, "导出 HTML 离线阅读");
  const html = await fs.readFile((await (await htmlDownload).path())!, "utf8");
  expect(html).toContain("data:image/png;base64,");
  expect(html).toContain("<math");
  expect(html).toContain("<svg");
  expect(html).not.toMatch(/<script|<iframe|onload=/i);
  const mdDownload = page.waitForEvent("download");
  await pickNoteMore(page, "导出 Markdown");
  await page.getByRole("button", { name: "继续导出", exact: true }).click();
  const files = unzipSync(
    await fs.readFile((await (await mdDownload).path())!),
  );
  const exported = strFromU8(
    files[Object.keys(files).find((key) => key.endsWith(".md"))!],
  );
  expect(exported).toContain("$x^2$");
  expect(exported).toContain("```mermaid");
  expect(
    Object.keys(files).filter((key) => key.startsWith("assets/")),
  ).toHaveLength(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "笔记目录", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "知识库导航" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".knowledge-sidebar")).not.toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("editor-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("composition, failed saves, real revision conflicts, and stale AI selections keep local edits", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await expect(prose).toBeVisible();
  await prose.fill("原始正文");
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  const id = page.url().split("/").pop()!;
  let writes = 0;
  page.on("request", (req) => {
    if (req.method() === "PUT" && req.url().endsWith(`/notes/${id}`)) writes++;
  });
  await prose.evaluate((element) => {
    element.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true, data: "" }),
    );
    element.querySelector("p")!.textContent = "中文组合输入";
    element.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertCompositionText",
        data: "中文组合输入",
        isComposing: true,
      }),
    );
  });
  await page.waitForTimeout(1200);
  expect(writes).toBe(0);
  await prose.evaluate((element) =>
    element.dispatchEvent(
      new CompositionEvent("compositionend", {
        bubbles: true,
        data: "中文组合输入",
      }),
    ),
  );
  await expect.poll(() => writes).toBe(1);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  await page.route(`**/notes/${id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill({ status: 503, json: { detail: "模拟保存失败" } });
  });
  await prose.fill("失败后仍保留的本地正文");
  await saveNote(page);
  await expect(page.getByText("保存失败", { exact: true })).toBeVisible();
  await expect(prose).toContainText("失败后仍保留的本地正文");
  await page.getByRole("button", { name: "所有知识库", exact: true }).click();
  await expect(
    page.getByRole("alertdialog", { name: "仍有未保存的内容" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await page.unroute(`**/notes/${id}`);
  await saveNote(page);
  await expect(page.getByText("已保存", { exact: true })).toBeVisible();
  const server = await (
    await page.request.get(`/v1/thought-workshop/notes/${id}`)
  ).json();
  const csrf = (await context.cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const updated = await page.request.put(`/v1/thought-workshop/notes/${id}`, {
    headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
    data: {
      title: "服务器新标题",
      document: server.document,
      schema_version: 2,
      tags: [],
      pinned: false,
      favorite: false,
      knowledge_base_id: server.knowledge_base_id,
      folder_id: server.folder_id,
      expected_revision: server.revision,
    },
  });
  expect(updated.ok(), await updated.text()).toBe(true);
  await prose.fill("冲突时不能丢失的正文");
  await saveNote(page);
  await expect(page.getByText("保存冲突", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "查看服务器版本", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "服务器新标题", exact: true }),
  ).toBeVisible();
  await expect(prose).toContainText("冲突时不能丢失的正文");
  await page.getByRole("button", { name: "另存本地副本", exact: true }).click();
  await expect.poll(() => page.url().split("/").pop()).not.toBe(id);
  await expect(prose).toContainText("冲突时不能丢失的正文");
});
