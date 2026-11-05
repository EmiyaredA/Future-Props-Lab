import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

const credentialName = "Agent: Codex 飞书 Skill 导入与超长调用凭据名称验收";
const longModel =
  "senseaudio-asr-pro-1.5-260319-long-model-name-for-layout-regression";

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/account/api-keys", (route) =>
    route.fulfill({
      json: [{ id: "key-1", name: credentialName, key_prefix: "fpm_test" }],
    }),
  );
  await page.route("**/v1/model-providers", (route) =>
    route.fulfill({
      json: {
        revision: 1,
        suppliers: [],
        providers: [
          {
            id: "test",
            name: "测试供应商",
            kind: "openai",
            enabled: true,
            models: [
              {
                id: "model-1",
                slug: longModel,
                label: longModel,
                enabled: true,
                capabilities: ["chat"],
                categories: ["text_generation"],
              },
            ],
          },
        ],
      },
    }),
  );
  await page.route("**/v1/llm-call-logs/stats", (route) =>
    route.fulfill({
      json: {
        calls_today: 12,
        total_tokens_today: 24880,
        avg_latency_ms_today: 1234,
        errors_today: 1,
      },
    }),
  );
  await page.route(/\/v1\/llm-call-logs(?:\?|$)/, (route) =>
    route.fulfill({
      json: {
        total: 154,
        page: 1,
        page_size: 25,
        items: Array.from({ length: 8 }, (_, index) => ({
          id: `log-${index}`,
          model: longModel,
          trace_id: `trace-${index}`,
          call_source: "model_inference",
          provider_kind: "openai",
          auth_kind: "management_api_key",
          api_key_name: credentialName,
          api_key_prefix: "fpm_test",
          total_tokens: index % 2 ? null : 1257,
          latency_ms: 1234 + index * 80,
          status: index === 7 ? "error" : "success",
          created_at: `2026-09-10T08:0${index}:00Z`,
        })),
      },
    }),
  );
});

test("filters retain labels through container breakpoints and long options", async ({
  page,
}, info) => {
  await page.goto("/model-call-logs");
  await expect(
    page.getByRole("cell", { name: "独立模型调用", exact: true }).first(),
  ).toBeVisible();
  for (const width of [1024, 1100, 1190, 1280, 1440, 1600, 1920]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await setResponsiveTheme(page, theme);
      const quick = page.locator(".call-log-quick");
      await expect(quick).toBeVisible();
      const metrics = await quick
        .locator(".custom-select-trigger-content > span")
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            width: node.clientWidth,
            content: node.scrollWidth,
          })),
        );
      expect(metrics).toHaveLength(5);
      expect(
        metrics.every(({ width, content }) => width >= content && width > 0),
      ).toBe(true);
      const trigger = await page
        .locator(".call-log-filter-trigger")
        .boundingBox();
      expect(trigger!.width).toBeLessThan(100);
      expect(
        await page
          .locator(".call-log-table tbody tr")
          .evaluateAll((rows) =>
            rows.every((row) => row.getBoundingClientRect().height <= 62),
          ),
      ).toBe(true);
      const search = await page.locator(".call-log-search").boundingBox();
      const group = await quick.boundingBox();
      if (
        await page.locator(".call-logs-page").evaluate((el) => {
          const style = getComputedStyle(el);
          return (
            el.clientWidth -
              parseFloat(style.paddingLeft) -
              parseFloat(style.paddingRight) <
            1180
          );
        })
      )
        expect(group!.y).toBeGreaterThan(search!.y);
      else expect(Math.abs(group!.y - search!.y)).toBeLessThan(2);
      await page.screenshot({
        path: info.outputPath(`logs-${width}-${theme}.png`),
        animations: "disabled",
      });
    }
  }
  const credentials = page.getByRole("combobox", { name: "调用凭据筛选" });
  await credentials.click();
  const option = page.getByRole("option", {
    name: `${credentialName} · fpm_test…`,
    exact: true,
  });
  await expect(option).toBeVisible();
  expect(
    await option.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  const menu = await page
    .getByRole("listbox", { name: "调用凭据筛选" })
    .boundingBox();
  expect(menu!.x).toBeGreaterThanOrEqual(0);
  expect(menu!.x + menu!.width).toBeLessThanOrEqual(1920);
  const response = page.waitForRequest(
    (request) =>
      request.url().includes("llm-call-logs?") &&
      new URL(request.url()).searchParams.get("api_key_id") === "key-1",
  );
  await option.click();
  await response;
  await expect(credentials).toHaveAttribute(
    "title",
    `${credentialName} · fpm_test…`,
  );
  await credentials.focus();
  await page.keyboard.press("ArrowDown");
  await expect(option).toBeFocused();
  await page.keyboard.press("Home");
  const allCredentials = page.getByRole("option", {
    name: "全部调用凭据",
    exact: true,
  });
  await expect(allCredentials).toBeFocused();
  // Reopening the menu beneath a stationary pointer can fire a hover event.
  await option.dispatchEvent("mouseover");
  await page.keyboard.press("Enter");
  await expect(credentials).toHaveAttribute("title", "全部调用凭据");
  await expect(credentials).toBeFocused();
  const filter = page.getByRole("button", { name: "筛选", exact: true });
  await filter.click();
  await expect(page.getByRole("dialog", { name: "日志筛选" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "日志筛选" })).toHaveCount(0);
  await expect(filter).toBeFocused();
});

test("narrow filtering and table scrolling stay within their regions", async ({
  page,
}, info) => {
  await page.goto("/model-call-logs");
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 850 });
    await expect(page.locator(".call-log-quick")).toBeHidden();
    expect(
      await page
        .locator(".call-log-toolbar")
        .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    const table = page.getByRole("region", { name: "调用日志表格" });
    expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "筛选", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "日志筛选" });
    await drawer.getByRole("combobox", { name: "状态筛选" }).click();
    await page.getByRole("option", { name: "失败", exact: true }).click();
    await expect(drawer).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`logs-drawer-${width}.png`),
    });
    await drawer.getByRole("button", { name: "应用筛选" }).click();
    await expect(drawer).toHaveCount(0);
  }
  await page.getByRole("button", { name: "日志 log-0 操作" }).click();
  await expect(page.getByRole("menuitem", { name: "删除日志" })).toBeVisible();
  await page.keyboard.press("Escape");
});
