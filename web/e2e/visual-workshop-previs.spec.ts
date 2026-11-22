import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.use({ actionTimeout: 12_000 });

test("白模场景可分镜、下载并将逐镜图发送到原画布", async ({ page }, info) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() =>
    localStorage.setItem("visual-canvas-engine", "legacy"),
  );
  await page.goto("/apps/visual-workshop");
  await page.getByRole("button", { name: "新建项目" }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/canvas$/);
  await expect(page.locator(".vue-flow__transformationpane")).toBeVisible();
  await page.getByRole("button", { name: "白模预演", exact: true }).click();
  await page.getByRole("textbox", { name: "场景名称" }).fill("对白分镜测试");
  await page.getByRole("button", { name: "新建预演场景" }).click();
  const editor = page.getByRole("region", { name: "镜头预演编辑器" });
  const viewport = editor.getByLabel(/3D 场景/);
  const topbar = page.locator(".visual-previs-library .visual-canvas-topbar");
  await expect(
    topbar.getByRole("button", { name: "白模预演", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(viewport).toBeVisible({ timeout: 30_000 });
  const editorBounds = (await editor.boundingBox())!;
  const topbarBounds = (await topbar.boundingBox())!;
  expect(editorBounds.y).toBeGreaterThan(topbarBounds.height);
  expect(editorBounds.x).toBeGreaterThan(0);
  expect(editorBounds.x + editorBounds.width).toBeLessThan(1440);
  await editor.getByRole("button", { name: "素材库", exact: true }).click();
  await editor.getByRole("combobox", { name: "素材分类" }).press("ArrowDown");
  await page.getByRole("option", { name: "整套景", exact: true }).click();
  await editor.getByRole("button", { name: /室内对话/ }).click();
  await expect(editor.getByText(/有未保存的修改/)).toBeVisible({
    timeout: 20_000,
  });
  await editor.getByRole("button", { name: "收起素材库" }).click();
  await editor.getByRole("button", { name: "场景演绎" }).click();
  await editor.getByRole("button", { name: "一键分镜" }).click();
  await expect(
    editor.getByRole("button", { name: "导出", exact: true }),
  ).toBeEnabled();
  await editor.getByRole("button", { name: "保存预演场景" }).click();
  await expect(editor.getByText("已保存", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("previs-editor.png") });

  async function chooseExports() {
    await editor.getByRole("button", { name: "导出", exact: true }).click();
    await page.getByRole("checkbox", { name: "分镜图", exact: true }).check();
    await page.getByRole("checkbox", { name: "镜头表", exact: true }).check();
    const video = page.getByRole("checkbox", { name: "预演小样", exact: true });
    if (await video.isEnabled()) await video.uncheck();
  }
  let uploads = 0;
  await page.route("**/node-uploads", async (route) => {
    if (++uploads !== 2) return route.continue();
    const committed = await route.fetch();
    expect(committed.ok(), await committed.text()).toBeTruthy();
    await route.fulfill({ status: 503, json: { detail: "模拟回填响应丢失" } });
  });
  await chooseExports();
  const downloaded = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "导出到画布" }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/\.html$/);
  const retry = editor.getByRole("button", { name: "继续发送剩余素材" });
  await expect(retry).toBeVisible({ timeout: 30_000 });
  await retry.click();
  await expect(editor.getByText("已发送 4 个素材到画布")).toBeVisible();
  expect(uploads).toBe(5);

  await editor.getByRole("button", { name: "导出", exact: true }).click();
  await page.getByRole("checkbox", { name: "分镜图", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "镜头表", exact: true }).uncheck();
  const video = page.getByRole("checkbox", { name: "预演小样", exact: true });
  if (await video.isEnabled()) {
    await video.check();
    const canEncodeH264 = await page.evaluate(async () => {
      const settings = {
        width: 1280,
        height: 720,
        bitrate: 2_211_840,
        framerate: 24,
        latencyMode: "quality",
        avc: { format: "avc" },
      } as const;
      for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42001f"]) {
        if (
          (
            await VideoEncoder.isConfigSupported({ ...settings, codec }).catch(
              () => undefined,
            )
          )?.supported
        )
          return true;
      }
      return false;
    });
    async function verifyPreview(extension: "mp4" | "webm") {
      const videoDownload = page.waitForEvent("download", { timeout: 90_000 });
      await page.getByRole("button", { name: "下载", exact: true }).click();
      const file = await videoDownload;
      expect(file.suggestedFilename().endsWith("." + extension)).toBeTruthy();
      await file.saveAs(info.outputPath(`previs-preview.${extension}`));
      const encoded = await readFile(await file.path());
      const dimensions = await page.evaluate(
        async ({ content, mime }) => {
          const preview = document.createElement("video");
          const url = URL.createObjectURL(
            new Blob(
              [
                Uint8Array.from(atob(content), (character) =>
                  character.charCodeAt(0),
                ),
              ],
              { type: mime },
            ),
          );
          try {
            await new Promise<void>((resolve, reject) => {
              preview.onloadeddata = () => resolve();
              preview.onerror = () => reject(new Error("预演视频无法解码"));
              preview.src = url;
            });
            return [preview.videoWidth, preview.videoHeight];
          } finally {
            preview.removeAttribute("src");
            preview.load();
            URL.revokeObjectURL(url);
          }
        },
        { content: encoded.toString("base64"), mime: "video/" + extension },
      );
      expect(dimensions).toEqual([1280, 720]);
    }

    await verifyPreview(canEncodeH264 ? "mp4" : "webm");
    if (canEncodeH264) {
      await page.evaluate(() => {
        const supported = VideoEncoder.isConfigSupported.bind(VideoEncoder);
        VideoEncoder.isConfigSupported = (config) =>
          config.codec.startsWith("avc1")
            ? Promise.resolve({ supported: false })
            : supported(config);
      });
      await editor.getByRole("button", { name: "导出", exact: true }).click();
      await verifyPreview("webm");
    }
  }

  await editor.getByRole("button", { name: "返回场景列表" }).click();
  await page.setViewportSize({ width: 650, height: 870 });
  await expect(page.getByRole("button", { name: "新建预演场景" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "对白分镜测试", exact: true }).click();
  await expect(
    editor.getByRole("button", { name: "导出", exact: true }),
  ).toBeEnabled();
  await expect(
    editor.getByRole("button", { name: "保存预演场景" }),
  ).toHaveCount(0);
  await editor.getByRole("button", { name: "播放成片" }).click();
  await expect(
    editor.getByLabel("全屏预演", { exact: true }).first(),
  ).toBeVisible();
  await expect(topbar).toBeVisible();
  await editor.getByRole("button", { name: "返回场景列表" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "对白分镜测试", exact: true }).click();
  await expect(viewport).toBeVisible();
  const sceneName = editor.getByRole("textbox", { name: "场景名称" });
  await sceneName.fill("已保存的对白分镜");
  const sceneRoute = "**/previs-scenes/*";
  await page.route(sceneRoute, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 503, json: { detail: "模拟保存失败" } })
      : route.continue(),
  );
  const canvasTab = topbar.getByRole("button", { name: "画布", exact: true });
  await canvasTab.click();
  await expect(editor.getByText("模拟保存失败", { exact: true })).toBeVisible();
  await expect(sceneName).toHaveValue("已保存的对白分镜");
  await page.unroute(sceneRoute);
  await canvasTab.click();
  await expect(editor).toHaveCount(0);
  await expect(page.locator(".vue-flow__transformationpane")).toBeVisible();
  await expect(page.locator(".canvas-node")).toHaveCount(4);
  await expect(page.getByRole("button", { name: /^(新|旧)画布$/ })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "白模预演", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "已保存的对白分镜", exact: true }),
  ).toBeVisible();
});
