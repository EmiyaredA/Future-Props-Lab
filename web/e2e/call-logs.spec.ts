import { expect, test } from "@playwright/test";
const stats = {
  calls_today: 12,
  total_tokens_today: 24880,
  avg_latency_ms_today: 1234,
  errors_today: 1,
};
test.beforeEach(async ({ page }) => {
  await page.route("**/v1/account/log-workspaces", (route) =>
    route.fulfill({ json: [{ id: "other", name: "演示工作区" }] }),
  );
  await page.route("**/v1/llm-call-logs/stats", (route) =>
    route.fulfill({ json: stats }),
  );
  await page.route(/\/v1\/llm-call-logs(?:\?|$)/, (route) =>
    route.fulfill({
      json: {
        total: 154,
        page: 1,
        page_size: 25,
        items: Array.from({ length: 8 }, (_, index) => ({
          id: `log-${index}`,
          model: index % 2 ? "senseaudio-realtime-1.0" : "senseaudio-s2",
          trace_id: `trace-${index}`,
          call_source: "model_playground",
          provider_kind: index % 2 ? "senseaudio_realtime" : "openai",
          total_tokens: index % 2 ? null : 1257,
          latency_ms: 1234 + index * 80,
          status: index === 7 ? "error" : "success",
          created_at: `2026-09-10T08:0${index}:00Z`,
        })),
      },
    }),
  );
  await page.route("**/v1/account/cross-workspace-call-logs**", (route) =>
    route.fulfill({
      json: route.request().url().includes("/stats")
        ? { ...stats, calls_today: 42 }
        : {
            total: 1,
            page: 1,
            page_size: 25,
            model_options: ["other-model"],
            items: [
              {
                id: "other-log",
                workspace_id: "other",
                model: "other-model",
                call_source: "model_playground",
                provider_kind: "openai",
                total_tokens: 88,
                latency_ms: 450,
                status: "success",
                created_at: "2026-09-10T08:00:00Z",
              },
            ],
          },
    }),
  );
});
test("compact desktop filters, drawer keyboard and both themes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1200 });
  await page.goto("/model-call-logs");
  await expect(
    page.getByRole("heading", { name: "模型调用日志" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "跨工作区查询" })).toHaveCount(
    0,
  );
  const card = await page.locator(".call-log-card").boundingBox();
  const sidebar = await page.locator(".studio-sidebar").boundingBox();
  expect(card!.x - sidebar!.width).toBeLessThanOrEqual(32);
  expect(1920 - card!.x - card!.width).toBeLessThanOrEqual(32);
  const offsets = await page
    .locator(".call-log-toolbar .select-chevron")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        const parent = node.parentElement!.getBoundingClientRect();
        return Math.abs(
          rect.top + rect.height / 2 - parent.top - parent.height / 2,
        );
      }),
    );
  expect(offsets.every((offset) => offset < 0.6)).toBe(true);
  const positions = await page
    .locator(
      ".call-log-toolbar input, .call-log-toolbar .custom-select-trigger, .call-log-filter-trigger",
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().top),
    );
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(2);
  const trigger = page.getByRole("button", { name: "筛选", exact: true });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "日志筛选" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "日志筛选" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  for (const theme of ["浅色", "深色"]) {
    await page.getByRole("button", { name: theme, exact: true }).click();
    await page.screenshot({
      path: `/tmp/call-logs-${theme === "深色" ? "dark" : "light"}.png`,
      fullPage: true,
    });
  }
  await page.getByRole("button", { name: "日志 log-0 操作" }).click();
  await expect(page.getByRole("menuitem", { name: "删除日志" })).toBeVisible();
  await page.keyboard.press("Escape");
});
test("narrow layouts keep filtering reachable without page overflow", async ({
  page,
}) => {
  await page.goto("/model-call-logs");
  for (const width of [1280, 1000, 600, 390]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(
      page.getByRole("button", { name: "筛选", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
  await expect(page.locator(".call-log-quick")).toBeHidden();
  await page.getByRole("button", { name: "筛选", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "日志筛选" });
  await expect(
    drawer.getByRole("combobox", { name: "供应商筛选" }),
  ).toBeVisible();
  await drawer.getByRole("combobox", { name: "状态筛选" }).click();
  await page.getByRole("option", { name: "失败", exact: true }).click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "应用筛选" }).click();
  await expect(drawer).toHaveCount(0);
  await page.screenshot({ path: "/tmp/call-logs-mobile.png", fullPage: true });
});
test("other workspace remains read-only and all scopes show workspace names", async ({
  page,
}) => {
  await page.goto("/model-call-logs");
  await page.getByRole("combobox", { name: "日志工作区" }).click();
  await page.getByRole("option", { name: "演示工作区" }).click();
  await expect(page.getByText("other-model", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("combobox", { name: "日志工作区" }).click();
  await page.getByRole("option", { name: "全部工作区", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "工作区", exact: true }),
  ).toBeVisible();
});
