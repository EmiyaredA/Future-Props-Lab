import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("documentation learning paths, SDK tabs and mobile navigation", async ({
  page,
}, testInfo) => {
  await page.route("**/v1/account/developer-documents**", (route) =>
    route.fulfill({ status: 403, body: "{}" }),
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/docs.html?page=overview");
  await expect(page.locator(".guide-card-group a")).toHaveCount(4);
  const group = page
    .locator(".docs-nav-group details")
    .filter({ has: page.locator("summary", { hasText: "工作空间与账号" }) });
  await group.locator("summary").focus();
  await page.keyboard.press("Enter");
  await expect(group).toHaveAttribute("open", "");
  await page.keyboard.press("Enter");
  await expect(group).not.toHaveAttribute("open");
  await page.screenshot({ path: testInfo.outputPath("docs-desktop.png") });
  await page
    .locator(".guide-card-group a")
    .filter({ hasText: "编写自动化" })
    .click();
  await expect(page).toHaveURL(/page=sdk-quickstart/);
  await page.goto("/docs.html?page=sdk-first-call");
  await expect(page.getByRole("tab", { name: "Python 同步" })).toBeVisible();
  await page.getByRole("tab", { name: "Python 同步" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Python 异步" })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toContainText("await");
  await page.keyboard.press("End");
  await expect(page.getByRole("tabpanel")).toContainText("curl -X POST");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({ path: testInfo.outputPath("docs-code-dark.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs.html?page=overview");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("docs-mobile.png") });
  await page.locator(".docs-menu-button").click();
  await expect(
    page.getByRole("complementary", { name: "功能目录" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".docs-menu-button")).toBeFocused();
});

test("structured blocks, diagrams, code copying and mobile local scrolling", async ({
  page,
  context,
}, testInfo) => {
  await page.route("**/v1/account/developer-documents**", (route) =>
    route.fulfill({ status: 403, body: "{}" }),
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/docs.html?page=docs-reading");
  await expect(page.locator(".guide-step-number")).toHaveText(["1", "2"]);
  await expect(page.locator(".docs-mermaid-canvas svg")).toBeAttached();
  await expect(page.locator(".katex")).toHaveCount(2);
  await page.getByRole("button", { name: "复制代码", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "已复制", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    '"revision": 2',
  );
  await page.screenshot({ path: testInfo.outputPath("docs-blocks.png") });
  await page
    .locator(".docs-toc")
    .getByRole("link", { name: "流程图与公式", exact: true })
    .click();
  await expect(page).toHaveURL(/#diagrams$/);
  await page.getByRole("button", { name: "查看源码", exact: true }).click();
  await expect(page.locator(".docs-mermaid pre")).toContainText("flowchart LR");
  await page.getByRole("button", { name: "放大", exact: true }).click();
  await page.getByRole("button", { name: "复位", exact: true }).click();
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator(".docs-mermaid-canvas svg")).toBeAttached();
  await page.screenshot({ path: testInfo.outputPath("docs-diagram-dark.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".docs-mermaid-canvas svg")).toBeAttached();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("docs-blocks-mobile.png"),
  });
  await expect(page.getByRole("alert")).toHaveCount(0);
});
