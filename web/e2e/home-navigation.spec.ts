import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

test("home keeps one action for each AI destination and omits decorative arrows", async ({
  page,
}, info) => {
  await page.goto("/home");
  const home = page.locator(".home-page");
  await expect(
    home.locator(".lucide-arrow-right, .lucide-arrow-up-right"),
  ).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: "模型服务", exact: true })
      .getByRole("button"),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("region", { name: "编程智能体", exact: true })
      .getByRole("button"),
  ).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "管理集成", exact: true }),
  ).toHaveCount(0);
  for (const viewport of [
    { width: 1440, height: 1024 },
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const theme of ["dark", "light"]) {
      await setResponsiveTheme(page, theme);
      expect(
        await page
          .locator(".studio-main")
          .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      ).toBe(false);
      await home.locator(".home-primary").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`home-${viewport.width}-${theme}.png`),
        animations: "disabled",
      });
      await home.locator("#home-integrations").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: info.outputPath(`resources-${viewport.width}-${theme}.png`),
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page
    .getByRole("navigation", { name: "首页测试模式" })
    .getByRole("button", { name: "视频", exact: true })
    .click();
  const start = page.getByRole("button", { name: "开始测试", exact: true });
  await expect(start).toHaveCount(1);
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/model-test\?mode=video$/);
  await page.goBack();
  await page
    .locator("#home-integrations")
    .getByRole("button", { name: "工具 API 接入外部接口", exact: true })
    .click();
  await expect(page).toHaveURL(/\/integrations\/tool-apis$/);
});
