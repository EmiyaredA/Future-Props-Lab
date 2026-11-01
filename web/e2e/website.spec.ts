import { expect, test } from "@playwright/test";

test("website assistant and local-only access controls across themes and viewports", async ({
  page,
}, testInfo) => {
  let local = true;
  await page.route("**/v1/automation/runtime", (route) =>
    route.fulfill({ json: { local_browser: local } }),
  );
  await page.route("**/v1/automation/access", (route) =>
    route.fulfill({
      json: {
        public: { phase: "off", url: "https://studio.example.test", error: "" },
      },
    }),
  );
  await page.route("**/v1/amadeus/conversations", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/v1/amadeus/runs/active", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("**/v1/amadeus/operations", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  for (const width of [390, 768, 1600]) {
    await page.setViewportSize({ width, height: 960 });
    for (const theme of ["light", "dark"]) {
      await page.addInitScript(
        (value) => localStorage.setItem("future_props_theme", value),
        theme,
      );
      await page.goto("/home");
      await page.getByRole("button", { name: "账号菜单", exact: true }).click();
      await expect(
        page.getByRole("menuitem", { name: "本地与公网访问" }),
      ).toBeVisible();
      await page.getByRole("menuitem", { name: "本地与公网访问" }).click();
      await expect(
        page.getByRole("dialog", { name: "本地与公网访问" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "关闭", exact: true }).click();
      await page
        .getByRole("button", { name: "打开 Amadeus", exact: true })
        .click();
      await expect(
        page.getByRole("complementary", { name: "Amadeus 助手" }),
      ).toBeVisible();
      await expect(
        page
          .getByRole("complementary", { name: "Amadeus 助手" })
          .getByRole("button", { name: "关闭 Amadeus", exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBeTruthy();
      await page.screenshot({
        path: testInfo.outputPath(`assistant-${theme}-${width}.png`),
      });
      await page
        .getByRole("button", { name: "关闭 Amadeus", exact: true })
        .last()
        .click();
    }
  }
  local = false;
  await page.reload();
  await page.getByRole("button", { name: "账号菜单", exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "本地与公网访问" }),
  ).toHaveCount(0);
});
