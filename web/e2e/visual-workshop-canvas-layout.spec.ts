import { expect, test, type Page } from "@playwright/test";
import type {
  VisualCanvasDocument,
  VisualCanvasNode,
} from "../src/features/visual-workshop/api";
import {
  nodeRect,
  rectanglesOverlap,
} from "../src/features/visual-workshop/canvas/canvasPlacement";
import { setResponsiveTheme } from "./responsive-capture";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const text = (id: string, x: number, y: number): VisualCanvasNode => ({
  id,
  kind: "text",
  title: id,
  text: "布局验收",
  position: { x, y },
});

async function createProject(
  page: Page,
  nodes: VisualCanvasNode[],
  linked = false,
) {
  await page.goto("/apps/visual-workshop");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const response = await page.request.post("/v1/visual-workshop/projects", {
    headers,
    data: { title: "布局验收", kind: "canvas" },
  });
  expect(response.ok()).toBeTruthy();
  const id = (await response.json()).id as string;
  const saved = await page.request.put(
    `/v1/visual-workshop/projects/${id}/canvas`,
    {
      headers,
      data: {
        nodes,
        edges: linked
          ? [
              {
                id: "flow",
                source_node_id: nodes[0].id,
                target_node_id: nodes[1].id,
              },
            ]
          : [],
        expected_revision: 0,
      },
    },
  );
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.evaluate(
    (id) =>
      localStorage.setItem(
        `fpl_canvas_viewport_${id}`,
        JSON.stringify({ x: 30, y: 40, zoom: 0.5 }),
      ),
    id,
  );
  await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
  await expect(page.locator(".canvas-node")).toHaveCount(nodes.length);
  return { id, original: (await saved.json()) as VisualCanvasDocument };
}
async function readCanvas(
  page: Page,
  id: string,
): Promise<VisualCanvasDocument> {
  const response = await page.request.get(
    `/v1/visual-workshop/projects/${id}/canvas`,
  );
  expect(response.ok()).toBeTruthy();
  return response.json();
}
function positions(canvas: VisualCanvasDocument) {
  return canvas.nodes.map((node) => node.position);
}
function separated(nodes: VisualCanvasNode[]) {
  return nodes.every((a, index) =>
    nodes
      .slice(index + 1)
      .every((b) => !rectanglesOverlap(nodeRect(a), nodeRect(b))),
  );
}

test("按连线整理、选区网格、撤销重做、刷新与看板往返", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { id, original } = await createProject(
    page,
    [text("来源", 220, 240), text("下游", 220, 240), text("独立", 1500, 800)],
    true,
  );
  await page.getByRole("button", { name: "一键整理", exact: true }).click();
  await expect
    .poll(async () => separated((await readCanvas(page, id)).nodes))
    .toBe(true);
  const arranged = await readCanvas(page, id);
  expect(arranged.nodes[1].position.x).toBeGreaterThan(
    arranged.nodes[0].position.x,
  );
  expect(arranged.edges).toEqual(original.edges);
  const surface = page.getByRole("region", { name: "节点画布" });
  await surface.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => positions(await readCanvas(page, id)))
    .toEqual(positions(original));
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect
    .poll(async () => positions(await readCanvas(page, id)))
    .toEqual(positions(arranged));
  const first = await page
    .locator('.canvas-node[data-node-id="来源"]')
    .boundingBox();
  const second = await page
    .locator('.canvas-node[data-node-id="下游"]')
    .boundingBox();
  await page.mouse.move(first!.x - 10, first!.y - 10);
  await page.mouse.down();
  await page.mouse.move(
    second!.x + second!.width + 10,
    Math.max(first!.y + first!.height, second!.y + second!.height) + 10,
  );
  await page.mouse.up();
  await expect(page.locator(".canvas-node.selected")).toHaveCount(2);
  await page.getByRole("button", { name: "选中节点整理方式" }).click();
  await page.getByRole("menuitem", { name: "网格整理选中" }).click();
  await expect
    .poll(async () => (await readCanvas(page, id)).revision)
    .toBeGreaterThan(arranged.revision + 2);
  const selectedLayout = await readCanvas(page, id);
  expect(selectedLayout.nodes[2].position).toEqual(arranged.nodes[2].position);
  expect(separated(selectedLayout.nodes)).toBe(true);
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await page.getByRole("button", { name: "画布", exact: true }).click();
  expect(positions(await readCanvas(page, id))).toEqual(
    positions(selectedLayout),
  );
  await page.reload();
  await expect(page.locator(".canvas-node")).toHaveCount(3);
  expect(positions(await readCanvas(page, id))).toEqual(
    positions(selectedLayout),
  );
});

test("连续新增与看板批量上传避让，侧栏与缩放保持正常", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.text().includes("same key")) errors.push(message.text());
  });
  const { id, original } = await createProject(page, [text("已有", 900, 500)]);
  await page.getByRole("button", { name: "素材库", exact: true }).click();
  for (let index = 0; index < 3; index++) {
    await page.getByRole("button", { name: "添加内容" }).click();
    await page.getByRole("menuitem", { name: "添加文本节点" }).click();
    await expect
      .poll(async () => (await readCanvas(page, id)).nodes.length)
      .toBe(index + 2);
    expect(separated((await readCanvas(page, id)).nodes)).toBe(true);
    await expect(
      page.getByRole("button", { name: "50%", exact: true }),
    ).toBeVisible();
  }
  expect((await readCanvas(page, id)).nodes[0].position).toEqual(
    original.nodes[0].position,
  );
  await page.getByRole("button", { name: "看板", exact: true }).click();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect
    .poll(async () => (await readCanvas(page, id)).nodes.length)
    .toBe(5);
  await page
    .getByRole("complementary", { name: "项目素材" })
    .locator('input[type="file"]')
    .setInputFiles(
      Array.from({ length: 3 }, (_, index) => ({
        name: `素材-${index}.png`,
        mimeType: "image/png",
        buffer: PNG,
      })),
    );
  await expect
    .poll(async () => (await readCanvas(page, id)).nodes.length)
    .toBe(8);
  expect(separated((await readCanvas(page, id)).nodes)).toBe(true);
  await page.getByRole("button", { name: "画布", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "50%", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "一键整理", exact: true }).click();
  await expect
    .poll(async () => (await readCanvas(page, id)).nodes[1].position.y)
    .not.toBe(original.nodes[0].position.y);
  expect(errors).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
  test(`整理菜单键盘与窄屏可用 (${theme})`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { id } = await createProject(page, [
      text("一", 0, 0),
      text("二", 0, 0),
    ]);
    await setResponsiveTheme(page, theme);
    const trigger = page.getByRole("button", { name: "画布整理方式" });
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("menuitem", { name: "按连线整理全部" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(
      page.getByRole("menuitem", { name: "网格整理全部" }),
    ).toBeFocused();
    await page.screenshot({
      path: info.outputPath(`layout-menu-${theme}.png`),
    });
    const bounds = await page.getByRole("menu").boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole("menuitem", { name: "网格整理全部" }).click();
    await expect
      .poll(async () => separated((await readCanvas(page, id)).nodes))
      .toBe(true);
  });
}
