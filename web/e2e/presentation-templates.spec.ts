import { expect, test } from "@playwright/test";

test("模板五种页型、Logo、文稿覆盖、更新和示例复用", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const name = `技术模板 ${Date.now()}`;
  await page.goto("/apps/presentation-workshop/templates");
  await page.getByRole("button", { name: "新建模板", exact: true }).click();
  await page.getByRole("textbox", { name: "模板名称", exact: true }).fill(name);
  for (const type of ["封面", "目录", "章节过渡", "内容页", "结束页"]) {
    await page
      .locator(".master-page-types")
      .getByRole("button", { name: new RegExp(type) })
      .click();
    await expect(page.locator(".master-preview-caption")).toContainText(type);
  }
  await page
    .locator(".master-page-types")
    .getByRole("button", { name: /内容页/ })
    .click();
  await page.getByRole("tab", { name: "背景与固定元素", exact: true }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "test-logo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="116" height="40"><rect width="116" height="40" rx="8" fill="#142b45"/><path d="M12 10h12v20H12zM30 10h12v20H30z" fill="#ee805a"/></svg>',
    ),
  });
  await expect(
    page.getByText("固定图片 / Logo 1", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "标题与页码", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "页标题字号", exact: true })
    .fill("46");
  await expect(
    page.getByRole("spinbutton", { name: "页码字号", exact: true }),
  ).toHaveValue("14");
  await page.getByRole("button", { name: "保存模板", exact: true }).click();
  await expect(page.locator(".master-header")).toContainText("已保存");
  for (const width of [390, 768, 1600]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
  }
  await page.screenshot({
    path: testInfo.outputPath("template-designer.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "返回模板库", exact: true }).click();
  const card = page
    .locator(".master-card")
    .filter({ has: page.getByRole("heading", { name, exact: true }) });
  await card.getByRole("button", { name: "使用模板", exact: true }).click();
  const create = page.getByRole("dialog", {
    name: "新建演示文稿",
    exact: true,
  });
  await create.getByRole("textbox").fill("全局模板旅程");
  await create.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("group", { name: "幻灯片画布" })).toBeVisible();
  const documentUrl = page.url();
  await page.getByRole("button", { name: "文稿模板", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "文稿模板", exact: true });
  await panel.getByRole("button", { name: "添加章节", exact: true }).click();
  const chapter = page.getByRole("dialog", { name: "添加章节", exact: true });
  await chapter.getByRole("textbox").fill("实践与验证");
  await chapter.getByRole("button", { name: "确认", exact: true }).click();
  await panel
    .getByRole("combobox", { name: "当前页所属章节", exact: true })
    .click();
  await page.getByRole("option", { name: "实践与验证", exact: true }).click();
  await panel
    .getByRole("textbox", { name: "当前页标题", exact: true })
    .fill("统一的页标题");
  await panel
    .getByRole("button", { name: "关闭文稿模板", exact: true })
    .click();
  await page.getByRole("button", { name: "新建幻灯片", exact: true }).click();
  await page.getByRole("button", { name: "文稿模板", exact: true }).click();
  await panel
    .getByRole("textbox", { name: "当前页标题", exact: true })
    .fill("技术实现");
  await panel
    .getByRole("button", { name: "编辑全稿样式", exact: true })
    .click();
  await panel
    .getByRole("spinbutton", { name: "页标题字号", exact: true })
    .fill("50");
  await panel
    .getByRole("button", { name: "应用全稿样式", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "关闭文稿模板", exact: true })
    .click();
  const canvas = page.getByRole("group", { name: "幻灯片画布" });
  await expect(
    canvas.locator('[data-template-role="title"] .presentation-text span'),
  ).toHaveCSS("font-size", "50px");
  await canvas.locator('[data-template-role="title"]').dblclick();
  await expect(panel).toBeVisible();
  await panel
    .getByRole("button", { name: "将当前文稿另存为示例", exact: true })
    .click();
  const saveExample = page.getByRole("dialog", {
    name: "另存为示例",
    exact: true,
  });
  await saveExample.getByRole("textbox").fill(name + " 示例");
  await saveExample.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    panel.getByText("示例已保存，可在模板与示例中复用。", { exact: true }),
  ).toBeVisible();
  await panel
    .getByRole("button", { name: "关闭文稿模板", exact: true })
    .click();
  await page.goto("/apps/presentation-workshop/templates");
  await card.getByRole("button", { name: "编辑模板", exact: true }).click();
  await page.getByRole("tab", { name: "背景与固定元素", exact: true }).click();
  await page.getByRole("button", { name: "添加固定文字", exact: true }).click();
  await page
    .getByRole("textbox", { name: "固定文字 2", exact: true })
    .fill("更新后的固定品牌文字");
  await page.getByRole("button", { name: "保存模板", exact: true }).click();
  await expect(page.locator(".master-header")).toContainText("已保存");
  await page.goto(documentUrl);
  await page.getByRole("button", { name: "幻灯片 2", exact: true }).click();
  await page.getByRole("button", { name: "文稿模板", exact: true }).click();
  await panel
    .getByRole("button", { name: "预览模板更新", exact: true })
    .click();
  await expect(panel.getByText("变更预览", { exact: true })).toBeVisible();
  await panel
    .getByRole("button", { name: "确认应用到当前文稿", exact: true })
    .click();
  await expect(panel.getByText("变更预览", { exact: true })).not.toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("document-template.png"),
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "关闭文稿模板", exact: true })
    .click();
  await expect(
    canvas.getByText("更新后的固定品牌文字", { exact: true }),
  ).toBeVisible();
  await expect(
    canvas.locator('[data-template-role="title"] .presentation-text span'),
  ).toHaveCSS("font-size", "50px");
  await page.goto("/apps/presentation-workshop/templates");
  const exampleCard = page.locator(".master-card").filter({
    has: page.getByRole("heading", { name: name + " 示例", exact: true }),
  });
  await exampleCard
    .getByRole("button", { name: "基于示例新建", exact: true })
    .click();
  await create.getByRole("textbox").fill("示例再利用");
  await create.getByRole("button", { name: "确认", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "幻灯片 2", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("group", { name: "幻灯片画布" })
      .getByText("统一的页标题", { exact: true }),
  ).toBeVisible();
});
