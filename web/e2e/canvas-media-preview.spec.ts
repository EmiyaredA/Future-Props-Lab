import { expect, type Locator } from "@playwright/test";
import { test } from "./fixtures/visual-workshop";
import { setResponsiveTheme } from "./responsive-capture";

const images = [
  { id: "portrait", width: 843, height: 1200 },
  { id: "landscape", width: 1600, height: 900 },
  { id: "square", width: 1200, height: 1200 },
];

async function expectImageContained(
  dialog: Locator,
  dimensions: (typeof images)[number],
) {
  const image = dialog.locator(".canvas-media-dialog-stage > img");
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => [
        element.naturalWidth,
        element.naturalHeight,
      ]),
    )
    .toEqual([dimensions.width, dimensions.height]);
  const bounds = await image.evaluate((element) => {
    const stage = element.parentElement!;
    const stageRect = stage.getBoundingClientRect();
    const style = getComputedStyle(stage);
    const rect = element.getBoundingClientRect();
    const footer = document
      .querySelector(".canvas-media-history")!
      .getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      stageLeft: stageRect.left + parseFloat(style.paddingLeft),
      stageTop: stageRect.top + parseFloat(style.paddingTop),
      stageRight: stageRect.right - parseFloat(style.paddingRight),
      stageBottom: stageRect.bottom - parseFloat(style.paddingBottom),
      footerTop: footer.top,
      fit: getComputedStyle(element).objectFit,
    };
  });
  expect(bounds.width).toBeGreaterThan(0);
  expect(bounds.height).toBeGreaterThan(0);
  expect(bounds.left).toBeGreaterThanOrEqual(bounds.stageLeft - 1);
  expect(bounds.top).toBeGreaterThanOrEqual(bounds.stageTop - 1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.stageRight + 1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.stageBottom + 1);
  expect(bounds.bottom).toBeLessThanOrEqual(bounds.footerTop);
  expect(bounds.width / bounds.height).toBeCloseTo(
    dimensions.width / dimensions.height,
    2,
  );
  expect(bounds.fit).toBe("contain");
  expect((bounds.left + bounds.right) / 2).toBeCloseTo(
    (bounds.stageLeft + bounds.stageRight) / 2,
    0,
  );
  expect((bounds.top + bounds.bottom) / 2).toBeCloseTo(
    (bounds.stageTop + bounds.stageBottom) / 2,
    0,
  );
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1440, height: 600 },
  { width: 390, height: 844 },
  { width: 780, height: 480 },
]) {
  for (const theme of ["light", "dark"]) {
    test(`图片完整预览和历史切换 ${viewport.width}×${viewport.height} ${theme}`, async ({
      page,
      visualWorkshop,
    }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.route(
        (url) =>
          images.some(({ id }) =>
            [`/v1/files/${id}/content`, `/v1/files/${id}/thumbnail`].includes(
              url.pathname,
            ),
          ),
        async (route) => {
          const id = new URL(route.request().url()).pathname.split("/").at(-2);
          const { width, height } = images.find((image) => image.id === id)!;
          await route.fulfill({
            contentType: "image/svg+xml",
            body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
            <rect width="100%" height="100%" fill="#9fbfc5"/>
            <rect x="4" y="4" width="${width - 8}" height="${height - 8}" fill="none" stroke="#25464e" stroke-width="8"/>
            <text x="50%" y="50%" text-anchor="middle" font-size="60">${width} × ${height}</text>
          </svg>`,
          });
        },
      );
      await page.route(
        "**/v1/visual-workshop/projects/persona-project/canvas",
        (route) =>
          route.fulfill({
            json: {
              project_id: "persona-project",
              revision: 0,
              updated_at: "2026-09-10T01:00:00Z",
              edges: [],
              nodes: [
                {
                  id: "preview-node",
                  kind: "image",
                  title: "完整图片预览",
                  position: { x: 100, y: 100 },
                  asset_id: "portrait",
                },
              ],
            },
          }),
      );
      await page.route("**/v1/visual-workshop/generation-tasks**", (route) =>
        route.fulfill({
          json: {
            items: images.slice(1).map((image) => ({
              ...visualWorkshop.task,
              id: `task-${image.id}`,
              canvas_node_id: "preview-node",
              status: "completed",
              error_message: null,
              can_retry_materialization: false,
              result_asset_id: image.id,
            })),
            total: 2,
          },
        }),
      );
      await page.goto("/apps/visual-workshop/projects/persona-project/canvas");
      await setResponsiveTheme(page, theme);
      await page.locator('[data-node-id="preview-node"]').dblclick();
      const dialog = page.getByRole("dialog", { name: "完整图片预览" });
      await expect(dialog).toBeVisible();
      await page.setViewportSize(viewport);
      await expectImageContained(dialog, images[0]);
      await page.screenshot({ path: testInfo.outputPath("portrait.png") });

      await dialog.getByRole("button", { name: "下一个生成记录" }).click();
      await expectImageContained(dialog, images[1]);
      await dialog
        .getByRole("button", { name: "下一个生成记录" })
        .press("Enter");
      await expectImageContained(dialog, images[2]);
      await dialog
        .getByRole("button", { name: "当前素材", exact: true })
        .click();
      await expectImageContained(dialog, images[0]);
      await expect(
        dialog.getByRole("link", { name: "下载当前预览素材" }),
      ).toHaveAttribute("href", /\/v1\/files\/portrait\/download\?/);
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      expect(visualWorkshop.generationRequests).toHaveLength(0);
    });
  }
}
