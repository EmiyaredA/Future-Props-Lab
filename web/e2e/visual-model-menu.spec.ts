import { expect, test } from "@playwright/test";

for (const kind of ["image", "video"] as const) {
  test(`看板底部${kind}模型菜单在窗口内展开并可选择`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto("/apps/visual-workshop");
    const csrf = (await page.context().cookies()).find(
      (cookie) => cookie.name === "fpl_csrf",
    )!.value;
    const headers = {
      "X-CSRF-Token": csrf,
      Origin: new URL(page.url()).origin,
    };
    const created = await page.request.post("/v1/visual-workshop/projects", {
      headers,
      data: { title: "模型菜单边界验证", kind: "canvas" },
    });
    expect(created.ok()).toBeTruthy();
    const id = (await created.json()).id as string;
    const base = `/v1/visual-workshop/projects/${id}`;
    try {
      const saved = await page.request.put(`${base}/canvas`, {
        headers,
        data: {
          expected_revision: 0,
          nodes: [
            {
              id: "target",
              kind,
              title: "输出",
              position: { x: 240, y: 120 },
              generation_draft: {
                model_id: "model-0",
                prompt: "test",
                ...(kind === "video" ? { mode: "text" } : {}),
              },
            },
          ],
          edges: [],
        },
      });
      expect(saved.ok(), await saved.text()).toBeTruthy();
      await page.route(
        "**/v1/visual-workshop/generation-options",
        async (route) =>
          route.fulfill({
            json: {
              models: Array.from({ length: 18 }, (_, index) => ({
                id: `model-${index}`,
                provider_id: "fixture",
                provider_name: "ZEALMAN",
                kind,
                slug: `workflow-${index}`,
                label: `工作流模型 ${index}`,
                description: "",
                sizes: ["1024x1024"],
              })),
            },
          }),
      );
      await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
      await page.getByRole("button", { name: "看板", exact: true }).click();
      const trigger = page.getByRole("combobox", { name: "生成模型" });
      await trigger.click();
      const menu = page.getByRole("listbox", { name: "生成模型" });
      await expect(menu).toBeVisible();
      const anchor = (await trigger.boundingBox())!;
      const bounds = (await menu.boundingBox())!;
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(800);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(1440);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(anchor.y);
      await page
        .getByRole("option", { name: "工作流模型 17", exact: false })
        .click();
      await expect(trigger).toContainText("工作流模型 17");
      await expect(menu).toHaveCount(0);
      await trigger.press("ArrowDown");
      await expect(
        page.getByRole("listbox", { name: "生成模型" }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    } finally {
      await page.request.delete(base, { headers });
    }
  });
}
