import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import {
  newDeck,
  newSlide,
} from "../src/features/presentation-workshop/templates";

test("每页生成图的上传、存档、重开、下载与移除", async ({ page }, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const document = newDeck("blank");
  document.slides.push(newSlide());
  const created = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers,
      data: { title: `按页图像归档 ${Date.now()}`, document },
    },
  );
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  await page.reload();
  await page
    .getByRole("button", { name: `打开 ${project.title}`, exact: true })
    .click();
  const panel = page.getByRole("region", { name: "页面图像版本" });
  await panel.getByRole("button", { name: "添加图像版本" }).click();
  const picker = page.getByRole("dialog", { name: "选择本页图像版本" });
  await picker.getByRole("tab", { name: "上传图片", exact: true }).click();
  const dataUrl = await page.evaluate(() => {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#152F47";
    context.fillRect(0, 0, 1280, 720);
    context.fillStyle = "#FFFFFF";
    context.font = "bold 60px sans-serif";
    context.fillText("Archived slide image", 80, 180);
    context.fillStyle = "#3AB6AE";
    context.fillRect(80, 260, 1120, 320);
    return canvas.toDataURL("image/png");
  });
  const source = Buffer.from(dataUrl.split(",")[1], "base64");
  await picker.locator('input[type="file"]').setInputFiles({
    name: "generated-slide.png",
    mimeType: "image/png",
    buffer: source,
  });
  await expect(picker).toHaveCount(0);
  await expect(panel.getByRole("img")).toBeVisible();
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  const saved = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  expect(saved.document.slides[0].image_asset_id).toBeTruthy();
  expect(saved.document.slides[1].image_asset_id).toBeNull();
  expect(saved.document.slides[0].elements).toEqual([]);
  expect(saved.document.slides[0].reference).toBeNull();
  await page.getByRole("button", { name: "幻灯片 2", exact: true }).click();
  await expect(panel.getByText("未添加图像版本")).toBeVisible();
  await page.getByRole("button", { name: "幻灯片 1", exact: true }).click();
  await page.reload();
  await expect(panel.getByRole("img")).toBeVisible();
  await panel.getByRole("button", { name: "预览图像版本" }).click();
  const preview = page.getByRole("dialog", { name: "原图预览" });
  await expect(preview.getByRole("img")).toBeVisible();
  await preview.getByRole("button", { name: "关闭原图预览" }).click();
  const pendingDownload = page.waitForEvent("download");
  await panel.getByRole("button", { name: "下载图像" }).click();
  const download = await pendingDownload;
  expect(await fs.readFile((await download.path())!)).toEqual(source);
  await page.getByRole("button", { name: "从头放映", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "幻灯片放映" }).locator("img"),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      globalThis.document.documentElement.dataset.theme = value;
    }, theme);
    for (const width of [1600, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const mobileTab = page.getByRole("button", {
        name: "文字与格式",
        exact: true,
      });
      if (await mobileTab.isVisible()) await mobileTab.click();
      await panel.scrollIntoViewIfNeeded();
      await expect(
        panel.getByRole("button", { name: "下载图像" }),
      ).toBeVisible();
      await panel
        .getByRole("button", { name: "下载图像" })
        .scrollIntoViewIfNeeded();
      await expect(
        panel.getByRole("button", { name: "下载图像" }),
      ).toBeInViewport();
      expect(
        await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: info.outputPath(`archive-${theme}-${width}.png`),
      });
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await panel.getByRole("button", { name: "移除图像版本" }).click();
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  await page.reload();
  await expect(panel.getByText("未添加图像版本")).toBeVisible();
  expect(
    (
      await page.request.get(
        `/v1/files/${saved.document.slides[0].image_asset_id}/content`,
      )
    ).ok(),
  ).toBeTruthy();
  await panel.getByRole("button", { name: "添加图像版本" }).click();
  await page
    .getByRole("dialog", { name: "选择本页图像版本" })
    .getByRole("button", { name: /^归档 generated-slide(?:\.png)?$/ })
    .click();
  await expect(
    panel.getByRole("button", { name: "预览图像版本" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(panel.getByText("未添加图像版本")).toBeVisible();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(
    panel.getByRole("button", { name: "预览图像版本" }),
  ).toBeVisible();
});
