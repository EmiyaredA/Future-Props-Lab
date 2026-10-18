import { expect, test, type Page } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";

const object = (page: Page, id: string) =>
  page.locator(`.presentation-canvas [data-element-id="${id}"]`);
async function create(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const document = newDeck("blank");
  document.slides[0].elements = [
    newElement("rect", { id: "a", x: 100, y: 100, width: 100, height: 60 }),
    newElement("rect", { id: "b", x: 500, y: 100, width: 100, height: 60 }),
    newElement("rect", {
      id: "moving",
      x: 300,
      y: 300,
      width: 160,
      height: 90,
    }),
  ];
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title: "自动对齐验收", document },
    },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(object(page, "moving")).toBeVisible();
  return project.id as string;
}
async function pointer(page: Page, x: number, y: number) {
  const canvas = (await page.locator(".presentation-canvas").boundingBox())!;
  return {
    x: canvas.x + (x * canvas.width) / 1280,
    y: canvas.y + (y * canvas.width) / 1280,
  };
}
async function persisted(page: Page, id: string) {
  return (
    await (
      await page.request.get(`/v1/presentation-workshop/projects/${id}`)
    ).json()
  ).document.slides[0].elements as { id: string; x: number; width: number }[];
}
const width = (page: Page, id: string) =>
  object(page, id).evaluate((e) => parseFloat((e as HTMLElement).style.width));

test("等距提示、Alt 关闭与 Escape 取消不产生保存", async ({ page }, info) => {
  const id = await create(page);
  // 160-wide object fits at x=270 between the two 100-wide neighbors.
  const from = await pointer(page, 380, 345),
    to = await pointer(page, 352, 145);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(page.locator('[data-guide-kind="gap"]')).toHaveCount(2);
  await expect(object(page, "moving")).toHaveCSS("left", "270px");
  await page.screenshot({ path: info.outputPath("gap-guides.png") });
  await page.keyboard.down("Alt");
  await expect(page.locator("[data-guide-kind]")).toHaveCount(0);
  await expect(object(page, "moving")).toHaveCSS("left", "272px");
  await page.keyboard.up("Alt");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(object(page, "moving")).toHaveCSS("left", "300px");
  expect((await persisted(page, id)).find((e) => e.id === "moving")!.x).toBe(
    300,
  );
});

test("缩放匹配宽度，保存重开与一次撤销重做", async ({ page }, info) => {
  const id = await create(page);
  await object(page, "a").click();
  const handle = page.locator('[data-resize="e"]');
  const start = (await handle.boundingBox())!;
  const canvas = (await page.locator(".presentation-canvas").boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    start.x + start.width / 2 + (58 * canvas.width) / 1280,
    start.y + start.height / 2,
    { steps: 8 },
  );
  await expect(page.locator('[data-guide-kind="size"]')).toHaveCount(1);
  await expect.poll(() => width(page, "a")).toBeCloseTo(160);
  await page.screenshot({ path: info.outputPath("size-guides.png") });
  await page.mouse.up();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => width(page, "a")).toBe(100);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect.poll(() => width(page, "a")).toBeCloseTo(160);
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect
    .poll(
      async () => (await persisted(page, id)).find((e) => e.id === "a")!.width,
    )
    .toBeCloseTo(160);
  await page.reload();
  await expect.poll(() => width(page, "a")).toBeCloseTo(160);
});

test("面板与悬浮菜单按首选对象统一尺寸", async ({ page }, info) => {
  const id = await create(page);
  await object(page, "moving").click();
  await object(page, "a").click({ modifiers: ["Shift"] });
  await expect(
    page.getByText("尺寸基准：形状 · 160 × 90", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "水平分布", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "对齐所选元素" }).click();
  await page.getByRole("menuitem", { name: "统一宽度", exact: true }).click();
  await expect.poll(() => width(page, "a")).toBe(160);
  await page.getByRole("button", { name: "统一高度", exact: true }).click();
  await expect(object(page, "a")).toHaveCSS("height", "90px");
  await page.getByRole("button", { name: "保存文稿", exact: true }).click();
  await expect
    .poll(
      async () => (await persisted(page, id)).find((e) => e.id === "a")!.width,
    )
    .toBe(160);
  await page.screenshot({ path: info.outputPath("layout-controls.png") });
  await page.reload();
  await expect(object(page, "a")).toHaveCSS("height", "90px");
});
