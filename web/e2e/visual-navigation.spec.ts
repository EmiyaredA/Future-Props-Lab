import { expect, test } from "@playwright/test";

test("独立视觉工坊切页保留网页和侧栏，浏览器返回先保存剧本", async ({
  page,
  baseURL,
}, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  // Use the real independent entry against Playwright's isolated backend.
  await page.route(/\/apps\/visual-workshop(?:\/|$)/, async (route) => {
    if (!route.request().isNavigationRequest()) return route.fallback();
    const response = await route.fetch({
      url: new URL("visual.html", baseURL).href,
    });
    await route.fulfill({ response });
  });
  await page.goto("/apps/visual-workshop");
  await expect(
    page.getByRole("heading", { name: "我的创作项目" }),
  ).toBeVisible();
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  const sidebar = page.getByRole("navigation", { name: "视觉创作工坊导航" });
  const originalSidebar = await sidebar.elementHandle();
  const documents: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "document") documents.push(request.url());
  });
  for (const label of ["项目素材库", "设定库", "生成任务", "项目工作台"]) {
    await sidebar.getByRole("button", { name: label, exact: true }).click();
    await expect(sidebar.getByRole("button", { name: label })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      await originalSidebar!.evaluate((element) => element.isConnected),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "新建项目", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "返回项目列表" }),
  ).toBeVisible();
  await expect(page.locator(".canvas-save-state")).toHaveText("已保存");
  const projectId = /\/projects\/([^/]+)/.exec(
    new URL(page.url()).pathname,
  )![1];
  await page.getByRole("button", { name: "剧本", exact: true }).click();
  await page.getByRole("button", { name: "新建集", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "第 1 集", exact: true }),
  ).toBeVisible();
  // Go through history, rather than the header's existing save-and-leave callback.
  await page.evaluate(() => history.back());
  await expect(
    page.getByRole("heading", { name: "我的创作项目" }),
  ).toBeVisible();
  const response = await page.request.get(
    `/v1/visual-workshop/projects/${projectId}/script`,
  );
  expect(response.ok()).toBe(true);
  expect((await response.json()).episodes).toHaveLength(1);
  await page.evaluate(() => history.forward());
  await expect(
    page.getByRole("button", { name: "返回项目列表" }),
  ).toBeVisible();
  await expect(page.locator(".canvas-save-state")).toHaveText("已保存");
  await page.getByRole("button", { name: "剧本", exact: true }).click();
  await page.getByRole("button", { name: "新建集", exact: true }).click();
  const scriptUrl = `**/v1/visual-workshop/projects/${projectId}/script`;
  await page.route(scriptUrl, async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    await route.fulfill({ status: 503, json: { detail: "保存暂时不可用" } });
  });
  await page.evaluate(() => history.back());
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}/canvas$`));
  await expect(
    page.getByRole("button", { name: "第 2 集", exact: true }),
  ).toBeVisible();
  await page.unroute(scriptUrl);
  await page.getByRole("button", { name: "返回项目列表" }).click();
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "项目素材库", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(timeOrigin);
  expect(documents).toEqual([]);
  await page.screenshot({
    path: info.outputPath("visual-navigation-no-reload.png"),
  });
  await page.getByRole("button", { name: "返回应用中心" }).click();
  await expect(page).toHaveURL(/\/apps$/);
  expect(documents).toHaveLength(1);
});
