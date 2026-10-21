import { expect, test, type Page } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";

async function create(page: Page, groups = false) {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const document = newDeck("blank"),
    slide = document.slides[0];
  slide.elements = [
    newElement("rect", {
      id: "background",
      name: "锁定背板",
      x: 0,
      y: 0,
      width: 1280,
      height: 720,
      fill: "#FAF8F3",
      locked: true,
    }),
    newElement("rect", {
      id: "a",
      name: "卡片 A",
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    }),
    newElement("text", {
      id: "b",
      name: "说明 B",
      x: 300,
      y: 100,
      width: 100,
      height: 100,
    }),
    newElement("rect", {
      id: "c",
      name: "卡片 C",
      x: 700,
      y: 400,
      width: 100,
      height: 100,
    }),
    newElement("rect", {
      id: "hidden",
      name: "隐藏对象",
      x: 120,
      y: 120,
      width: 50,
      height: 50,
      hidden: true,
    }),
  ];
  if (groups)
    slide.groups = [{ id: "group", name: "卡片组合", element_ids: ["a", "b"] }];
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title: "元素框选验收", document },
    },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(page.getByRole("group", { name: "幻灯片画布" })).toBeVisible();
  return project;
}
const canvas = (page: Page) => page.locator(".presentation-canvas");
async function point(page: Page, x: number, y: number) {
  const box = (await canvas(page).boundingBox())!;
  return {
    x: box.x + (x * box.width) / 1280,
    y: box.y + (y * box.height) / 720,
  };
}
async function drag(
  page: Page,
  start: { x: number; y: number },
  end: { x: number; y: number },
  shift = false,
  cancel = false,
) {
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
}
async function frame(
  page: Page,
  from: [number, number],
  to: [number, number],
  shift = false,
  cancel = false,
) {
  await page.getByRole("button", { name: "框选元素", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "框选元素", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await drag(
    page,
    await point(page, ...from),
    await point(page, ...to),
    shift,
    cancel,
  );
  await expect(page.locator(".presentation-marquee")).toHaveCount(0);
}
const inspector = (page: Page) =>
  page.getByRole("complementary", { name: "格式面板" });
async function saved(page: Page, id: string) {
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  return await (
    await page.request.get(`/v1/presentation-workshop/projects/${id}`)
  ).json();
}

test("页外空白可框选；选择不保存，整组移动只产生一次撤销", async ({
  page,
}, info) => {
  const project = await create(page);
  const box = (await canvas(page).boundingBox())!;
  await drag(
    page,
    { x: box.x - 12, y: box.y - 12 },
    await point(page, 420, 220),
  );
  await expect(
    inspector(page).getByRole("heading", { name: "2 个元素", exact: true }),
  ).toBeVisible();
  expect(
    (
      await (
        await page.request.get(
          `/v1/presentation-workshop/projects/${project.id}`,
        )
      ).json()
    ).revision,
  ).toBe(project.revision);
  const from = await point(page, 150, 150),
    to = await point(page, 190, 180);
  await page.keyboard.down("Alt");
  await drag(page, from, to);
  await page.keyboard.up("Alt");
  let result = await saved(page, project.id);
  expect(
    result.document.slides[0].elements.find(
      (e: { id: string }) => e.id === "a",
    ),
  ).toMatchObject({ x: 140, y: 130 });
  expect(
    result.document.slides[0].elements.find(
      (e: { id: string }) => e.id === "b",
    ),
  ).toMatchObject({ x: 340, y: 130 });
  expect(
    result.document.slides[0].elements.find(
      (e: { id: string }) => e.id === "c",
    ),
  ).toMatchObject({ x: 700, y: 400 });
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  result = await saved(page, project.id);
  expect(
    result.document.slides[0].elements.find((e: { id: string }) => e.id === "a")
      .x,
  ).toBe(100);
  expect(
    result.document.slides[0].elements.find((e: { id: string }) => e.id === "b")
      .x,
  ).toBe(300);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await page.screenshot({
      path: info.outputPath(`marquee-selection-${theme}.png`),
    });
  }
});

test("背景覆盖时用工具拉框，Shift追加、Escape恢复，支持反向框选", async ({
  page,
}, info) => {
  const project = await create(page);
  await page.locator('.presentation-canvas [data-element-id="c"]').click();
  await frame(page, [90, 90], [410, 210], true);
  await expect(
    inspector(page).getByRole("heading", { name: "3 个元素", exact: true }),
  ).toBeVisible();
  await frame(page, [90, 90], [410, 210], false, true);
  await expect(
    inspector(page).getByRole("heading", { name: "3 个元素", exact: true }),
  ).toBeVisible();
  await frame(page, [410, 210], [90, 90]);
  await expect(
    inspector(page).getByRole("heading", { name: "2 个元素", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "框选元素", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(
    (
      await (
        await page.request.get(
          `/v1/presentation-workshop/projects/${project.id}`,
        )
      ).json()
    ).revision,
  ).toBe(project.revision);
  await page.screenshot({ path: info.outputPath("explicit-marquee.png") });
});

test("分组完整包含才框选，进入组后可框选成员", async ({ page }) => {
  await create(page, true);
  await frame(page, [90, 90], [210, 210]);
  await expect(page.locator(".presentation-selection")).toHaveCount(0);
  await frame(page, [90, 90], [410, 210]);
  await expect(
    inspector(page).getByRole("heading", { name: "2 个元素", exact: true }),
  ).toBeVisible();
  await page.locator('.presentation-canvas [data-element-id="a"]').click();
  await expect(page.getByRole("group", { name: "组内编辑" })).toContainText(
    "卡片组合",
  );
  await frame(page, [290, 90], [410, 210]);
  await expect(
    inspector(page).getByRole("heading", { name: "文本格式", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "组内编辑" })).toContainText(
    "卡片组合",
  );
});

test("150%缩放滚动后框选准确，低高度与窄屏不溢出", async ({ page }, info) => {
  await create(page);
  await page.getByRole("slider", { name: "画布缩放", exact: true }).fill("150");
  await page.locator(".presentation-canvas-area").evaluate((el) => {
    el.scrollLeft = 100;
    el.scrollTop = 50;
  });
  await frame(page, [90, 90], [410, 210]);
  await expect(
    inspector(page).getByRole("heading", { name: "2 个元素", exact: true }),
  ).toBeVisible();
  for (const width of [1024, 390]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`marquee-${width}.png`) });
  }
});

test("框选按钮可用键盘退出，窄屏触控框选不滚动画布", async ({ page }) => {
  await create(page);
  const tool = page.getByRole("button", { name: "框选元素", exact: true });
  await tool.click();
  await page.keyboard.press("Escape");
  await expect(tool).toHaveAttribute("aria-pressed", "false");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.getByRole("slider", { name: "画布缩放", exact: true }).fill("25");
  await tool.click();
  const from = await point(page, 90, 90),
    to = await point(page, 410, 210);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [from],
  });
  for (let i = 1; i <= 5; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * i) / 5,
          y: from.y + ((to.y - from.y) * i) / 5,
        },
      ],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
  await expect(tool).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "文字与格式", exact: true }).click();
  await expect(
    inspector(page).getByRole("heading", { name: "2 个元素", exact: true }),
  ).toBeVisible();
});
