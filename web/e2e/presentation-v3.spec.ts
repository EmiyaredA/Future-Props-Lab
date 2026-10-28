import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";
async function create(page: Page) {
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const document = newDeck("blank");
  document.slides[0].elements = [
    newElement("text", {
      id: "title",
      paragraphs: [
        {
          align: "left",
          line_height: 1.3,
          bullet: false,
          numbered: false,
          runs: [
            {
              text: "可编辑演示",
              font: "Arial",
              size: 36,
              color: "#17334A",
              bold: true,
              italic: false,
              underline: false,
            },
          ],
        },
      ],
    }),
  ];
  document.slides[0].animations = [
    {
      id: "fade",
      element_id: "title",
      type: "in",
      effect: "fade",
      direction: "left",
      duration: 100,
      delay: 0,
      trigger: "click",
    },
  ];
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title: "v3 验收", document },
    },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(page.getByRole("group", { name: "幻灯片画布" })).toBeVisible();
  return project.id as string;
}
test("新元素创建、公式上传、保存重开与文稿包交付", async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await create(page);
  for (const kind of ["表格", "图表", "公式"]) {
    await page.getByRole("button", { name: "更多编辑工具" }).click();
    await page
      .getByRole("menuitem", { name: `插入${kind}`, exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: `插入${kind}`,
      exact: true,
    });
    await expect(dialog).toBeVisible();
    if (kind === "公式")
      await dialog
        .getByRole("textbox", { name: "LaTeX 公式" })
        .fill("\\frac{a}{b}+\\sqrt{x}");
    await dialog
      .getByRole("button", {
        name: kind === "公式" ? "插入公式" : "应用",
        exact: true,
      })
      .click();
    await expect(dialog).toHaveCount(0, { timeout: 30000 });
  }
  await expect(
    page.locator(".presentation-canvas [data-element-id]"),
  ).toHaveCount(4);
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  await page.reload();
  await expect(
    page.locator(".presentation-canvas [data-element-id]"),
  ).toHaveCount(4);
  await page.screenshot({ path: info.outputPath("objects.png") });
  await page.getByRole("button", { name: "导出选项" }).click();
  await page
    .getByRole("menuitem", { name: "可编辑文稿包", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "导出 FPLPPT", exact: true });
  const downloaded = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "导出文件", exact: true }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toMatch(/\.fplppt$/);
  const content = await readFile((await file.path())!);
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await page.getByRole("button", { name: "返回文稿列表" }).click();
  await page.getByLabel("选择导入文稿", { exact: true }).setInputFiles({
    name: "roundtrip.fplppt",
    mimeType: "application/zip",
    buffer: content,
  });
  const imported = page.getByRole("dialog", {
    name: "导入演示文稿",
    exact: true,
  });
  await imported
    .getByRole("button", { name: "创建新文稿", exact: true })
    .click();
  await expect(
    page.locator(".presentation-canvas [data-element-id]"),
  ).toHaveCount(4);
  await page.getByRole("button", { name: "导出选项" }).click();
  await page
    .getByRole("menuitem", { name: "导出 PNG 文件", exact: true })
    .click();
  const png = page.waitForEvent("download");
  await page
    .getByRole("dialog", { name: "导出 PNG", exact: true })
    .getByRole("button", { name: "导出文件", exact: true })
    .click();
  const picture = await png;
  expect(picture.suggestedFilename()).toMatch(/\.png$/);
  await picture.saveAs(info.outputPath("export.png"));
});
test("动画、观众同步、黑板标注与关闭清理", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await create(page);
  await page.getByRole("button", { name: "从头放映", exact: true }).click();
  const show = page.getByRole("dialog", { name: "幻灯片放映" });
  await expect(show.locator(".presentation-element-content").first()).toHaveCSS(
    "visibility",
    "hidden",
  );
  const popup = page.waitForEvent("popup");
  await show.getByRole("button", { name: "打开观众窗口", exact: true }).click();
  const audience = await popup;
  await expect(
    audience.getByRole("dialog", { name: "观众放映" }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(
    audience.locator(".presentation-element-content").first(),
  ).toHaveCSS("visibility", "visible");
  await show.getByRole("button", { name: "黑板模式", exact: true }).click();
  await expect(audience.locator(".presentation-show-annotations")).toHaveCSS(
    "background-color",
    "rgb(20, 37, 31)",
  );
  await show.getByRole("button", { name: "画笔", exact: true }).click();
  const board = (await show
    .locator(".presentation-show-annotations")
    .boundingBox())!;
  await page.mouse.move(board.x + 50, board.y + 50);
  await page.mouse.down();
  await page.mouse.move(board.x + 120, board.y + 90, { steps: 5 });
  await page.mouse.up();
  await expect(audience.locator("[data-mark]")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect.poll(() => audience.isClosed()).toBe(true);
});
test("明暗主题与五种宽度保持画布比例和可操作菜单", async ({ page }, info) => {
  await create(page);
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    for (const width of [1600, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      const box = (await page.locator(".presentation-canvas").boundingBox())!;
      expect(box.width / box.height).toBeCloseTo(1280 / 720, 1);
      if (width < 768)
        await page
          .getByRole("button", { name: "文字与格式", exact: true })
          .click();
      const inspector = page.getByRole("complementary", { name: "格式面板" });
      const fields = await inspector
        .getByRole("spinbutton", { name: /页面宽度|页面高度/ })
        .all();
      const [a, b] = await Promise.all(
        fields.map((field) => field.boundingBox()),
      );
      expect(a && b && Math.abs(a.y - b.y) < 1).toBe(true);
      expect(a && b && a.x + a.width <= b.x).toBe(true);
      const tabs = await inspector.getByRole("tab").all();
      for (const tab of tabs)
        expect(
          await tab.evaluate((el) => el.scrollHeight <= el.clientHeight),
        ).toBe(true);
      await page.screenshot({ path: info.outputPath(`${theme}-${width}.png`) });
      if (width < 768)
        await page.getByRole("button", { name: "幻灯片", exact: true }).click();
    }
  }
});
