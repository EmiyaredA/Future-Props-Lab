import { expect, test, type Page } from "@playwright/test";
import {
  newDeck,
  newElement,
  defaultRun,
} from "../src/features/presentation-workshop/templates";

async function create(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const document = newDeck("blank");
  document.slides[0].elements = [
    newElement("text", {
      id: "title",
      x: 130,
      y: 160,
      width: 720,
      height: 90,
      paragraphs: [
        {
          align: "left",
          line_height: 1.2,
          bullet: false,
          runs: [
            {
              ...defaultRun(),
              text: "Excel 数据扩充",
              size: 34,
              bold: true,
              color: "#000000",
            },
          ],
        },
      ],
    }),
    newElement("roundRect", {
      id: "shape",
      x: 440,
      y: 390,
      width: 300,
      height: 110,
      fill: "#F4DED5",
      stroke: "#6274E8",
      stroke_width: 2,
      corner_radius: 12,
    }),
    newElement("text", {
      id: "caption",
      x: 440,
      y: 530,
      width: 340,
      height: 50,
      paragraphs: [
        {
          align: "center",
          line_height: 1.2,
          bullet: false,
          runs: [{ ...defaultRun(), text: "固定表格结构", size: 24 }],
        },
      ],
    }),
  ];
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title: "选中交互验收", document },
    },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(
    page.locator('.presentation-canvas [data-element-id="title"]'),
  ).toBeVisible();
  return project.id as string;
}
const object = (page: Page, id: string) =>
  page.locator(`.presentation-canvas [data-element-id="${id}"]`);
async function attached(page: Page, id: string) {
  await expect(
    page.getByRole("toolbar", { name: "所选元素工具栏" }),
  ).toBeVisible();
  const box = (await object(page, id).boundingBox())!,
    bar = (await page
      .locator(".presentation-selection-overlay")
      .boundingBox())!;
  const area = (await page.locator(".presentation-canvas-area").boundingBox())!;
  expect(bar.x).toBeGreaterThanOrEqual(area.x + 7);
  expect(bar.x + bar.width).toBeLessThanOrEqual(area.x + area.width - 7);
  expect(bar.y).toBeGreaterThanOrEqual(area.y + 7);
  expect(bar.y + bar.height).toBeLessThanOrEqual(area.y + area.height - 7);
  return { box, bar };
}

