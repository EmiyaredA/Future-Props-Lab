import { expect, test } from "@playwright/test";
import {
  newDeck,
  newSlide,
} from "../src/features/presentation-workshop/templates";

test("新建模板取消不会创建文稿，模板入口与单页版式分离", async ({ page }) => {
  await page.goto("/apps/presentation-workshop/templates");
  await page.getByRole("button", { name: "新建模板", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "模板名称", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回模板库", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "放弃修改并离开", exact: true })
    .click();
  await expect(page).toHaveURL(/\/apps\/presentation-workshop\/templates$/);
  await expect(page.locator(".master-designer")).toHaveCount(0);
});

test("文稿直接打开、独立预览及明暗主题响应式", async ({ page }, testInfo) => {
  await page.goto("/apps/presentation-workshop");
  const document = {
    ...newDeck(),
    slides: ["cover", "body", "columns", "ending"].map(newSlide),
  };
  const title = `预览验收 ${Date.now()}`;
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title, document },
    },
  );
  expect(response.ok()).toBeTruthy();
  await page.reload();
  const trigger = page.getByRole("button", {
    name: `预览 ${title}`,
    exact: true,
  });
  const cover = page.getByRole("button", {
    name: `打开 ${title}（封面）`,
    exact: true,
  });
  await cover.hover();
  await page.waitForTimeout(500);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await cover.click();
  await expect(page).toHaveURL(/\/apps\/presentation-workshop\/.+/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/apps/presentation-workshop");
  await trigger.click();
  const preview = page.getByRole("dialog", { name: title, exact: true });
  await expect(preview.getByLabel("第 1 页完整预览")).toBeVisible();
  await preview.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(preview.getByLabel("第 2 页完整预览")).toBeVisible();
  await page.keyboard.press("End");
  await expect(
    preview.getByRole("button", { name: "下一页", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("ArrowLeft");
  await expect(preview.getByLabel("第 3 页完整预览")).toBeVisible();
  await preview
    .getByRole("button", { name: "查看第 4 页", exact: true })
    .click();
  await expect(preview.getByLabel("第 4 页完整预览")).toBeVisible();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      globalThis.document.documentElement.dataset.theme = theme;
    }, theme);
    for (const width of [1600, 768, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const paper = preview.locator(".presentation-preview-stage");
      await expect(paper).toBeVisible();
      const paperBox = (await paper.boundingBox())!;
      expect(paperBox.width / paperBox.height).toBeCloseTo(16 / 9, 1);
      await expect(
        preview.getByRole("button", { name: "关闭预览" }),
      ).toBeInViewport();
      await expect(
        preview.getByRole("button", { name: "打开文稿" }),
      ).toBeInViewport();
      const thumbnail = (await preview
        .getByRole("button", { name: "查看第 1 页", exact: true })
        .boundingBox())!;
      expect(thumbnail.width).toBeLessThan(120);
      expect(thumbnail.height).toBeLessThan(100);
      const box = (await preview.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(
        await preview.evaluate(
          (node) => node.scrollWidth <= node.clientWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`preview-${theme}-${width}.png`),
      });
    }
  }
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page
    .getByRole("button", { name: `打开 ${title}`, exact: true })
    .click();
  await expect(page).toHaveURL(/\/apps\/presentation-workshop\/.+/);
});
