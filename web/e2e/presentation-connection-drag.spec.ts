import { expect, test, type Page, type Locator } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";
import { newConnection } from "../src/features/presentation-workshop/scene/connectionEditing";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  errors.set(page, []);
  page.on("pageerror", (error) => errors.get(page)!.push(error.message));
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

async function create(page: Page, straight = false) {
  await page.setViewportSize({ width: 1680, height: 1050 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const document = newDeck("blank"),
    slide = document.slides[0];
  slide.elements = [
    newElement("rect", { id: "a", x: 100, y: 200, width: 180, height: 100 }),
    newElement("rect", {
      id: "panel",
      x: 700,
      y: 300,
      width: 250,
      height: 200,
    }),
    newElement("text", { id: "title", x: 720, y: 310, width: 200, height: 40 }),
  ];
  slide.groups = [
    { id: "group", name: "填充后的页面", element_ids: ["panel", "title"] },
  ];
  slide.connections = [
    {
      ...newConnection(slide, ["a", "panel"]),
      id: "edge",
      style: straight ? "straight" : "step",
    },
  ];
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title: "连接拖拽验收", document },
    },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(page.getByRole("group", { name: "幻灯片画布" })).toBeVisible();
  return project;
}
const line = (page: Page) =>
  page.locator(
    '.presentation-canvas [data-connection-id="edge"] path[marker-end]',
  );
const handle = (page: Page, kind: string, index?: number) =>
  page.locator(
    `.presentation-canvas [data-connection-handle="${kind}"]${index === undefined ? "" : `[data-route-index="${index}"]`}`,
  );
async function open(page: Page) {
  const edge = page.locator(
    '.presentation-canvas [data-connection-id="edge"] [role="button"]',
  );
  await edge.focus();
  await edge.press("Enter");
  await expect(handle(page, "target")).toBeVisible();
  await expect(page.getByRole("tab", { name: "元素" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page
      .getByRole("complementary", { name: "格式面板" })
      .getByRole("region", { name: "连接线调节" }),
  ).toBeVisible();
}
async function slidePoint(page: Page, x: number, y: number) {
  const box = (await page.locator(".presentation-canvas").boundingBox())!;
  return {
    x: box.x + (x * box.width) / 1280,
    y: box.y + (y * box.height) / 720,
  };
}
async function dragTo(
  page: Page,
  locator: Locator,
  x: number,
  y: number,
  cancel = false,
) {
  const box = (await locator.boundingBox())!,
    end = await slidePoint(page, x, y);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
}
async function saved(page: Page, id: string) {
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect(page.locator(".presentation-save-state")).toHaveText("已保存");
  return (
    await (
      await page.request.get(`/v1/presentation-workshop/projects/${id}`)
    ).json()
  ).document.slides[0];
}

test("折线线段和拐点拖动、一次撤销重做、取消及保存重开", async ({ page }) => {
  const project = await create(page);
  await open(page);
  const original = await line(page).getAttribute("d");
  await dragTo(page, handle(page, "segment", 1), 550, 325);
  const moved = await line(page).getAttribute("d");
  expect(moved).not.toBe(original);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(line(page)).toHaveAttribute("d", original!);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(line(page)).toHaveAttribute("d", moved!);
  await dragTo(page, handle(page, "corner", 1), 580, 270, true);
  await expect(line(page)).toHaveAttribute("d", moved!);
  const first = await saved(page, project.id);
  expect(first.connections[0]).toMatchObject({
    source_id: "a",
    target_id: "panel",
    style: "step",
    waypoints: [
      { x: 550, y: 250 },
      { x: 550, y: 400 },
    ],
  });
  await page.reload();
  await open(page);
  await expect(line(page)).toHaveAttribute("d", moved!);
  await dragTo(page, handle(page, "corner", 1), 580, 270);
  const corner = await saved(page, project.id);
  expect(corner.connections[0].style).toBe("step");
  expect(corner.connections[0].waypoints).toContainEqual({ x: 580, y: 270 });
  await page.getByRole("button", { name: "重置走线", exact: true }).click();
  await expect(line(page)).toHaveAttribute("d", original!);
});

test("端点吸附 panel 非中点、自由放置后重新绑定、分组移动后跟随", async ({
  page,
}, info) => {
  const project = await create(page);
  await open(page);
  await dragTo(page, handle(page, "target"), 700, 340);
  const attached = await line(page).getAttribute("d");
  const first = await saved(page, project.id);
  expect(first.connections[0]).toMatchObject({
    target_id: "panel",
    target_anchor: "left",
    target_offset: 0.2,
    style: "step",
  });
  await dragTo(page, handle(page, "target"), 600, 100);
  expect((await saved(page, project.id)).connections[0]).toMatchObject({
    target_id: null,
    target_point: { x: 600, y: 100 },
  });
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(line(page)).toHaveAttribute("d", attached!);
  const point = await slidePoint(page, 800, 470),
    end = await slidePoint(page, 840, 510);
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.keyboard.down("Alt");
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  const moved = await saved(page, project.id);
  expect(
    moved.elements.find((e: { id: string }) => e.id === "panel"),
  ).toMatchObject({ x: 740, y: 340 });
  expect(moved.connections[0].target_offset).toBe(0.2);
  await page.reload();
  await open(page);
  await expect(line(page)).toHaveAttribute("d", /L740,380$/);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
    }, theme);
    await page.screenshot({
      path: info.outputPath(`fractional-panel-${theme}.png`),
    });
  }
});

