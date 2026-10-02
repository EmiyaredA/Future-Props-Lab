import { expect, test } from "@playwright/test";

test("searches, deep-links, themes, and restores documentation history", async ({
  page,
}) => {
  await page.goto("/docs.html?page=visual-video#input-modes");
  await expect(
    page.getByRole("heading", { name: "视频生成", level: 1 }),
  ).toBeVisible();
  await expect(page).toHaveURL(/page=visual-video#input-modes$/);
  await expect(
    page.getByRole("link", { name: "四种输入方式" }),
  ).toHaveAttribute("href", "#input-modes");
  await expect(page.locator(".docs-shot img").first()).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator(".docs-shot img")
        .first()
        .evaluate((image) => image.naturalWidth),
    )
    .toBeGreaterThan(0);

  await page.keyboard.press("/");
  const search = page.getByRole("searchbox", { name: "搜索使用指南" });
  await expect(search).toBeFocused();
  await search.fill("波纹");
  const directory = page.getByRole("complementary", { name: "功能目录" });
  const results = page.getByRole("dialog", { name: "搜索文档", exact: true });
  await expect(results.getByRole("link", { name: /剧情时间轴/ })).toBeVisible();
  await results.getByRole("link", { name: /剧情时间轴/ }).click();
  await expect(
    directory.getByText("Galgame 工坊", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/docs\.html\?page=galgame-timeline/);
  await expect(
    page.getByRole("heading", { name: "剧情时间轴", level: 1 }),
  ).toBeVisible();

  await page.getByRole("button", { name: "浅色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "深色" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  await page.goBack();
  await expect(page).toHaveURL(/page=visual-video#input-modes$/);
  await expect(
    page.getByRole("heading", { name: "视频生成", level: 1 }),
  ).toBeVisible();
});

test("preserves split legacy anchors and resets application navigation after refresh", async ({
  page,
}) => {
  await page.goto("/docs.html?page=overview#model-test-speech");
  await expect(
    page.getByRole("heading", { level: 1, name: "语音识别与结果导出" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator("#model-test-speech")).toBeVisible();
  await page.goto("/docs.html?page=annotation-json");
  const nav = page.getByRole("complementary", { name: "功能目录" });
  await expect(nav.getByRole("link", { name: "返回应用" })).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "协议类型与认证配置" }),
  ).toHaveCount(0);
  await nav.getByRole("link", { name: "返回应用" }).click();
  await expect(page).toHaveURL(/page=apps-overview$/);
  await page.goBack();
  await expect(nav.getByRole("link", { name: "返回应用" })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/page=apps-overview$/);
});

test("search scopes, no results, lightbox and keyboard focus", async ({
  page,
}) => {
  await page.goto("/docs.html?page=visual-video");
  const image = page.getByRole("button", { name: /放大图片/ }).first();
  await image.click();
  await expect(page.getByRole("dialog", { name: "图片预览" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(image).toBeFocused();
  await page.keyboard.press("Control+k");
  const search = page.getByRole("searchbox", { name: "搜索使用指南" });
  await search.fill("fpl_visual_asset_max_bytes");
  const dialog = page.getByRole("dialog", { name: "搜索文档", exact: true });
  await expect(dialog.getByRole("link")).toHaveCount(0);
  await dialog.getByRole("checkbox", { name: "搜索全部分类" }).check();
  await expect(dialog.getByRole("link").first()).toBeVisible();
  await search.fill("没有这个关键词XYZ987");
  await expect(dialog.getByRole("status")).toHaveText("找到 0 篇文章");
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "文档中心分类", exact: true })
    .getByRole("link", { name: "开发者文档" })
    .click();
  await expect(page).toHaveURL(/page=dev-/);
  await page
    .getByRole("navigation", { name: "文档中心分类", exact: true })
    .getByRole("link", { name: "API 参考" })
    .click();
  await expect(page).toHaveURL(/page=(?:api-reference|sdk-reference-)/);
});

test("uses a documentation navigation drawer on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs.html?page=galgame-quickstart");
  const directory = page.getByRole("complementary", {
    name: "功能目录",
    includeHidden: true,
  });
  await expect(directory).not.toHaveClass(/open/);
  await page.getByRole("button", { name: "打开功能目录" }).click();
  await expect(directory).toHaveClass(/open/);
  await expect(directory).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
  await expect(
    directory.getByRole("link", { name: /返回.*应用/ }),
  ).toBeInViewport();
  await directory.getByRole("link", { name: "试玩与线路检查" }).click();
  await expect(directory).not.toHaveClass(/open/);
  await expect(
    page.getByRole("heading", { name: "试玩与线路检查", level: 1 }),
  ).toBeVisible();
});

for (const [id, title] of [
  ["live2d-quickstart", "Live2D 工坊快速开始"],
  ["pet-quickstart", "从角色快照创建桌宠"],
  ["director-quickstart", "导演台快速开始"],
  ["motion-quickstart", "特效制作工坊快速开始"],
]) {
  test(`opens and refreshes new application guide ${id}`, async ({ page }) => {
    await page.goto(`/docs.html?page=${id}`);
    await expect(
      page.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
    await page.reload();
    const directory = page.getByRole("complementary", { name: "功能目录" });
    await directory.getByRole("link", { name: "返回应用" }).click();
    await expect(page).toHaveURL(/page=apps-overview$/);
    await page.goBack();
    await expect(
      page.getByRole("heading", { level: 1, name: title }),
    ).toBeVisible();
  });
}

test("finds new platform guides and retains the thought writing anchor", async ({
  page,
}) => {
  await page.goto("/docs.html?page=thought-workshop#ai-写作");
  await expect(page.locator("#ai-写作")).toBeVisible();
  await page.goto("/docs.html?page=sdk-reference-amadeus#amadeus方法参考");
  await expect(page.locator("#amadeus-桌面助手方法参考")).toBeVisible();
  await page.reload();
  await expect(page.locator("#amadeus-桌面助手方法参考")).toBeVisible();
  await page.goto("/docs.html?page=thought-workshop#ai-写作");
  await page.keyboard.press("/");
  const search = page.getByRole("searchbox", { name: "搜索使用指南" });
  await search.fill("审批恢复");
  const dialog = page.getByRole("dialog", { name: "搜索文档", exact: true });
  await dialog.locator('a[href="/docs.html?page=amadeus-workflows"]').click();
  await expect(page).toHaveURL(/page=amadeus-workflows/);
  await page.keyboard.press("/");
  await search.fill("创意工坊");
  await dialog.locator('a[href="/docs.html?page=creative-overview"]').click();
  await expect(page).toHaveURL(/page=creative-overview/);
});

test("opens a new workshop directory on mobile and closes it with Escape", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs.html?page=motion-quickstart");
  const toggle = page.getByRole("button", { name: "打开功能目录" });
  await toggle.click();
  const directory = page.getByRole("complementary", { name: "功能目录" });
  await directory.getByRole("link", { name: "图层、关键帧与路径遮罩" }).click();
  await expect(page).toHaveURL(/page=motion-layers-masks$/);
  await expect(page.locator(".docs-shot img")).toBeVisible();
  await toggle.click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".docs-sidebar")).not.toHaveClass(/open/);
  await expect(toggle).toBeFocused();
});
