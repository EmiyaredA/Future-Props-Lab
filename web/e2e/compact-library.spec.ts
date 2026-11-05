import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

async function seedLibrary(page: Page) {
  await page.goto("/files");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  for (const name of [
    "视觉项目 · 分镜",
    "演示模板",
    "录音与字幕",
    "素材参考",
    "工作笔记",
    "角色设计",
    "归档素材",
    "导出成片",
  ]) {
    const response = await page.request.post("/v1/file-folders", {
      headers,
      data: { name, scope: "library" },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
  const buffer = readFileSync("public/brand/visual-workshop-mark.png");
  for (const name of [
    "角色参考.png",
    "场景设定.png",
    "封面草稿.png",
    "色彩研究.png",
    "构图练习.png",
    "项目说明.txt",
  ]) {
    const text = name.endsWith("txt");
    const response = await page.request.post("/v1/files", {
      headers,
      multipart: {
        upload: {
          name,
          mimeType: text ? "text/plain" : "image/png",
          buffer: text ? Buffer.from("项目资料与创作说明。") : buffer,
        },
      },
    });
    expect(response.ok(), await response.text()).toBe(true);
  }
}
async function noOverflow(page: Page) {
  expect(
    await page
      .locator(".studio-main")
      .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
  ).toBe(false);
}

test("compact apps and file collections keep measurable density and keyboard operations", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  await seedLibrary(page);
  for (const viewport of [
    { width: 1440, height: 1024 },
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const theme of ["dark", "light"]) {
      await page.goto("/apps");
      await expect(page.locator(".application-card")).toHaveCount(9);
      await setResponsiveTheme(page, theme);
      await noOverflow(page);
      const rows = await page
        .locator(".application-card")
        .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect()));
      expect(rows.every((r) => r.height <= 98)).toBe(true);
      const columns = rows.filter(
        (r) => Math.abs(r.top - rows[0].top) < 1,
      ).length;
      expect(columns).toBe(
        viewport.width === 1440 ? 4 : viewport.width === 1280 ? 3 : 1,
      );
      expect(
        await page
          .locator(".application-capabilities")
          .evaluateAll((nodes) => nodes.every((n) => n.children.length <= 2)),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`applications-${viewport.width}-${theme}.png`),
        animations: "disabled",
      });
      await page.goto("/files");
      await expect(page.locator(".file-folder-item").first()).toBeVisible();
      await setResponsiveTheme(page, theme);
      await page.getByRole("button", { name: "卡片视图" }).click();
      await noOverflow(page);
      expect(
        await page
          .locator(".file-folder-item")
          .evaluateAll((nodes) =>
            nodes.every((n) => n.getBoundingClientRect().height <= 74),
          ),
      ).toBe(true);
      expect(
        await page
          .locator(".file-asset-item")
          .evaluateAll((nodes) =>
            nodes.every((n) => n.getBoundingClientRect().height <= 134),
          ),
      ).toBe(true);
      await expect(
        page.locator(".file-management-page > header, .file-upload-card"),
      ).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath(`files-grid-${viewport.width}-${theme}.png`),
        animations: "disabled",
      });
      const more = page.getByRole("button", { name: "更多文件操作" });
      await more.focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("menuitem", { name: "导入 ZIP" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(more).toBeFocused();
      await page.getByRole("button", { name: "列表视图" }).click();
      expect(
        await page
          .locator(".file-items article")
          .evaluateAll((nodes) =>
            nodes.every(
              (n) =>
                n.getBoundingClientRect().height <=
                (innerWidth < 760 ? 58 : 50),
            ),
          ),
      ).toBe(true);
      await noOverflow(page);
      await page.screenshot({
        path: info.outputPath(`files-list-${viewport.width}-${theme}.png`),
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.goto("/files");
  await page.getByRole("button", { name: "预览 项目说明" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("项目资料与创作说明。");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "预览 项目说明" }),
  ).toBeFocused();
  await page
    .getByRole("textbox", { name: "搜索文件或文件夹" })
    .fill("不存在的文件名");
  await expect(page.getByText("没有找到匹配的内容")).toBeVisible();
});