test("文字选中、局部格式、选区恢复、独立撤销与保存重开", async ({
  page,
}, info) => {
  await create(page);
  await object(page, "title").click();
  const { box, bar } = await attached(page, "title");
  expect(box.y - bar.y - bar.height).toBeCloseTo(12, 0);
  await expect(
    page.locator(".presentation-selection [data-resize]"),
  ).toHaveCount(8);
  await page.screenshot({ path: info.outputPath("01-text-selected.png") });
  await object(page, "title").dblclick();
  const editor = page.getByRole("textbox", { name: "编辑幻灯片文字" });
  await editor.press("End");
  for (let i = 0; i < 4; i++) await editor.press("Shift+ArrowLeft");
  await page.getByLabel("文字颜色", { exact: true }).click();
  await page.screenshot({ path: info.outputPath("02-text-editing.png") });
  await page
    .getByRole("button", { name: "选择颜色 #E75B55", exact: true })
    .click();
  await expect(
    editor.locator('span[style*="color: rgb(231, 91, 85)"]'),
  ).toHaveText("数据扩充");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    editor.locator('span[style*="color: rgb(231, 91, 85)"]'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  await page.reload();
  await expect(
    object(page, "title").locator('span[style*="color: rgb(231, 91, 85)"]'),
  ).toHaveText("数据扩充");
  await object(page, "title").click();
  await expect(page.getByLabel("文字颜色", { exact: true })).toHaveAttribute(
    "title",
    "文字颜色：混合",
  );
});

test("跟随移动、八方向缩放、旋转、锁定与边缘翻转", async ({ page }, info) => {
  await create(page);
  await object(page, "shape").click();
  const before = await attached(page, "shape");
  await page.mouse.move(before.box.x + 40, before.box.y + 40);
  await page.mouse.down();
  await page.mouse.move(before.box.x + 85, before.box.y + 70);
  await expect(
    page.getByRole("toolbar", { name: "所选元素工具栏" }),
  ).toHaveCount(0);
  await page.mouse.up();
  const after = await attached(page, "shape");
  expect(after.bar.x - before.bar.x).toBeCloseTo(after.box.x - before.box.x, 0);
  await page.screenshot({ path: info.outputPath("03-shape-selected.png") });
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect
    .poll(async () => (await object(page, "shape").boundingBox())!.x)
    .toBeCloseTo(before.box.x, 0);
  await page.getByLabel("旋转角度", { exact: true }).fill("30");
  for (const direction of ["nw", "n", "ne", "e", "se", "s", "sw", "w"]) {
    const handle = page.locator(`[data-resize="${direction}"]`);
    const h = (await handle.boundingBox())!;
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 + 12, h.y + h.height / 2 + 15);
    await page.mouse.up();
    await expect(
      page.getByRole("toolbar", { name: "所选元素工具栏" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
  }
  await page.getByLabel("旋转角度", { exact: true }).fill("0");
  await page.getByRole("slider", { name: "画布缩放" }).fill("100");
  await page.getByLabel("Y", { exact: true }).fill("0");
  await attached(page, "shape");
  await expect(page.locator(".presentation-selection-overlay")).toHaveAttribute(
    "data-placement",
    "bottom",
  );
  const rotationHandle = (await page
    .getByRole("button", { name: "拖动旋转所选元素" })
    .boundingBox())!;
  const flippedBar = (await page
    .locator(".presentation-selection-overlay")
    .boundingBox())!;
  expect(flippedBar.y).toBeGreaterThan(
    rotationHandle.y + rotationHandle.height,
  );
  await page.screenshot({ path: info.outputPath("04-edge-flipped.png") });
  await page.getByRole("button", { name: "更多元素操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "锁定元素", exact: true }).click();
  await expect(
    page
      .getByRole("toolbar", { name: "所选元素工具栏" })
      .getByRole("button", { name: "解锁元素" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("toolbar", { name: "所选元素工具栏" })
      .getByLabel("描边颜色"),
  ).toHaveCount(0);
});

test("主题、窗口、缩放、局部滚动和备注折叠下的定位", async ({ page }, info) => {
  await create(page);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    for (const width of [1600, 1024, 768, 390, 360]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const zoom of [25, 75, 200]) {
        await page.getByRole("slider", { name: "画布缩放" }).fill(String(zoom));
        await object(page, "title").scrollIntoViewIfNeeded();
        await object(page, "title").click();
        await attached(page, "title");
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
        ).toBe(true);
      }
      if (width === 360)
        await page.screenshot({ path: info.outputPath(`mobile-${theme}.png`) });
    }
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.getByRole("button", { name: "适应页面", exact: true }).click();
  await object(page, "shape").click();
  await page.getByRole("button", { name: /演示者备注/ }).click();
  await attached(page, "shape");
  await page.getByRole("button", { name: /演示者备注/ }).click();
  await attached(page, "shape");
});

test("键盘菜单、空选区格式与离屏隐藏", async ({ page }) => {
  await create(page);
  await object(page, "title").click();
  await page.locator(".presentation-canvas").press("Alt+F10");
  await expect(page.getByLabel("字体", { exact: true })).toBeFocused();
  await page.getByLabel("字体", { exact: true }).press("ArrowDown");
  await page.getByRole("option", { name: "Arial", exact: true }).click();
  await expect(page.getByLabel("字体", { exact: true })).toContainText("Arial");
  await page.getByRole("button", { name: "更多元素操作", exact: true }).click();
  await page.keyboard.press("Delete");
  await expect(
    page.locator(".presentation-canvas [data-element-id]"),
  ).toHaveCount(3);
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "删除元素", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "更多元素操作", exact: true }),
  ).toBeFocused();
  await object(page, "title").dblclick();
  const editor = page.getByRole("textbox", { name: "编辑幻灯片文字" });
  await editor.press("End");
  await page.getByLabel("字号", { exact: true }).fill("42");
  await expect(page.getByLabel("字号", { exact: true })).toBeFocused();
  await editor.press("x");
  await expect(editor.locator('span[style*="font-size: 42px"]')).toHaveText(
    "x",
  );
  await editor.press("Escape");
  await page.getByRole("slider", { name: "画布缩放" }).fill("200");
  await page.locator(".presentation-canvas-area").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.getByRole("toolbar", { name: "所选元素工具栏" }),
  ).toBeHidden();
  await page.locator(".presentation-canvas-area").evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(
    page.getByRole("toolbar", { name: "所选元素工具栏" }),
  ).toBeVisible();
});

test("透明框允许点击内部文字，边线仍可独立选中", async ({ page }) => {
  const id = await create(page);
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const current = await (
    await page.request.get(`/v1/presentation-workshop/projects/${id}`)
  ).json();
  current.document.slides[0].elements.push(
    newElement("rect", {
      id: "transparent",
      x: 80,
      y: 100,
      width: 1050,
      height: 550,
      fill_opacity: 0,
      stroke_width: 2,
    }),
  );
  const updated = await page.request.put(
    `/v1/presentation-workshop/projects/${id}`,
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: {
        expected_revision: current.revision,
        title: current.title,
        document: current.document,
      },
    },
  );
  expect(updated.ok()).toBeTruthy();
  await page.reload();
  await object(page, "title").click();
  await expect(page.getByLabel("字体", { exact: true })).toBeVisible();
  await object(page, "transparent").click({ position: { x: 50, y: 1 } });
  await expect(page.getByLabel("描边颜色", { exact: true })).toBeVisible();
});
