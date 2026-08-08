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
  await expect(
    directory.getByRole("link", { name: "剧情时间轴" }),
  ).toBeVisible();
  await expect(directory.getByRole("link", { name: "视频生成" })).toHaveCount(
    0,
  );
  await directory.getByRole("link", { name: "剧情时间轴" }).click();
  await expect(page).toHaveURL(/docs\.html\?page=galgame-timeline$/);
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

test("uses a documentation navigation drawer on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs.html?page=galgame-quickstart");
  const directory = page.getByRole("complementary", { name: "功能目录" });
  await expect(directory).not.toHaveClass(/open/);
  await page.getByRole("button", { name: "打开功能目录" }).click();
  await expect(directory).toHaveClass(/open/);
  await directory.getByRole("link", { name: "试玩与线路检查" }).click();
  await expect(directory).not.toHaveClass(/open/);
  await expect(
    page.getByRole("heading", { name: "试玩与线路检查", level: 1 }),
  ).toBeVisible();
});
