import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

test("验收模型列表展示图标、名称、调用标识与供应商，支持键盘和窄屏", async ({
  page,
}) => {
  const directory = resolve("../.local/acceptance/screenshots");
  mkdirSync(directory, { recursive: true });
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "模型选择 · 隔离验收", kind: "canvas" },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).id;
  const standard = await page.request.put(
    `/v1/visual-workshop/projects/${id}/acceptance/standard`,
    {
      headers,
      data: {
        expected_revision: 0,
        publish: true,
        document: {
          title: "视觉检查",
          criteria: [{ id: "look", title: "外观", method: "ai" }],
        },
      },
    },
  );
  expect(standard.ok(), await standard.text()).toBeTruthy();
  // Isolate presentation from real provider availability; no model is invoked.
  await page.route(`**/projects/${id}/acceptance/models`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "primary",
            label: "SenseAudio VL",
            slug: "senseaudio-vl-1.0",
            provider_name: "视觉主线路",
            provider_kind: "openai",
          },
          {
            id: "backup",
            label: "SenseAudio VL",
            slug: `vision-${"long-model-id-".repeat(8)}`,
            provider_name: "备用线路",
            provider_kind: "anthropic",
          },
        ],
      },
    }),
  );
  await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
  await page.getByRole("button", { name: "项目验收", exact: true }).click();
  await page.getByRole("button", { name: "验收记录", exact: true }).click();
  const trigger = page.getByRole("combobox", { name: "验收视觉模型" });
  for (const width of [1600, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["浅色", "深色"]) {
      await page.getByRole("button", { name: theme, exact: true }).click();
      await trigger.click();
      const option = page.getByRole("option", {
        name: "SenseAudio VL · senseaudio-vl-1.0 · 视觉主线路",
        exact: true,
      });
      await expect(option.locator("strong")).toHaveText("SenseAudio VL");
      await expect(option.locator("code")).toHaveText("senseaudio-vl-1.0");
      await expect(option.locator(".provider-brand-icon")).toBeVisible();
      const menu = await page
        .getByRole("listbox", { name: "验收视觉模型" })
        .boundingBox();
      expect(menu!.x).toBeGreaterThanOrEqual(0);
      expect(menu!.x + menu!.width).toBeLessThanOrEqual(width);
      await page.screenshot({
        path: resolve(directory, `model-picker-${width}-${theme}.png`),
        animations: "disabled",
      });
      await option.click();
      await expect(trigger).toContainText("senseaudio-vl-1.0");
      await expect(trigger).toBeFocused();
      if (width === 390) {
        const start = await page
          .getByRole("button", { name: "开始验收（0）" })
          .boundingBox();
        expect(start!.width).toBeGreaterThan(250);
      }
      await trigger.press("End");
      await page.keyboard.press("Escape");
      await expect(trigger).toContainText("视觉主线路");
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBeTruthy();
    }
  }
});