test("直线拖动与端点键盘精调始终保持直线，缩放滚动坐标正确", async ({
  page,
}) => {
  const project = await create(page, true);
  await open(page);
  await dragTo(page, handle(page, "move", 0), 490, 345);
  let slide = await saved(page, project.id);
  expect(slide.connections[0]).toMatchObject({
    style: "straight",
    waypoints: [],
    source_id: null,
    target_id: null,
    source_point: { x: 280, y: 270 },
    target_point: { x: 700, y: 420 },
  });
  expect((await line(page).getAttribute("d"))!.match(/L/g)).toHaveLength(1);
  await handle(page, "target").focus();
  await page.keyboard.press("ArrowUp");
  slide = await saved(page, project.id);
  expect(slide.connections[0].target_point).toEqual({ x: 700, y: 419 });
  await page.getByRole("slider", { name: "画布缩放", exact: true }).fill("150");
  await page.locator(".presentation-canvas-area").evaluate((area) => {
    area.scrollLeft = 450;
    area.scrollTop = 200;
  });
  await dragTo(page, handle(page, "target"), 700, 360);
  slide = await saved(page, project.id);
  expect(slide.connections[0]).toMatchObject({
    style: "straight",
    target_offset: 0.3,
    target_id: "panel",
  });
});

test("撤销先取消预览，指针取消不提交", async ({ page }) => {
  const project = await create(page);
  await open(page);
  const original = await line(page).getAttribute("d");
  const box = (await handle(page, "segment", 1).boundingBox())!,
    end = await slidePoint(page, 560, 325);
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.keyboard.press("ControlOrMeta+z");
  await page.mouse.up();
  await expect(line(page)).toHaveAttribute("d", original!);
  expect((await saved(page, project.id)).connections[0].waypoints).toEqual([]);
  const endpoint = (await handle(page, "target").boundingBox())!;
  await page.mouse.move(
    endpoint.x + endpoint.width / 2,
    endpoint.y + endpoint.height / 2,
  );
  await page.mouse.down();
  await page
    .locator(".presentation-canvas")
    .dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  expect((await saved(page, project.id)).connections[0].target_offset).toBe(
    0.5,
  );
});

test("线身整体自由移动，保留折点并一次撤销恢复绑定；右侧属性不遮挡画布", async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  const project = await create(page);
  await open(page);
  const original = await line(page).getAttribute("d");
  const start = await slidePoint(page, 490, 300),
    end = await slidePoint(page, 550, 350);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  const moved = await line(page).getAttribute("d");
  const result = await saved(page, project.id);
  expect(result.connections[0]).toMatchObject({
    source_id: null,
    target_id: null,
    source_point: { x: 340, y: 300 },
    target_point: { x: 760, y: 450 },
    waypoints: [
      { x: 550, y: 300 },
      { x: 550, y: 450 },
    ],
    style: "step",
  });
  expect(result.elements.find((e: { id: string }) => e.id === "a").x).toBe(100);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(line(page)).toHaveAttribute("d", original!);
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(line(page)).toHaveAttribute("d", moved!);
  await saved(page, project.id);
  await page.reload();
  await open(page);
  await expect(line(page)).toHaveAttribute("d", moved!);
  const properties = page.getByRole("region", { name: "连接线调节" });
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    await properties.getByRole("button", { name: /^连接端点/ }).click();
    for (const [width, height] of [
      [1680, 1050],
      [1024, 600],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      if (width < 768)
        await page
          .getByRole("button", { name: "文字与格式", exact: true })
          .click();
      await expect(properties).toBeVisible();
      expect(
        await properties.evaluate(
          (el) =>
            !!el.closest(".presentation-inspector") &&
            getComputedStyle(el).position === "static",
        ),
      ).toBe(true);
      const bounds = (await properties.boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
      expect(
        await properties.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`docked-${theme}-${width}.png`),
      });
    }
  }
});

test("Shift 轴向移动与自由端点对齐", async ({ page }) => {
  const project = await create(page);
  await open(page);
  const start = await slidePoint(page, 490, 300),
    end = await slidePoint(page, 550, 325);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.keyboard.down("Shift");
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  let result = await saved(page, project.id);
  expect(result.connections[0]).toMatchObject({
    source_point: { x: 340, y: 250 },
    target_point: { x: 760, y: 400 },
  });
  await dragTo(page, handle(page, "target"), 520, 257);
  result = await saved(page, project.id);
  expect(result.connections[0]).toMatchObject({
    target_id: null,
    target_point: { x: 520, y: 250 },
  });
});
