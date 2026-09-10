import { newDocument, setThoughtTheme } from "./thought-helpers";
import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAI0lEQVR4nGN8Wh3JQApgIkk1w6gG4gATkergYFQDMYDkUAIAeAUB2WkfhqEAAAAASUVORK5CYII=",
  "base64",
);

test("visible insert controls, file cards, downloads and portable archives across themes and sizes", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await expect(prose).toBeVisible();
  await prose.pressSequentially("/");
  for (const name of ["表格", "图片", "附件"])
    await expect(
      page.getByRole("option", { name: new RegExp(name) }),
    ).toBeVisible();
  await page.keyboard.press("Escape");
  await page
    .getByRole("textbox", { name: "笔记标题", exact: true })
    .fill("把资料，放进思路里");
  await prose.fill(
    "记录灵感，也留下支撑想法的资料。\n项目计划与阅读笔记，可以在这里一起整理。",
  );
  await prose.press("ControlOrMeta+End");
  await prose.press("Enter");
  await prose.pressSequentially("/");
  await page.getByRole("option", { name: /表格/ }).click();
  await expect(prose.locator("table")).toBeVisible();
  const cells = prose.locator("th p, td p");
  for (const [i, text] of [
    "资料",
    "用途",
    "进度",
    "项目计划",
    "梳理目标",
    "已整理",
    "阅读摘录",
    "补充观点",
    "进行中",
  ].entries())
    await cells.nth(i).fill(text);
  await prose.press("ControlOrMeta+End");
  await prose.press("ArrowDown");
  await prose.press("Enter");
  await page
    .locator('.thought-rich-editor input[accept^="image/"]')
    .setInputFiles({
      name: "灵感色卡.png",
      mimeType: "image/png",
      buffer: png,
    });
  await expect(prose.locator(".thought-image img")).toHaveCount(1);
  await prose.locator(".thought-image img").click();
  await page.getByRole("button", { name: "图片设置", exact: true }).click();
  await page.getByLabel("图片宽度", { exact: true }).fill("120");
  await page.getByLabel("图片图注", { exact: true }).fill("灵感色卡图注");
  await expect(prose.locator(".thought-image-caption")).toHaveText(
    "灵感色卡图注",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "图片居中", exact: true }).click();
  await page.getByRole("button", { name: "裁剪", exact: true }).click();
  const cropDialog = page.getByRole("dialog", { name: "裁剪图片" });
  await cropDialog.getByRole("button", { name: "4:3", exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath("image-crop-1600-light.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("image-crop-390-light.png"),
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await cropDialog
    .getByRole("button", { name: "应用裁剪", exact: true })
    .click();
  await expect(prose.locator(".thought-image-caption")).toHaveText(
    "灵感色卡图注",
  );
  await prose.press("ControlOrMeta+End");
  await prose.press("Enter");
  const chooser = page.waitForEvent("filechooser");
  await prose.pressSequentially("/");
  await page.getByRole("option", { name: /附件/ }).click();
  await (
    await chooser
  ).setFiles([
    {
      name: "项目计划.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("附件原文：只下载，不发送给模型。"),
    },
    {
      name: "参考资料.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nfixture"),
    },
  ]);
  await expect(prose.locator(".thought-attachment")).toHaveCount(2);
  await prose.press("ControlOrMeta+z");
  await expect(prose.locator(".thought-attachment")).toHaveCount(1);
  await expect(prose.locator(".thought-image-caption")).toHaveText(
    "灵感色卡图注",
  );
  await prose.press("ControlOrMeta+Shift+z");
  await expect(prose.locator(".thought-attachment")).toHaveCount(2);
  await prose.press("ControlOrMeta+End");
  await prose.press("Enter");
  await prose.pressSequentially("https://example.com");
  await prose.press("Space");
  await expect(prose.locator('a[href="https://example.com"]')).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator(".thought-save-state")).toContainText("已保存");
  await page.reload();
  await expect(prose.locator(".thought-attachment")).toHaveCount(2);
  await expect(prose.locator(".thought-image-caption")).toHaveText(
    "灵感色卡图注",
  );
  await expect(prose.locator(".thought-image-align-center")).toBeVisible();
  await expect(prose.locator(".thought-image-crop-viewport")).toBeVisible();
  const fileDownload = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下载 项目计划.txt", exact: true })
    .click();
  expect(await fs.readFile((await (await fileDownload).path())!, "utf8")).toBe(
    "附件原文：只下载，不发送给模型。",
  );
  for (const width of [1600, 1280, 390]) {
    await page.setViewportSize({
      width,
      height: width === 1600 ? 1000 : width === 1280 ? 800 : 844,
    });
    for (const theme of ["light", "dark"]) {
      await setThoughtTheme(page, theme);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 2,
        ),
      ).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await prose.locator(".thought-image img").click();
      const imageToolbar = page.getByRole("toolbar", { name: "图片操作" });
      await expect(imageToolbar).toBeVisible();
      expect(
        await imageToolbar.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`attachments-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  const htmlDownload = page.waitForEvent("download");
  await page.getByRole("combobox", { name: "导出笔记", exact: true }).click();
  await page
    .getByRole("option", { name: "HTML 离线阅读", exact: true })
    .click();
  const htmlArchive = await htmlDownload;
  expect(htmlArchive.suggestedFilename()).toMatch(/-html.zip$/);
  const htmlFiles = unzipSync(await fs.readFile((await htmlArchive.path())!));
  expect(
    Object.keys(htmlFiles).filter((k) => k.startsWith("attachments/")),
  ).toHaveLength(2);
  const exportedHtml = strFromU8(
    htmlFiles[Object.keys(htmlFiles).find((k) => k.endsWith(".html"))!],
  );
  expect(exportedHtml).toContain("attachments/");
  expect(exportedHtml).toContain("thought-export-image-crop");
  expect(exportedHtml).toContain("<figcaption>灵感色卡图注</figcaption>");
  expect(exportedHtml).toContain('data-align="center"');
  const mdDownload = page.waitForEvent("download");
  await page.getByRole("combobox", { name: "导出笔记", exact: true }).click();
  await page.getByRole("option", { name: "Markdown", exact: true }).click();
  await page.getByRole("button", { name: "继续导出", exact: true }).click();
  const md = await fs.readFile((await (await mdDownload).path())!);
  const files = unzipSync(md);
  expect(
    Object.keys(files).filter((k) => k.startsWith("attachments/")),
  ).toHaveLength(2);
  const markdown = strFromU8(
    files[Object.keys(files).find((key) => key.endsWith(".md"))!],
  );
  expect(markdown).toContain("*灵感色卡图注*");
  const mdImported = page.waitForResponse(
    (r) =>
      r.url().includes("/thought-workshop/imports") &&
      r.request().method() === "POST",
  );
  await page.locator('input[accept=".zip,.md,.markdown"]').setInputFiles({
    name: "markdown.zip",
    mimeType: "application/zip",
    buffer: md,
  });
  expect((await mdImported).ok()).toBe(true);
  await expect(prose.locator(".thought-attachment")).toHaveCount(2);
  await expect(prose.locator("table")).toBeVisible();
  await expect(prose.locator('a[href="https://example.com"]')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "下载 项目计划.txt", exact: true }),
  ).toBeVisible();
  const backupDownload = page.waitForEvent("download");
  await page.getByRole("combobox", { name: "知识库更多操作" }).click();
  await page.getByRole("option", { name: "导出知识库", exact: true }).click();
  const backup = await fs.readFile((await (await backupDownload).path())!);
  expect(
    JSON.parse(strFromU8(unzipSync(backup)["manifest.json"])).version,
  ).toBe(5);
  const imported = page.waitForResponse(
    (r) =>
      r.url().includes("/thought-workshop/imports") &&
      r.request().method() === "POST",
  );
  await page.locator('input[accept=".zip,.md,.markdown"]').setInputFiles({
    name: "backup.zip",
    mimeType: "application/zip",
    buffer: backup,
  });
  expect((await imported).ok()).toBe(true);
});

test("failed attachments retry and external file drops keep images and files distinct", async ({
  page,
}) => {
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  const prose = page.getByRole("textbox", { name: "笔记正文", exact: true });
  await expect(prose).toBeVisible();
  let attempts = 0;
  await page.route("**/v1/thought-workshop/attachments", (route) => {
    if (attempts++ === 0)
      return route.fulfill({ status: 503, json: { detail: "暂时不可用" } });
    return route.continue();
  });
  await page.getByLabel("选择附件", { exact: true }).setInputFiles({
    name: "重试.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("retry"),
  });
  await expect(
    page.getByRole("button", { name: "重试", exact: true }),
  ).toBeVisible();
  await expect(prose.locator(".thought-attachment")).toHaveCount(0);
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(prose.locator(".thought-attachment")).toHaveCount(1);
  const transfer = await page.evaluateHandle((base64) => {
    const data = new DataTransfer();
    data.items.add(
      new File(["拖入的附件"], "拖入.txt", { type: "text/plain" }),
    );
    data.items.add(
      new File(
        [Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))],
        "拖入.png",
        { type: "image/png" },
      ),
    );
    return data;
  }, png.toString("base64"));
  const dropBox = (await prose.boundingBox())!;
  await prose.dispatchEvent("drop", {
    dataTransfer: transfer,
    clientX: dropBox.x + 20,
    clientY: dropBox.y + 20,
  });
  await expect(prose.locator(".thought-attachment")).toHaveCount(2);
  await expect(prose.locator(".thought-image img")).toHaveCount(1);
});

test("a completed upload cannot insert into another note", async ({ page }) => {
  await page.goto("/apps/thought-workshop");
  await newDocument(page);
  await expect(
    page.getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toBeVisible();
  let finish!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route("**/v1/thought-workshop/attachments", async (route) => {
    const response = await route.fetch();
    entered();
    await gate;
    await route.fulfill({ response });
  });
  await page.getByLabel("选择附件", { exact: true }).setInputFiles({
    name: "延迟.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("delayed"),
  });
  await started;
  await expect(page.getByLabel("文件上传状态")).toContainText("上传中");
  const firstUrl = page.url();
  await newDocument(page);
  await expect(page).not.toHaveURL(firstUrl);
  const completed = page.waitForResponse((r) =>
    r.url().endsWith("/thought-workshop/attachments"),
  );
  finish();
  await completed;
  await expect(page.locator(".thought-attachment")).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("textbox", { name: "笔记正文", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".thought-attachment")).toHaveCount(0);
});
