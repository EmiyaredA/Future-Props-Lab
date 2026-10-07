import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

test("双指缩放在看板往返与默认看板刷新后保持可用", async ({ page }) => {
  const screenshots = resolve(
    process.env.FPL_CANVAS_ZOOM_SCREENSHOTS ||
      "../.local/canvas-pinch/screenshots",
  );
  mkdirSync(screenshots, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "双指缩放回归", kind: "canvas" },
  });
  expect(created.ok()).toBeTruthy();
  const projectId = (await created.json()).id;
  const saved = await page.request.put(
    `/v1/visual-workshop/projects/${projectId}/canvas`,
    {
      headers,
      data: {
        expected_revision: 0,
        edges: [],
        nodes: [
          {
            id: "pinch-text",
            kind: "text",
            title: "缩放测试节点",
            text: "双指捏合保持光标下的画布位置。",
            position: { x: 300, y: 300 },
          },
        ],
      },
    },
  );
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.evaluate((id) => {
    localStorage.setItem(
      `fpl_canvas_viewport_${id}`,
      JSON.stringify({ x: 200, y: 100, zoom: 0.25 }),
    );
  }, projectId);
  await page.goto(`/apps/visual-workshop/projects/${projectId}/canvas`);
  await expect(
    page.getByRole("button", { name: "25%", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: resolve(screenshots, "before-pinch.png") });

  const pinch = async () => {
    const world = page.locator(".visual-canvas-world");
    const previous = await world.getAttribute("style");
    await page.mouse.move(600, 450);
    // Chromium delivers trackpad pinch through wheel events with Ctrl set.
    await page.keyboard.down("Control");
    try {
      await page.mouse.wheel(0, -10);
      await expect(world).not.toHaveAttribute("style", previous!);
    } finally {
      await page.keyboard.up("Control");
    }
    expect(await page.evaluate(() => window.visualViewport?.scale)).toBe(1);
    return await world.getAttribute("style");
  };
  await pinch();
  await expect(
    page.getByRole("button", { name: "28%", exact: true }),
  ).toBeVisible();

  for (let cycle = 0; cycle < 2; cycle++) {
    const previous = await page
      .locator(".visual-canvas-world")
      .getAttribute("style");
    await page.getByRole("button", { name: "看板", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "创作工作台", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "画布", exact: true }).click();
    await expect(page.locator(".visual-canvas-world")).toHaveAttribute(
      "style",
      previous!,
    );
    await pinch();
  }
  await expect(
    page.getByRole("button", { name: "34%", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: resolve(screenshots, "after-view-switch-pinch.png"),
  });

  await page.getByRole("button", { name: "看板", exact: true }).click();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "创作工作台", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await pinch();
  await expect(
    page.getByRole("button", { name: "37%", exact: true }),
  ).toBeVisible();
});
