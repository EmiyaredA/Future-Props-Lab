import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/v1/tool-navigation/state", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [] }),
    });
  });
  await page.route("**/v1/tool-navigation/tools/*/use", async (route) => {
    const toolId = route.request().url().split("/").at(-2) ?? "tool";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        tool_id: toolId,
        is_favorite: false,
        favorite_updated_at: null,
        last_used_at: "2026-08-03T08:00:00Z",
        use_count: 1,
      }),
    });
  });
});

test("tools are the default route and stay responsive", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page).toHaveURL(/\/tools$/);
  await expect(page.getByRole("heading", { name: "工具导航" })).toBeVisible();

  const navItems = page.getByRole("navigation").getByRole("button");
  await expect(navItems.nth(0)).toContainText("工具导航");
  await expect(navItems.nth(1)).toContainText("基模型");
  await expect(page.locator(".tool-grid")).toHaveCSS(
    "grid-template-columns",
    /\S+px \S+px \S+px/,
  );

  await page.setViewportSize({ width: 900, height: 800 });
  await expect(page.locator(".tools-layout")).toHaveCSS(
    "grid-template-columns",
    /\S+px/,
  );
  await expect(page.locator(".tool-grid")).toHaveCSS(
    "grid-template-columns",
    /\S+px \S+px/,
  );

  await page.setViewportSize({ width: 700, height: 800 });
  await expect(page.locator(".tool-grid")).toHaveCSS(
    "grid-template-columns",
    /\S+px/,
  );
  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("filters tools and records internal usage", async ({ page }) => {
  await page.goto("/tools");
  await page.getByRole("button", { name: "模型工具" }).click();
  await page.getByRole("button", { name: "Token", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "打开Token 估算" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开模型调用日志" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开JSON 格式化" }),
  ).toHaveCount(0);

  const usage = page.waitForRequest(
    "**/v1/tool-navigation/tools/model-call-logs/use",
  );
  await page.getByRole("button", { name: "打开模型调用日志" }).click();
  await usage;
  await expect(page).toHaveURL(/\/model-call-logs$/);
});
