import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { expect, test } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";

test("百页文稿加载、切页、拖动与导出基准", async ({ page }, info) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const document = newDeck("blank");
  document.slides = Array.from({ length: 100 }, (_, i) => ({
    ...document.slides[0],
    id: `page-${i}`,
    elements: Array.from({ length: 20 }, (_, j) =>
      newElement("rect", {
        id: `element-${i}-${j}`,
        x: 50 + (j % 5) * 230,
        y: 50 + Math.floor(j / 5) * 145,
        width: 180,
        height: 100,
      }),
    ),
  }));
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title: "百页性能样稿", document },
    },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  const timings: {
    load: number;
    switchPage: number;
    drag: number;
    export: number;
    exportBytes: number;
  }[] = [];
  for (let run = 0; run < 3; run++) {
    let start = performance.now();
    await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
    await expect(
      page.locator(".presentation-canvas [data-element-id]"),
    ).toHaveCount(20);
    const load = performance.now() - start;
    start = performance.now();
    await page.getByRole("button", { name: "幻灯片 100", exact: true }).click();
    const shape = page.locator(
      '.presentation-canvas [data-element-id="element-99-6"]',
    );
    await expect(shape).toBeVisible();
    const switchPage = performance.now() - start;
    const box = (await shape.boundingBox())!;
    await shape.click();
    start = performance.now();
    await page.keyboard.down("Alt");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 32,
      box.y + box.height / 2 + 16,
      { steps: 8 },
    );
    await page.mouse.up();
    await page.keyboard.up("Alt");
    const drag = performance.now() - start;
    await page.getByRole("button", { name: "保存文稿", exact: true }).click();
    await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
    const current = await (
      await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
    ).json();
    start = performance.now();
    const exported = await page.request.post(
      `/v1/presentation-workshop/projects/${project.id}/export`,
      {
        headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
        data: { expected_revision: current.revision },
      },
    );
    expect(exported.ok()).toBeTruthy();
    const exportBytes = (await exported.body()).byteLength;
    timings.push({
      load,
      switchPage,
      drag,
      export: performance.now() - start,
      exportBytes,
    });
  }
  await writeFile(
    info.outputPath(
      `performance-${process.env.FPL_PRESENTATION_BENCH_PHASE || "after"}.json`,
    ),
    JSON.stringify(
      {
        phase: process.env.FPL_PRESENTATION_BENCH_PHASE || "after",
        pages: 100,
        elements: 2000,
        viewport: [1600, 1000],
        timings,
      },
      null,
      2,
    ),
  );
});
