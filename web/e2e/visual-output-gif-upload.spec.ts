import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

const GIF = Buffer.from(
  "R0lGODlhEgAUAIEAAAAAAP8AAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQJCgAAACwAAAAAEgAUAAAIOAABCBxIsKDBgwgTKlyoMIDDhw4bQnwocWKAihMxQtRIMaHFiB4/cgSJ8OPFkBYZqlzJsqXLhAEBACH5BAkUAAAALAQABAAIAAsAgQAAAAD/AAAAAAAAAAgRAAMIHEiwoMGDCBMqXMhQYUAAIfkECR4AAAAsBAAEAAgACwCBAAAAAAD/AAAAAAAACBEAAwgcSLCgwYMIEypcyFBhQAA7",
  "base64",
);

for (const theme of ["light", "dark"] as const) {
  test(`视频输出上传 GIF、播放及刷新保留 (${theme})`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/apps/visual-workshop");
    const csrf = (await page.context().cookies()).find(
      (cookie) => cookie.name === "fpl_csrf",
    )!.value;
    const headers = {
      "X-CSRF-Token": csrf,
      Origin: new URL(page.url()).origin,
    };
    const created = await page.request.post("/v1/visual-workshop/projects", {
      headers,
      data: { title: "GIF 视频版本验收", kind: "canvas" },
    });
    expect(created.ok()).toBeTruthy();
    const id = (await created.json()).id as string;
    const base = `/v1/visual-workshop/projects/${id}`;
    const saved = await page.request.put(base + "/canvas", {
      headers,
      data: {
        expected_revision: 0,
        nodes: [
          {
            id: "dance",
            kind: "video",
            title: "GIF 舞蹈",
            position: { x: 0, y: 0 },
          },
        ],
        edges: [],
      },
    });
    expect(saved.ok()).toBeTruthy();
    await page.goto(`/apps/visual-workshop/projects/${id}/canvas`);
    await page.getByRole("button", { name: "看板", exact: true }).click();
    await setResponsiveTheme(page, theme);
    await page.getByRole("button", { name: /GIF 舞蹈 视频/ }).click();
    const panel = page.getByRole("region", { name: "节点输出历史" });
    await expect(panel.getByText(/GIF 转为无声 MP4/)).toBeVisible();
    const chooser = page.waitForEvent("filechooser");
    await panel.getByRole("button", { name: "上传版本", exact: true }).click();
    await (
      await chooser
    ).setFiles({ name: "dance.gif", mimeType: "image/gif", buffer: GIF });
    await expect(panel.getByLabel("当前预览 v1 · 最终输出 v1")).toBeVisible();
    const video = panel.locator(".board-large-preview video");
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.duration),
      )
      .toBeCloseTo(0.6, 2);
    await video.evaluate((element: HTMLVideoElement) => element.play());
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0);
    await page.reload();
    await expect(panel.getByLabel("当前预览 v1 · 最终输出 v1")).toBeVisible();
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.duration),
      )
      .toBeCloseTo(0.6, 2);
    await expect(
      panel.getByText("检查视频：WebM · VP9 · 含透明通道"),
    ).toBeVisible();
    await expect(
      panel.getByText("原输出：MP4 · H264 · 无透明通道"),
    ).toBeVisible();
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.pause();
      const seeked = new Promise<void>((resolve) =>
        element.addEventListener("seeked", () => resolve(), { once: true }),
      );
      element.currentTime = 0.25;
      await seeked;
    });
    const source = await video.getAttribute("src");
    for (const [name, color] of [
      ["白", "#FFFFFF"],
      ["绿", "#00FF00"],
      ["洋红", "#FF00FF"],
    ]) {
      await panel.getByRole("button", { name: `${name}色背景` }).click();
      expect(await video.getAttribute("src")).toBe(source);
      expect(
        await video.evaluate((v: HTMLVideoElement) => v.currentTime),
      ).toBeCloseTo(0.25, 2);
      expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(
        true,
      );
      // Chromium must decode actual Alpha, not merely report the metadata tag.
      const pixel = await video.evaluate(
        (v: HTMLVideoElement, background: string) => {
          const canvas = document.createElement("canvas");
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          const context = canvas.getContext("2d")!;
          context.drawImage(v, 0, 0);
          const alpha = context.getImageData(0, 0, 1, 1).data[3];
          context.globalCompositeOperation = "destination-over";
          context.fillStyle = background;
          context.fillRect(0, 0, canvas.width, canvas.height);
          return {
            alpha,
            rgba: Array.from(context.getImageData(0, 0, 1, 1).data),
          };
        },
        color,
      );
      expect(pixel.alpha).toBe(0);
      expect(pixel.rgba).toEqual(
        color === "#FFFFFF"
          ? [255, 255, 255, 255]
          : color === "#00FF00"
            ? [0, 255, 0, 255]
            : [255, 0, 255, 255],
      );
    }
    await panel.getByRole("button", { name: "自定义预览背景" }).click();
    await page.getByLabel("自定义预览背景十六进制值").fill("#123456");
    await page.getByLabel("自定义预览背景十六进制值").press("Enter");
    await expect(video).toHaveCSS("background-color", "rgb(18, 52, 86)");
    await panel.getByRole("button", { name: "全屏预览" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            !!document.fullscreenElement?.classList.contains(
              "board-video-preview",
            ),
        ),
      )
      .toBe(true);
    await expect(video).toHaveCSS("background-color", "rgb(18, 52, 86)");
    await page.evaluate(() => document.exitFullscreen());
    await page.screenshot({ path: info.outputPath("gif-video-output.png") });
    const state = (await page.request.get(base + "/canvas")).json();
    const current = await state;
    const history = (
      await (await page.request.get(base + "/nodes/dance/outputs")).json()
    ).items;
    const mp4 = await page.request.get(
      `/v1/files/${history[0].asset_id}/content`,
    );
    const uploaded = await page.request.post(
      base + "/nodes/dance/output-uploads",
      {
        headers,
        multipart: {
          expected_revision: String(current.revision),
          file: {
            name: "opaque.mp4",
            mimeType: "video/mp4",
            buffer: await mp4.body(),
          },
        },
      },
    );
    expect(uploaded.ok()).toBeTruthy();
    // Refresh preserves media associations; preview background is intentionally local.
    await page.reload();
    await expect(
      panel.getByText("视频格式：MP4 · H264 · 无透明通道"),
    ).toBeVisible();
    await panel.getByRole("button", { name: "白色背景" }).click();
    await panel
      .locator(".board-version-select")
      .filter({ hasText: "v1" })
      .click();
    await expect(
      panel.getByText("检查视频：WebM · VP9 · 含透明通道"),
    ).toBeVisible();
    await expect(panel.locator("video")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await panel
      .locator(".board-version-select")
      .filter({ hasText: "v2" })
      .click();
    await expect(
      panel.getByText("视频格式：MP4 · H264 · 无透明通道"),
    ).toBeVisible();
    await expect(panel.locator("video")).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await panel
        .getByRole("button", { name: "白色背景" })
        .scrollIntoViewIfNeeded();
      await expect(
        panel.getByRole("button", { name: "洋红色背景" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`video-preview-${width}.png`),
      });
    }
  });
}
