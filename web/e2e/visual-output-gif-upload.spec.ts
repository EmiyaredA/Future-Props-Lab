import { expect, test } from "@playwright/test";
import { setResponsiveTheme } from "./responsive-capture";

const GIF = Buffer.from(
  "R0lGODlhEgAUAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAEgAUAAAIIQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzakwYEAAh+QQBFAABACwAAAAAEgAUAIEAgAAAAAAAAAAAAAAIIQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzakwYEAAh+QQBHgABACwAAAAAEgAUAIEAAP8AAAAAAAAAAAAIIQABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzakwYEAA7",
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
    await page.screenshot({ path: info.outputPath("gif-video-output.png") });
  });
}
