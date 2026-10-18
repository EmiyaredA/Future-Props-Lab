import { expect, test, type Page } from "@playwright/test";
import {
  newDeck,
  newElement,
} from "../src/features/presentation-workshop/templates";

async function create(page: Page) {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/presentation-workshop");
  const csrf = (await page.context().cookies()).find(
    (c) => c.name === "fpl_csrf",
  )!.value;
  const document = newDeck("blank");
  document.slides[0].elements = [
    newElement("rect", {
      id: "zoom-shape",
      x: 500,
      y: 300,
      width: 180,
      height: 100,
    }),
  ];
  const response = await page.request.post(
    "/v1/presentation-workshop/projects",
    {
      headers: { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin },
      data: { title: "画布缩放验收", document },
    },
  );
  expect(response.ok()).toBeTruthy();
  const project = await response.json();
  await page.goto(`/apps/presentation-workshop/projects/${project.id}`);
  await expect(page.getByRole("group", { name: "幻灯片画布" })).toBeVisible();
  return project;
}

async function centerPoint(page: Page) {
  return page.locator(".presentation-canvas-area").evaluate((area) => {
    const rect = area.getBoundingClientRect();
    return {
      x: rect.left + area.clientWidth / 2,
      y: rect.top + area.clientHeight / 2,
    };
  });
}

test("捏合与滚轮锚定鼠标，底部控件保留中心，缩放不保存文稿", async ({
  page,
}) => {
  const project = await create(page);
  const canvas = page.getByRole("group", { name: "幻灯片画布" });
  const area = page.locator(".presentation-canvas-area");
  const slider = page.getByRole("slider", { name: "画布缩放" });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes(`/presentation-workshop/projects/${project.id}`) &&
      ["PUT", "PATCH", "POST"].includes(request.method())
    )
      writes.push(request.url());
  });
  const toolbar = await page.locator(".presentation-toolbar").boundingBox();
  await slider.fill("100");
  const point = await centerPoint(page);
  const before = (await canvas.boundingBox())!;
  const logical = { x: point.x - before.x, y: point.y - before.y };
  await page.mouse.move(point.x, point.y);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect(page.getByLabel("实际缩放比例")).toHaveText("122%");
  const zoomed = (await canvas.boundingBox())!;
  const scale = zoomed.width / 1280;
  expect(Math.abs(zoomed.x + logical.x * scale - point.x)).toBeLessThan(2);
  expect(Math.abs(zoomed.y + logical.y * scale - point.y)).toBeLessThan(2);
  expect(await page.locator(".presentation-toolbar").boundingBox()).toEqual(
    toolbar,
  );

  // Chromium delivers trackpad pinch as a Ctrl+wheel event. Exercise tiny deltas too.
  await area.evaluate((node, point) => {
    for (let i = 0; i < 4; i++)
      node.dispatchEvent(
        new WheelEvent("wheel", {
          ctrlKey: true,
          deltaY: -2,
          bubbles: true,
          cancelable: true,
          clientX: point.x,
          clientY: point.y,
        }),
      );
  }, point);
  await expect(page.getByLabel("实际缩放比例")).toHaveText("124%");
  const beforeButton = (await canvas.boundingBox())!;
  const centerLogical = {
    x: (point.x - beforeButton.x) / (beforeButton.width / 1280),
    y: (point.y - beforeButton.y) / (beforeButton.width / 1280),
  };
  await page.getByRole("button", { name: "放大画布" }).click();
  await expect(page.getByLabel("实际缩放比例")).toHaveText("130%");
  const afterButton = (await canvas.boundingBox())!;
  expect(
    Math.abs(afterButton.x + centerLogical.x * 1.3 - point.x),
  ).toBeLessThan(2);
  expect(
    Math.abs(afterButton.y + centerLogical.y * 1.3 - point.y),
  ).toBeLessThan(2);

  await page.mouse.move(point.x, point.y);
  const top = await area.evaluate((node) => node.scrollTop);
  await page.mouse.wheel(0, 100);
  await expect
    .poll(() => area.evaluate((node) => node.scrollTop))
    .toBeGreaterThan(top);
  await expect(page.getByLabel("实际缩放比例")).toHaveText("130%");
  await expect(
    page.getByRole("button", { name: "撤销", exact: true }),
  ).toBeDisabled();
  const stored = await (
    await page.request.get(`/v1/presentation-workshop/projects/${project.id}`)
  ).json();
  expect(stored.document).toEqual(project.document);
  expect(stored.revision).toBe(project.revision);
  expect(writes).toEqual([]);
});

