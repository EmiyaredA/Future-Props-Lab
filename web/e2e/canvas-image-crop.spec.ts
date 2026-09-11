import { expect, type Page } from "@playwright/test";
import {
  test,
  type VisualWorkshopPersonaState,
} from "./fixtures/visual-workshop";
import { setResponsiveTheme } from "./responsive-capture";

const sourceSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><path fill="#ff0000" d="M0 0h400v600H0z"/><path fill="#0000ff" d="M400 0h400v300H400z"/></svg>`;

async function installCropRoutes(
  page: Page,
  state: VisualWorkshopPersonaState,
) {
  let canvas = {
    project_id: "persona-project",
    revision: 0,
    updated_at: "2026-09-11T00:00:00Z",
    edges: [],
    nodes: [
      {
        id: "source",
        kind: "image",
        title: "分镜",
        position: { x: 100, y: 100 },
        asset_id: "source-asset",
      },
    ],
  };
  const pngs: Buffer[] = [];
  let failNextSave = false;
  let conflictNextSave = false;
  await page.route(
    "**/v1/visual-workshop/projects/persona-project/canvas",
    async (route) => {
      if (route.request().method() === "PUT") {
        if (conflictNextSave) {
          conflictNextSave = false;
          canvas = { ...canvas, revision: canvas.revision + 1 };
          await route.fulfill({
            status: 409,
            json: {
              type: "about:blank",
              title: "Conflict",
              status: 409,
              current: canvas,
            },
          });
          return;
        }
        if (failNextSave) {
          failNextSave = false;
          await route.fulfill({
            status: 503,
            json: {
              type: "about:blank",
              title: "画布暂时无法保存",
              status: 503,
            },
          });
          return;
        }
        canvas = {
          ...canvas,
          ...route.request().postDataJSON(),
          revision: canvas.revision + 1,
        };
      }
      await route.fulfill({ json: canvas });
    },
  );
  await page.route("**/v1/files/*/content", async (route) => {
    const assetId = route.request().url().split("/").at(-2)!;
    const index = Number(assetId.replace("crop-", "")) - 1;
    await route.fulfill(
      assetId.startsWith("crop-")
        ? { contentType: "image/png", body: pngs[index] }
        : { contentType: "image/svg+xml", body: sourceSvg },
    );
  });
  await page.route("**/v1/files", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    const body = route.request().postDataBuffer()!;
    const start = body.indexOf(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(start).toBeGreaterThan(0);
    const end =
      body.indexOf(Buffer.from([73, 69, 78, 68, 174, 66, 96, 130]), start) + 8;
    const png = body.subarray(start, end);
    pngs.push(png);
    const asset = {
      id: `crop-${pngs.length}`,
      project_id: "persona-project",
      folder_id: null,
      reference_id: null,
      original_filename: "分镜-裁剪.png",
      display_name: "分镜-裁剪",
      media_kind: "image",
      mime_type: "image/png",
      byte_size: png.length,
      source: "project",
      is_reference: false,
      revision: 0,
      created_at: canvas.updated_at,
      updated_at: canvas.updated_at,
    };
    state.projectAssets.push(asset);
    await route.fulfill({ json: asset });
  });
  await page.route("**/v1/visual-workshop/generation-tasks**", (route) =>
    route.fulfill({ json: { items: [], total: 0 } }),
  );
  return {
    pngs,
    getCanvas: () => canvas,
    failSave: () => {
      failNextSave = true;
    },
    conflictSave: () => {
      conflictNextSave = true;
    },
  };
}

async function openCrop(page: Page) {
  await page.locator('[data-node-id="source"]').dblclick();
  await page.getByRole("button", { name: "裁剪图片" }).click();
  await expect(page.getByLabel("裁剪尺寸")).toContainText("像素");
  await expect(
    page.getByRole("button", { name: "裁剪并添加到画布" }),
  ).toBeEnabled();
}

test("裁剪新增、保存重试、连续截取、撤销重做及刷新", async ({
  page,
  visualWorkshop,
}) => {
  const state = await installCropRoutes(page, visualWorkshop);
  await page.goto("/apps/visual-workshop/projects/persona-project/canvas");
  await openCrop(page);
  const right = page.getByRole("button", {
    name: "调整裁剪右边缘",
    exact: true,
  });
  await right.focus();
  for (let index = 0; index < 40; index++) await right.press("Shift+ArrowLeft");
  await expect(page.getByLabel("裁剪尺寸")).toHaveText("400 × 600 像素");
  state.failSave();
  await page.getByRole("button", { name: "裁剪并添加到画布" }).click();
  await expect(
    page.getByRole("button", { name: "重试保存到画布" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "重试保存到画布" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.pngs).toHaveLength(1);
  expect(state.pngs[0].readUInt32BE(16)).toBe(400);
  expect(state.pngs[0].readUInt32BE(20)).toBe(600);
  expect(state.getCanvas().nodes).toHaveLength(2);
  expect(state.getCanvas().nodes[0].asset_id).toBe("source-asset");
  await expect(
    page.locator('[data-node-id="derived-image-crop-1"]'),
  ).toHaveClass(/selected/);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(
    page.locator('[data-node-id="derived-image-crop-1"]'),
  ).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(
    page.locator('[data-node-id="derived-image-crop-1"]'),
  ).toBeVisible();
  await openCrop(page);
  await page.getByRole("button", { name: "裁剪并添加到画布" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.getCanvas().nodes[2].position).toEqual({ x: 468, y: 362 });
  expect(state.getCanvas().edges).toEqual([]);
  await page.reload();
  await expect(page.locator(".canvas-node.image")).toHaveCount(3);
  const colors = await page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    return [
      [10, 10],
      [700, 100],
      [700, 500],
    ].map(([x, y]) => [...context.getImageData(x, y, 1, 1).data]);
  }, state.pngs[1].toString("base64"));
  expect(colors).toEqual([
    [255, 0, 0, 255],
    [0, 0, 255, 255],
    [0, 0, 0, 0],
  ]);
  expect(visualWorkshop.generationRequests).toHaveLength(0);
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  for (const theme of ["light", "dark"] as const) {
    test(`裁剪选框对齐与比例 ${viewport.width} ${theme}`, async ({
      page,
      visualWorkshop,
    }, testInfo) => {
      await installCropRoutes(page, visualWorkshop);
      await page.setViewportSize(viewport);
      await page.goto("/apps/visual-workshop/projects/persona-project/canvas");
      await setResponsiveTheme(page, theme);
      await openCrop(page);
      const image = page.locator(".image-crop-image");
      const selection = page.getByRole("group", { name: /裁剪选区/ });
      const imageBox = (await image.boundingBox())!;
      const selectionBox = (await selection.boundingBox())!;
      expect(selectionBox.width).toBeCloseTo(imageBox.width, 0);
      expect(selectionBox.height).toBeCloseTo(imageBox.height, 0);
      await page.getByRole("combobox", { name: "裁剪比例" }).click();
      await page.getByRole("option", { name: "9:16", exact: true }).click();
      const cropBox = (await selection.boundingBox())!;
      expect(cropBox.width / cropBox.height).toBeCloseTo(9 / 16, 2);
      // Move the selection in display coordinates; export stays in source pixels.
      await page.mouse.move(
        cropBox.x + cropBox.width / 2,
        cropBox.y + cropBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        imageBox.x + imageBox.width + 100,
        cropBox.y + cropBox.height / 2,
      );
      await page.mouse.up();
      const moved = (await selection.boundingBox())!;
      expect(moved.x + moved.width).toBeCloseTo(imageBox.x + imageBox.width, 0);
      await page.screenshot({ path: testInfo.outputPath("crop.png") });
      const dialog = (await page.getByRole("dialog").boundingBox())!;
      expect(dialog.x + dialog.width).toBeLessThanOrEqual(viewport.width);
      expect(dialog.y + dialog.height).toBeLessThanOrEqual(viewport.height);
      await selection.press("Escape");
      await expect(
        page.getByRole("button", { name: "裁剪图片" }),
      ).toBeFocused();
      await expect(page.locator(".canvas-media-history")).toBeVisible();
    });
  }
}

test("保存冲突回到现有冲突界面，不覆盖服务器画布", async ({
  page,
  visualWorkshop,
}) => {
  const state = await installCropRoutes(page, visualWorkshop);
  await page.goto("/apps/visual-workshop/projects/persona-project/canvas");
  await openCrop(page);
  state.conflictSave();
  await page.getByRole("button", { name: "裁剪并添加到画布" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "载入服务器版本" }),
  ).toBeVisible();
  expect(state.getCanvas().nodes).toHaveLength(1);
  await page.getByRole("button", { name: "用本地版本覆盖" }).click();
  await expect.poll(() => state.getCanvas().nodes.length).toBe(2);
  expect(state.pngs).toHaveLength(1);
});

test("裁剪当前选中的历史图片，取消返回同一记录", async ({
  page,
  visualWorkshop,
}) => {
  const state = await installCropRoutes(page, visualWorkshop);
  await page.route("**/v1/visual-workshop/generation-tasks**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            ...visualWorkshop.task,
            id: "history",
            canvas_node_id: "source",
            status: "completed",
            result_asset_id: "history-asset",
          },
        ],
        total: 1,
      },
    }),
  );
  await page.route("**/v1/files/history-asset/content", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><path fill="blue" d="M0 0h200v100H0z"/></svg>',
    }),
  );
  await page.goto("/apps/visual-workshop/projects/persona-project/canvas");
  await page.locator('[data-node-id="source"]').dblclick();
  await page.getByRole("button", { name: "下一个生成记录" }).click();
  await page.getByRole("button", { name: "裁剪图片" }).click();
  await expect(page.getByLabel("裁剪尺寸")).toHaveText("200 × 100 像素");
  await expect(
    page.getByRole("button", { name: "下一个生成记录" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect(
    page.locator(".canvas-media-history-track > button.selected"),
  ).toContainText("1");
  expect(state.pngs).toHaveLength(0);
  await page.getByRole("button", { name: "裁剪图片" }).click();
  await page.getByRole("button", { name: "裁剪并添加到画布" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.pngs[0].readUInt32BE(16)).toBe(200);
  expect(state.getCanvas().nodes[0].asset_id).toBe("source-asset");
});

test("触摸调整裁剪边缘并限制在原图内", async ({
  page,
  browserName,
  visualWorkshop,
}) => {
  test.skip(browserName !== "chromium", "触摸输入使用 Chromium 调试接口");
  await installCropRoutes(page, visualWorkshop);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/apps/visual-workshop/projects/persona-project/canvas");
  await openCrop(page);
  const edge = (await page
    .getByRole("button", { name: "调整裁剪右边缘", exact: true })
    .boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const point = { x: edge.x + edge.width / 2, y: edge.y + edge.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ ...point, x: point.x - 100 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.getByLabel("裁剪尺寸")).not.toHaveText("800 × 600 像素");
  const image = (await page.locator(".image-crop-image").boundingBox())!;
  const crop = (await page
    .getByRole("group", { name: /裁剪选区/ })
    .boundingBox())!;
  expect(crop.width).toBeLessThan(image.width);
  expect(crop.height).toBeCloseTo(image.height, 0);
  await cdp.detach();
});

test("按 EXIF 方向预览及裁剪，结果方向和尺寸一致", async ({
  page,
  visualWorkshop,
}) => {
  const state = await installCropRoutes(page, visualWorkshop);
  await page.goto("/apps/visual-workshop/projects/persona-project/canvas");
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 80;
    canvas.height = 40;
    const context = canvas.getContext("2d")!;
    context.fillStyle = "red";
    context.fillRect(0, 0, 40, 40);
    context.fillStyle = "blue";
    context.fillRect(40, 0, 40, 40);
    return canvas.toDataURL("image/jpeg", 1).split(",")[1];
  });
  const raw = Buffer.from(jpeg, "base64");
  const exif = Buffer.from(
    "ffe1002245786966000049492a0008000000010012010300010000000600000000000000",
    "hex",
  );
  const oriented = Buffer.concat([raw.subarray(0, 2), exif, raw.subarray(2)]);
  await page.route("**/v1/files/source-asset/content", (route) =>
    route.fulfill({ contentType: "image/jpeg", body: oriented }),
  );
  await openCrop(page);
  await expect(page.getByLabel("裁剪尺寸")).toHaveText("40 × 80 像素");
  await page
    .getByRole("button", { name: "调整裁剪下边缘", exact: true })
    .focus();
  for (let index = 0; index < 4; index++)
    await page.keyboard.press("Shift+ArrowUp");
  await page.getByRole("button", { name: "裁剪并添加到画布" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(state.pngs[0].readUInt32BE(16)).toBe(40);
  expect(state.pngs[0].readUInt32BE(20)).toBe(40);
});
