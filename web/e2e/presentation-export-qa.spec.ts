import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { presentationSample } from "./fixtures/presentation-workshop";
import { newElement } from "../src/features/presentation-workshop/templates";

const directory = process.env.FPL_PRESENTATION_QA_DIR;
const imagePath = process.env.FPL_PRESENTATION_QA_IMAGE;
test("三页实际导出对照与百页负担记录", async ({ page }, testInfo) => {
  test.skip(
    !directory || !imagePath,
    "仅在交付验收时显式指定图片与输出目录导出",
  );
  test.setTimeout(120000);
  await mkdir(directory!, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  await page.getByRole("button", { name: "新建演示文稿", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "新建演示文稿",
    exact: true,
  });
  await dialog.getByRole("textbox").fill("演示工坊验收样稿");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  const canvas = page.getByRole("group", { name: "幻灯片画布" });
  await expect(canvas).toBeVisible();
  await page.getByRole("button", { name: "上传图片", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles(imagePath!);
  await expect(canvas.getByAltText("幻灯片图片")).toBeVisible();
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  const id = page.url().split("/").at(-1)!;
  const endpoint = `/v1/presentation-workshop/projects/${id}`;
  const uploaded = await (await page.request.get(endpoint)).json();
  const assetId = uploaded.document.slides[0].elements.find(
    (e: { kind: string }) => e.kind === "image",
  ).asset_id;
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const document = presentationSample(assetId);
  const changed = await page.request.put(endpoint, {
    headers,
    data: {
      title: uploaded.title,
      document,
      expected_revision: uploaded.revision,
    },
  });
  expect(changed.ok()).toBeTruthy();
  await writeFile(
    join(directory!, "document.json"),
    JSON.stringify(document, null, 2),
  );
  await page.reload();
  await expect(canvas.getByText("Native PPTX", { exact: true })).toBeVisible();
  await page.screenshot({ path: join(directory!, "editor-desktop.png") });
  for (let index = 0; index < 3; index++) {
    await page
      .getByRole("button", { name: `幻灯片 ${index + 1}`, exact: true })
      .click();
    await page.getByRole("button", { name: "放映选项", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "从当前页放映", exact: true })
      .click();
    const show = page.getByRole("dialog", { name: "幻灯片放映" });
    if (index === 1) {
      const image = show.getByAltText("幻灯片图片");
      await expect(image).toBeVisible();
      const ratio = await image.evaluate((img: HTMLImageElement) => {
        const style = getComputedStyle(img);
        return (
          parseFloat(style.width) /
          img.naturalWidth /
          (parseFloat(style.height) / img.naturalHeight)
        );
      });
      expect(ratio).toBeCloseTo(1, 4);
    }
    await show
      .locator(".presentation-slide")
      .screenshot({ path: join(directory!, `browser-slide-${index + 1}.png`) });
    await page.keyboard.press("Escape");
  }
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PPTX", exact: true }).click();
  await (await downloaded).saveAs(join(directory!, "presentation-sample.pptx"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(directory!, "editor-mobile.png") });
  await page.setViewportSize({ width: 1600, height: 1000 });
  if (process.env.FPL_PRESENTATION_QA_SKIP_BENCHMARK) return;
  const large = {
    ...document,
    slides: Array.from({ length: 100 }, (_, i) => ({
      id: `large-${i}`,
      background: "#FFFFFF",
      notes: `第 ${i + 1} 页备注`,
      elements: Array.from({ length: 20 }, (_, j) =>
        newElement("text", {
          x: (j % 5) * 245 + 20,
          y: Math.floor(j / 5) * 160 + 20,
          width: 230,
          height: 140,
        }),
      ),
    })),
  };
  const metrics: Record<string, number | string> = {
    browser: testInfo.project.name,
    pages: 100,
    elementsPerPage: 20,
  };
  let start = performance.now();
  const created = await page.request.post(
    "/v1/presentation-workshop/projects",
    { headers, data: { title: "百页负担测试", document: large } },
  );
  metrics.createMs = performance.now() - start;
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  start = performance.now();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(canvas.locator("[data-element-id]")).toHaveCount(20);
  metrics.loadMs = performance.now() - start;
  const cdp = await page.context().newCDPSession(page);
  metrics.jsHeapBytes = (await cdp.send("Runtime.getHeapUsage")).usedSize;
  start = performance.now();
  await page.getByRole("button", { name: "幻灯片 100", exact: true }).click();
  await expect(page.getByLabel("演示者备注", { exact: true })).toHaveValue(
    "第 100 页备注",
  );
  metrics.switchPageMs = performance.now() - start;
  await page.getByRole("button", { name: /演示者备注/ }).click();
  await page.getByLabel("演示者备注", { exact: true }).fill("百页保存测试");
  start = performance.now();
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  metrics.saveMs = performance.now() - start;
  start = performance.now();
  const output = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PPTX", exact: true }).click();
  await (await output).saveAs(join(directory!, "presentation-100-pages.pptx"));
  metrics.exportMs = performance.now() - start;
  metrics.documentBytes = Buffer.byteLength(JSON.stringify(large));
  await writeFile(
    join(directory!, "browser-performance.json"),
    JSON.stringify(metrics, null, 2),
  );
});