test("放大后四角可达，适应页面重新居中并响应窗口、主题及备注变化", async ({
  page,
}, info) => {
  await create(page);
  const canvas = page.getByRole("group", { name: "幻灯片画布" });
  const area = page.locator(".presentation-canvas-area");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.getByRole("slider", { name: "画布缩放" }).fill("200");
    for (const corner of ["nw", "ne", "se", "sw"]) {
      const visible = await area.evaluate((node, corner) => {
        node.scrollLeft = corner.includes("e") ? node.scrollWidth : 0;
        node.scrollTop = corner.includes("s") ? node.scrollHeight : 0;
        const slide = node
          .querySelector(".presentation-canvas")!
          .getBoundingClientRect();
        const host = node.getBoundingClientRect();
        const x = corner.includes("e") ? slide.right : slide.left;
        const y = corner.includes("s") ? slide.bottom : slide.top;
        return (
          x >= host.left &&
          x <= host.left + node.clientWidth &&
          y >= host.top &&
          y <= host.top + node.clientHeight
        );
      }, corner);
      expect(visible, corner).toBe(true);
    }
    await page.getByRole("button", { name: "适应页面", exact: true }).click();
    await expect(area).toHaveJSProperty("scrollTop", 0);
    await expect(area).toHaveJSProperty("scrollLeft", 0);
    for (const width of [1024, 390, 1600]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect
        .poll(async () => {
          const host = (await area.boundingBox())!;
          const slide = (await canvas.boundingBox())!;
          return Math.abs(
            slide.width -
              Math.max(
                0.08,
                Math.min(
                  (host.width - (width < 768 ? 24 : 48)) / 1280,
                  (host.height - (width < 768 ? 40 : 48)) / 720,
                ),
              ) *
                1280,
          );
        })
        .toBeLessThan(2);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    }
    await page.getByRole("button", { name: /演示者备注/ }).click();
    const host = (await area.boundingBox())!;
    await expect
      .poll(async () => (await canvas.boundingBox())!.height)
      .toBeLessThanOrEqual(host.height - 47);
    await page.getByRole("button", { name: /演示者备注/ }).click();
    await page.screenshot({ path: info.outputPath(`zoom-fit-${theme}.png`) });
  }
  await page.getByRole("slider", { name: "画布缩放" }).fill("150");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "适应页面", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("元素拖动中忽略手势缩放，松手后恢复并保持移动坐标正确", async ({
  page,
}) => {
  await create(page);
  await page.getByRole("slider", { name: "画布缩放" }).fill("100");
  const shape = page.locator(
    '.presentation-canvas [data-element-id="zoom-shape"]',
  );
  await shape.scrollIntoViewIfNeeded();
  const box = (await shape.boundingBox())!;
  await page.mouse.move(box.x + 50, box.y + 40);
  await page.mouse.down();
  await page.mouse.move(box.x + 70, box.y + 60);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect(page.getByLabel("实际缩放比例")).toHaveText("100%");
  await page.mouse.up();
  await expect(shape).toHaveCSS("left", "520px");
  await expect(shape).toHaveCSS("top", "320px");
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -100);
  await page.keyboard.up("Control");
  await expect(page.getByLabel("实际缩放比例")).toHaveText("122%");
});
