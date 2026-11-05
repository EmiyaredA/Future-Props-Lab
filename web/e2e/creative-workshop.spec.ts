import { expect, test } from "@playwright/test";

test("publishes a tool draft and installs a fixed copy", async ({ page }) => {
  test.setTimeout(45_000);
  await page.goto("/creative-workshop");
  await expect(page.getByRole("heading", { name: "创意工坊" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "＋ 发布创作" }).click();
  await page.locator(".creative-kind-card").first().click();
  await expect(page.getByRole("heading", { name: "编辑创作" })).toBeVisible();
  await page.getByLabel("名称", { exact: true }).fill("E2E 天气工具");
  await page.getByLabel("一句话简介").fill("查看今天的天气");
  await page
    .getByLabel("URL", { exact: true })
    .fill("https://example.com/weather");
  const saveDraft = page.getByRole("button", { name: "保存草稿", exact: true });
  const saveResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      /^\/v1\/creative-workshop\/items\/[^/]+$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await saveDraft.click();
  expect((await saveResponse).ok()).toBeTruthy();
  await expect(saveDraft).toBeEnabled();
  await page.getByRole("button", { name: "我的创作", exact: true }).click();
  await expect(page.getByText("E2E 天气工具")).toBeVisible();
  await expect(page.locator(".creative-status--draft")).toBeVisible();
  await page.getByRole("button", { name: /E2E 天气工具/ }).click();
  await page.getByRole("button", { name: "预览与发布 →" }).click();
  await expect(page.getByRole("heading", { name: "预览并发布" })).toBeVisible();
  await page.getByRole("button", { name: "确认公开发布" }).click();
  await expect(page.getByRole("heading", { name: "发布成功" })).toBeVisible();
  await page.getByRole("button", { name: "查看作品" }).click();
  await expect(
    page.getByRole("alertdialog", { name: "草稿尚未保存" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "E2E 天气工具", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "检查安装依赖" }).click();
  await expect(page.getByText("将以禁用状态导入")).toBeVisible();
  await page.getByRole("button", { name: "确认安装" }).click();
  await expect(page.getByText("安装完成")).toBeVisible();
});

test("square and creation entry fit narrow and dark viewports", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("future_props_theme", "dark"),
  );
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/creative-workshop");
    await expect(page.getByRole("heading", { name: "创意工坊" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "搜索创作" })).toBeVisible();
    await page.getByRole("button", { name: "＋ 发布创作" }).click();
    await expect(page.locator(".creative-kind-card")).toHaveCount(4);
    const overflow = await page
      .locator(".creative-page")
      .evaluate((element) => element.scrollWidth > element.clientWidth + 2);
    expect(overflow).toBe(false);
  }
});
