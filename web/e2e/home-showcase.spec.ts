import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

test("home folders, resources and query handoffs complete their navigation", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1024 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/v1/model-providers", (route) =>
    route.fulfill({ json: { revision: 1, providers: [] } }),
  );
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "AI 应用" })).toBeVisible();
  await setResponsiveTheme(page, "dark");
  await page.screenshot({
    path: info.outputPath("home-1440-dark.png"),
    animations: "disabled",
  });
  const trigger = page.getByRole("button", { name: "视觉与叙事，3 个应用" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const app = page.getByRole("button", { name: "打开视觉创作工坊" });
  await expect(app).toBeVisible();
  await app.focus();
  await page.screenshot({
    path: info.outputPath("home-folder-focus.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Space");
  await app.click();
  await expect(page).toHaveURL(/\/apps\/visual-workshop$/);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "AI 应用" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "首页测试模式" })
    .getByRole("button", { name: "图像", exact: true })
    .click();
  await page.getByRole("button", { name: "开始测试" }).click();
  await expect(page).toHaveURL(/\/model-test\?mode=image$/);
  await expect(
    page.getByText("所选测试模式暂无可用模型，请先在模型服务中接入对应模型。"),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("所选测试模式暂无可用模型，请先在模型服务中接入对应模型。"),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: "AI 应用" })).toBeVisible();
  const top = await page.locator(".studio-global-header").boundingBox();
  await page
    .getByRole("navigation", { name: "首页资源导航" })
    .getByRole("button", { name: "文件管理" })
    .click();
  await expect(page.locator("#home-files")).toBeFocused();
  expect(await page.locator(".studio-global-header").boundingBox()).toEqual(
    top,
  );
  await page.screenshot({
    path: info.outputPath("home-resources-expanded.png"),
    animations: "disabled",
  });
  await page
    .locator("#home-files")
    .getByRole("button", { name: "收起" })
    .click();
  await expect(page.locator("#home-files-content")).toBeHidden();
  await expect(page.locator("#home-tools-content")).toBeVisible();
  await page.screenshot({
    path: info.outputPath("home-resource-collapsed.png"),
    animations: "disabled",
  });
  await page
    .locator("#home-files")
    .getByRole("button", { name: "展开" })
    .click();
  await page.getByRole("button", { name: /文档资料/ }).click();
  await expect(page).toHaveURL(/\/files\?kind=document$/);
  await expect(page.getByRole("combobox", { name: "文件类型" })).toContainText(
    "文档",
  );
  await page.reload();
  await expect(page.getByRole("combobox", { name: "文件类型" })).toContainText(
    "文档",
  );
});

test("home has no clipped content across themes and screen sizes", async ({
  page,
}, info) => {
  for (const viewport of [
    { width: 1440, height: 1024 },
    { width: 1280, height: 800 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    for (const theme of ["dark", "light"]) {
      await page.goto("/home");
      await expect(
        page.getByRole("heading", { name: "AI 应用" }),
      ).toBeVisible();
      await setResponsiveTheme(page, theme);
      expect(
        await page
          .locator(".home-page")
          .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      ).toBe(false);
      expect(
        await page
          .locator(".studio-main")
          .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      ).toBe(false);
      await page.screenshot({
        path: info.outputPath(`home-${viewport.width}-${theme}.png`),
        animations: "disabled",
      });
      await page.getByRole("button", { name: "知识与表达，2 个应用" }).click();
      const paper = page.getByRole("button", { name: "打开思绪工坊" });
      await paper.focus();
      await expect(paper).toBeInViewport();
      expect(
        await paper.evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      ).toBe(false);
      await page.screenshot({
        path: info.outputPath(`home-${viewport.width}-${theme}-open.png`),
        animations: "disabled",
      });
    }
  }
});

test("home uploads into the real isolated file library and shares the result with files", async ({
  page,
}) => {
  await page.goto("/home");
  await expect(page.getByRole("heading", { name: "AI 应用" })).toBeVisible();
  await page.getByLabel("选择上传文件").setInputFiles({
    name: "homepage-upload-proof.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Isolated homepage upload verification"),
  });
  await expect(page.getByRole("status")).toContainText(
    "1 个文件已上传到文件库。",
  );
  await expect(page.locator("#home-files")).toContainText(
    "homepage-upload-proof",
  );
  await page.getByRole("button", { name: /文档资料/ }).click();
  await expect(page).toHaveURL(/\/files\?kind=document$/);
  await expect(page.locator(".file-management-page")).toContainText(
    "homepage-upload-proof",
  );
  await page.goBack();
  await expect(page.locator("#home-files")).toContainText(
    "homepage-upload-proof",
  );
});

test.describe("touch folder selection", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  test("all application papers remain reachable with 44px targets", async ({
    page,
  }) => {
    await page.goto("/home");
    await expect(page.getByRole("heading", { name: "AI 应用" })).toBeVisible();
    for (const name of [
      "视觉与叙事，3 个应用",
      "知识与表达，2 个应用",
      "影像与声音，3 个应用",
      "开发与协作，2 个应用",
    ]) {
      const trigger = page.getByRole("button", { name, exact: true });
      await trigger.click();
      const folder = page.locator('.home-folder[data-open="true"]');
      for (const paper of await folder.locator(".home-folder-paper").all()) {
        const box = await paper.boundingBox();
        expect(box!.width).toBeGreaterThanOrEqual(44);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        await expect(paper).toBeInViewport();
      }
      expect(
        await page
          .locator(".home-page")
          .evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      ).toBe(false);
    }
  });
});
