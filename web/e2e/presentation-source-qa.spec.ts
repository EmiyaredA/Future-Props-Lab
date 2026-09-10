import { expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import type { Deck } from "../src/features/presentation-workshop/types";

test("源稿四页的隔离创建与实际渲染", async ({ page }, info) => {
  test.skip(
    !process.env.FPL_INFOGRAPHIC_INPUT,
    "Source-specific private QA input required",
  );
  test.setTimeout(120000);
  const root = process.env.FPL_INFOGRAPHIC_INPUT!;
  const document: Deck = JSON.parse(
    await fs.readFile(path.join(root, "converted.json"), "utf8"),
  );
  const assets: Record<string, { name: string; path: string }> = JSON.parse(
    await fs.readFile(path.join(root, "assets.json"), "utf8"),
  );
  await page.setViewportSize({ width: 1800, height: 1100 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const mapping: Record<string, string> = {};
  for (const [key, asset] of Object.entries(assets)) {
    const response = await page.request.post("/v1/files", {
      headers,
      multipart: {
        upload: {
          name: asset.name,
          mimeType: asset.name.endsWith(".png") ? "image/png" : "image/jpeg",
          buffer: await fs.readFile(asset.path),
        },
      },
    });
    expect(response.ok()).toBeTruthy();
    mapping[key] = (await response.json()).id;
  }
  for (const slide of document.slides)
    for (const el of slide.elements)
      if (el.asset_id) el.asset_id = mapping[el.asset_id];
  const created = await page.request.post(
    "/v1/presentation-workshop/projects",
    { headers, data: { title: "源稿信息图复刻验证", document } },
  );
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  const canvas = page.locator(".presentation-canvas .presentation-slide");
  await expect(canvas).toBeVisible();
  for (let i = 0; i < 4; i++) {
    await page
      .getByRole("button", { name: `幻灯片 ${i + 1}`, exact: true })
      .click();
    await expect(canvas.locator(".presentation-element")).toHaveCount(
      document.slides[i].elements.length,
    );
    await expect(canvas.locator(".presentation-image-status")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`editor-${i + 1}.png`) });
    await canvas.screenshot({ path: info.outputPath(`slide-${i + 1}.png`) });
    const metrics = await canvas
      .locator(".presentation-text")
      .evaluateAll((nodes) =>
        nodes.map((n) => ({
          id: n.parentElement?.getAttribute("data-element-id"),
          width: n.clientWidth,
          height: n.clientHeight,
          padding: getComputedStyle(n).padding,
          paragraphs: [...n.querySelectorAll("p")].map((p) => ({
            width: p.clientWidth,
            font: getComputedStyle(p).font,
            letterSpacing: getComputedStyle(p).letterSpacing,
            spans: [...p.querySelectorAll("span")].map((s) => ({
              text: s.textContent,
              width: s.getBoundingClientRect().width,
              font: getComputedStyle(s).font,
            })),
          })),
        })),
      );
    await fs.writeFile(
      info.outputPath(`metrics-${i + 1}.json`),
      JSON.stringify(metrics, null, 2),
    );
    const overflow = await canvas
      .locator(".presentation-text")
      .evaluateAll((nodes) =>
        nodes
          .filter((n) => n.scrollHeight > n.clientHeight + 2)
          .map((n) => ({
            id: n.parentElement?.getAttribute("data-element-id"),
            text: n.textContent,
          })),
      );
    await fs.writeFile(
      info.outputPath(`overflow-${i + 1}.json`),
      JSON.stringify(overflow, null, 2),
    );
  }
  await page.getByRole("button", { name: "幻灯片 1", exact: true }).click();
  const title = canvas.getByText("Excel 数据扩充", { exact: true });
  await title.click();
  await expect(
    page.getByRole("toolbar", { name: "所选元素工具栏" }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath("selection-text.png") });
  await title.dblclick();
  const textEditor = page.getByRole("textbox", { name: "编辑幻灯片文字" });
  await textEditor.press("End");
  for (let i = 0; i < 4; i++) await textEditor.press("Shift+ArrowLeft");
  await page.getByLabel("文字颜色", { exact: true }).click();
  await page.screenshot({ path: info.outputPath("selection-editing.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  const shape = document.slides[0].elements.find(
    (e) => e.kind === "roundRect" && e.width > 900 && e.y < 300,
  )!;
  const shapeNode = canvas.locator(`[data-element-id="${shape.id}"]`);
  await shapeNode.click({ position: { x: 50, y: 1 } });
  await expect(
    page.getByRole("toolbar", { name: "所选元素工具栏" }),
  ).toBeVisible();
  await page.getByLabel("描边样式", { exact: true }).click();
  await page.screenshot({ path: info.outputPath("selection-shape.png") });
  await page.keyboard.press("Escape");
  const icon = document.slides[0].elements.find(
    (e) => e.kind === "image" && Math.abs(e.x - 372.61) < 1,
  )!;
  await canvas.locator(`[data-element-id="${icon.id}"]`).click();
  await page.screenshot({ path: info.outputPath("inspector-default.png") });
  const separator = page.getByRole("separator", { name: "调整格式面板宽度" });
  await separator.press("Shift+ArrowLeft");
  await separator.press("Shift+ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", "380");
  await page.screenshot({ path: info.outputPath("inspector-wide.png") });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.screenshot({ path: info.outputPath("inspector-dark.png") });
  const exported = await page.request.post(
    `/v1/presentation-workshop/projects/${project.id}/export`,
    { headers, data: { expected_revision: project.revision } },
  );
  expect(exported.ok()).toBeTruthy();
  await fs.writeFile(info.outputPath("replica.pptx"), await exported.body());
});
