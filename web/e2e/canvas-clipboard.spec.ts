import { expect } from "@playwright/test";
import { test } from "./fixtures/visual-workshop";
import type { VisualCanvasDocument } from "../src/features/visual-workshop/api";
import { setResponsiveTheme } from "./responsive-capture";

for (const theme of ["light", "dark"] as const) {
  test(`批量框选复制、拖动、撤销重做及刷新 (${theme})`, async ({
    page,
    visualWorkshop,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem(
        "fpl_canvas_viewport_persona-project",
        JSON.stringify({ x: 0, y: 0, zoom: 0.5 }),
      );
    });
    let canvas: VisualCanvasDocument = {
      project_id: "persona-project",
      revision: 0,
      updated_at: "2026-10-02T00:00:00Z",
      nodes: [
        {
          id: "image",
          kind: "image",
          title: "分镜",
          asset_id: "asset",
          generation_task_id: "original-task",
          generation_batch_id: "original-batch",
          position: { x: 200, y: 220 },
        },
        {
          id: "video",
          kind: "video",
          title: "视频",
          position: { x: 600, y: 220 },
          generation_draft: {
            prompt: "沿用参考生成",
            mode: "text",
            duration: 5,
            resolution: "720p",
            ratio: "16:9",
            watermark: true,
            generate_audio: false,
            reference_asset_ids: ["asset", "external", "manual"],
          },
        },
        {
          id: "text",
          kind: "text",
          title: "备注",
          text: "保留布局与正文",
          position: { x: 200, y: 560 },
        },
        {
          id: "outside",
          kind: "image",
          title: "外部参考",
          asset_id: "external",
          position: { x: 2400, y: 220 },
        },
      ],
      edges: [
        { id: "inside", source_node_id: "image", target_node_id: "video" },
        {
          id: "outside-edge",
          source_node_id: "outside",
          target_node_id: "video",
        },
      ],
    };
    const writes: VisualCanvasDocument[] = [];
    await page.route(
      "**/v1/visual-workshop/projects/persona-project/canvas",
      async (route) => {
        if (route.request().method() === "PUT") {
          const body = route.request().postDataJSON();
          expect(body.expected_revision).toBe(canvas.revision);
          canvas = {
            ...canvas,
            nodes: body.nodes,
            edges: body.edges,
            revision: canvas.revision + 1,
          };
          writes.push(structuredClone(canvas));
        }
        await route.fulfill({ json: canvas });
      },
    );
    await page.goto("/apps/visual-workshop/projects/persona-project/canvas");
    await setResponsiveTheme(page, theme);
    await expect(page.locator(".canvas-node")).toHaveCount(4);
    const surface = page.getByRole("region", { name: "节点画布" });
    const bounds = (await surface.boundingBox())!;
    await page.mouse.move(bounds.x + 90, bounds.y + 100);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 480, bounds.y + 390, { steps: 10 });
    await page.mouse.up();
    await expect(page.locator(".canvas-node.selected")).toHaveCount(3);
    await expect(
      page.getByRole("toolbar", { name: "已选节点操作" }),
    ).toContainText("已选 3 个节点");
    await page.keyboard.press("ControlOrMeta+c");
    expect(writes).toHaveLength(0);
    await page.mouse.move(bounds.x + 750, bounds.y + 150);
    await page.keyboard.press("ControlOrMeta+v");
    await expect.poll(() => writes.length).toBe(1);
    await expect(page.locator(".canvas-node.selected")).toHaveCount(3);
    expect(canvas.nodes).toHaveLength(7);
    expect(canvas.edges).toHaveLength(3);
    const copied = structuredClone(canvas.nodes.slice(4));
    expect(copied[0]).toMatchObject({
      asset_id: "asset",
      generation_task_id: null,
      generation_batch_id: null,
      position: { x: 1500, y: 300 },
    });
    expect(copied[1]).toMatchObject({
      position: { x: 1900, y: 300 },
      generation_draft: { reference_asset_ids: ["asset", "manual"] },
    });
    expect(canvas.edges[2]).toMatchObject({
      source_node_id: copied[0].id,
      target_node_id: copied[1].id,
    });
    const first = page.locator(`[data-node-id='${copied[0].id}']`);
    const nodeBounds = (await first.boundingBox())!;
    await page.mouse.move(nodeBounds.x + 80, nodeBounds.y + 10);
    await page.mouse.down();
    await page.mouse.move(nodeBounds.x + 140, nodeBounds.y + 50, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => writes.length).toBe(2);
    const moved = structuredClone(canvas.nodes.slice(4));
    const delta = {
      x: moved[0].position.x - copied[0].position.x,
      y: moved[0].position.y - copied[0].position.y,
    };
    expect(delta.x).toBeGreaterThan(0);
    expect(delta.y).toBeGreaterThan(0);
    moved.forEach((node, index) =>
      expect(node.position).toEqual({
        x: copied[index].position.x + delta.x,
        y: copied[index].position.y + delta.y,
      }),
    );
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => writes.length).toBe(3);
    expect(canvas.nodes.slice(4)).toEqual(copied);
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => writes.length).toBe(4);
    expect(canvas.nodes).toHaveLength(4);
    expect(canvas.edges).toHaveLength(2);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect.poll(() => writes.length).toBe(6);
    expect(canvas.nodes.slice(4)).toEqual(moved);
    await page.reload();
    await expect(page.locator(".canvas-node")).toHaveCount(7);
    await expect(page.getByLabel("节点连线").locator("g")).toHaveCount(3);
    await surface.focus();
    await page.keyboard.press("ControlOrMeta+v");
    expect(writes).toHaveLength(6);
    expect(visualWorkshop.generationRequests).toHaveLength(0);
  });
}
