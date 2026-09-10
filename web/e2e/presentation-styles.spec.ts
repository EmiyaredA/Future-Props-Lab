import { expect, test } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";

test("透明框与虚线箭头可编辑、撤销、保存重开并导出", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const document = newDeck("blank");
  document.slides[0].elements = [
    newElement("roundRect", {
      id: "frame",
      x: 160,
      y: 160,
      fill_opacity: 0,
      stroke_width: 2,
      stroke_dash: "dot",
      corner_radius: 12,
    }),
    newElement("line", {
      id: "connector",
      x: 480,
      y: 230,
      width: 200,
      height: 1,
      rotation: 135,
      stroke_dash: "dash",
      start_arrow: "triangle",
      end_arrow: "triangle",
    }),
  ];
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    { headers, data: { title: "样式保存验证", document } },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  const frame = page.locator('.presentation-canvas [data-element-id="frame"]');
  const connector = page.locator(
    '.presentation-canvas [data-element-id="connector"]',
  );
  const offset = await connector.evaluate((node) => {
    const box = node.getBoundingClientRect();
    const svg = node.querySelector("svg")!.getBoundingClientRect();
    return Math.hypot(box.x - svg.x, box.y - svg.y);
  });
  expect(offset).toBeLessThan(0.1);
  await frame.click({ position: { x: 50, y: 1 } });
  await page.getByLabel("填充不透明度（%）").fill("35");
  await expect(frame.locator("g")).toHaveAttribute("fill-opacity", "0.35");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(frame.locator("g")).toHaveAttribute("fill-opacity", "0");
  await page.getByLabel("圆角半径").fill("24");
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  await page.reload();
  await expect(frame.locator("rect")).toHaveAttribute("rx", "24");
  await expect(
    page.locator('.presentation-canvas [data-element-id="connector"] line'),
  ).toHaveAttribute("marker-end", /url/);
  await page.getByRole("button", { name: "从头放映", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "幻灯片放映" })
      .locator('[data-element-id="frame"] g'),
  ).toHaveAttribute("fill-opacity", "0");
  await page.keyboard.press("Escape");
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PPTX", exact: true }).click();
  expect((await pending).suggestedFilename()).toMatch(/\.pptx$/);
});
