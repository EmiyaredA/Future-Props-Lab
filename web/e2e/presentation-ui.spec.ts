import { expect, test, type Page } from "@playwright/test";
import { newDeck } from "../src/features/presentation-workshop/templates";

async function create(page: Page, title = `界面验收 ${Date.now()}`) {
  await page.goto("/apps/presentation-workshop");
  await page.getByRole("button", { name: "新建演示文稿", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "新建演示文稿",
    exact: true,
  });
  await dialog.getByRole("textbox").fill(title);
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByRole("group", { name: "幻灯片画布" })).toBeVisible();
  return title;
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
}

test("文稿列表、卡片菜单与独立真实页面截图", async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const title = await create(page, "未命名演示");
  await page.getByRole("button", { name: "返回文稿列表" }).click();
  await expect(
    page.getByRole("button", { name: `打开 ${title}`, exact: true }),
  ).toBeVisible();
  await expect(page.locator(".presentation-starters")).toHaveCount(0);
  const card = page.locator(".presentation-project-card").first();
  await expect(card.getByText("让想法，被看见", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("presentation-library.png") });
  await card.getByRole("button", { name: /文稿操作/ }).click();
  const rename = page.getByRole("menuitem", { name: /^重命名/ });
  await expect(rename).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(card.getByRole("button", { name: /文稿操作/ })).toBeFocused();
  await page.getByRole("button", { name: "新建演示文稿", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "确认", exact: true })
    .click();
  await page.getByRole("button", { name: "新幻灯片版式", exact: true }).click();
  await page.getByRole("menuitem", { name: "图文双栏", exact: true }).click();
  await expect(
    page.locator(".presentation-canvas [data-element-id]"),
  ).toHaveCount(5);
  await page.getByRole("button", { name: "返回文稿列表", exact: true }).click();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const width of [1600, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
      const thumbnail = card.locator(".presentation-preview");
      const size = (await thumbnail.boundingBox())!;
      expect(size.width / size.height).toBeCloseTo(16 / 9, 1);
      if (width === 390)
        await page.screenshot({
          path: info.outputPath(`library-mobile-${theme}.png`),
        });
    }
  }
});

test("编辑器菜单、备注、背景、实际缩放与独立截图", async ({ page }, info) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await create(page, "未命名演示");
  const canvas = page.getByRole("group", { name: "幻灯片画布" });
  await expect(page.getByRole("textbox", { name: "演示者备注" })).toHaveCount(
    0,
  );
  await page.screenshot({ path: info.outputPath("presentation-editor.png") });
  const fittedWidth = (await canvas.boundingBox())!.width;
  await page.getByRole("slider", { name: "画布缩放" }).fill("150");
  await expect(page.getByLabel("实际缩放比例")).toHaveText("150%");
  expect((await canvas.boundingBox())!.width).toBeCloseTo(1920, 0);
  await noOverflow(page);
  await page.getByRole("button", { name: "适应页面", exact: true }).click();
  await expect
    .poll(async () => (await canvas.boundingBox())!.width)
    .toBeCloseTo(fittedWidth, 0);
  await page.getByRole("button", { name: /演示者备注/ }).click();
  await page
    .getByRole("textbox", { name: "演示者备注" })
    .fill("备注折叠与保存验收");
  await page.getByRole("button", { name: /演示者备注/ }).click();
  await page.getByRole("button", { name: "新幻灯片版式" }).click();
  await page.getByRole("menuitem", { name: "结束页", exact: true }).click();
  await expect(canvas.getByText("感谢聆听", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "插入图形" }).click();
  await page.getByRole("button", { name: "椭圆", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "元素", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "页面", exact: true }).click();
  await page
    .getByRole("button", { name: "页面背景 #EEF7F9", exact: true })
    .click();
  await expect(canvas.locator(".presentation-slide")).toHaveCSS(
    "background-color",
    "rgb(238, 247, 249)",
  );
  await page.getByRole("button", { name: "放映选项" }).click();
  await page.getByRole("menuitem", { name: "从当前页放映" }).click();
  const show = page.getByRole("dialog", { name: "幻灯片放映" });
  await expect(show.getByText("感谢聆听", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 PPTX", exact: true }).click();
  await (await download).saveAs(info.outputPath("presentation-ui.pptx"));
  await page.reload();
  await page.getByRole("button", { name: /演示者备注/ }).click();
  await expect(page.getByRole("textbox", { name: "演示者备注" })).toHaveValue(
    "备注折叠与保存验收",
  );
  await page.getByRole("button", { name: /演示者备注/ }).click();
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const width of [1600, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(canvas).toBeVisible();
      await noOverflow(page);
      await expect
        .poll(async () => {
          const box = (await canvas.boundingBox())!;
          const actual = Number(
            (await page.getByLabel("实际缩放比例").textContent())!.replace(
              "%",
              "",
            ),
          );
          return Math.abs(actual - (box.width / 1280) * 100);
        })
        .toBeLessThanOrEqual(1);
      if (width === 390 || width === 1600)
        await page.screenshot({
          path: info.outputPath(`editor-${width}-${theme}.png`),
        });
    }
  }
});

test("首页空状态、搜索无结果和加载失败分别呈现", async ({ page }) => {
  await page.goto("/apps/presentation-workshop");
  let fail = false;
  await page.route("**/v1/presentation-workshop/projects?*", async (route) => {
    if (fail)
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({ detail: "测试加载失败" }),
      });
    else
      await route.fulfill({
        json: { items: [], total: 0, offset: 0, limit: 24 },
      });
  });
  await page.reload();
  await expect(page.getByText("从你的第一份演示开始")).toBeVisible();
  await page.getByRole("textbox", { name: "搜索文稿" }).fill("不存在");
  await expect(page.getByText("没有找到匹配的文稿")).toBeVisible();
  fail = true;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "重试", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  expect(await page.getByText("从你的第一份演示开始").count()).toBe(0);
});

test("只读首页隐藏新建与操作菜单，仍可打开文稿", async ({ page }) => {
  await page.goto("/apps/presentation-workshop");
  await page.route("**/v1/auth/me", async (route) => {
    const response = await route.fetch(),
      principal = await response.json();
    principal.workspace.permission_keys = ["content.read", "files.read"];
    await route.fulfill({ response, json: principal });
  });
  await page.route("**/v1/presentation-workshop/projects?*", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "read-only-preview",
            title: "只读文稿",
            first_slide: newDeck().slides[0],
            slide_count: 1,
            revision: 1,
            updated_at: "2026-09-10T00:00:00Z",
          },
        ],
        total: 1,
        offset: 0,
        limit: 24,
      },
    }),
  );
  await page.reload();
  await expect(
    page.getByRole("button", { name: "打开 只读文稿" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "新建演示文稿", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /文稿操作/ })).toHaveCount(0);
});
