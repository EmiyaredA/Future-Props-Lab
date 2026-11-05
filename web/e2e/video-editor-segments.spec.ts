import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { setResponsiveTheme } from "./responsive-capture";

test("selects segments, exports without importing, and downloads from task history", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const videoPath = info.outputPath("source.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=64x64:r=30",
    "-t",
    "1",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    videoPath,
  ]);
  await page.goto("/apps/video-editor");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/video-editor/projects", {
    headers,
    data: { title: "分段勾选测试" },
  });
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  const root = `/v1/video-editor/projects/${project.id}`;
  try {
    const upload = await page.request.post(`${root}/assets`, {
      headers,
      multipart: {
        upload: {
          name: "source.mp4",
          mimeType: "video/mp4",
          buffer: readFileSync(videoPath),
        },
      },
    });
    expect(upload.ok(), await upload.text()).toBeTruthy();
    const asset = await upload.json();
    await expect
      .poll(
        async () => {
          const assets = await (
            await page.request.get(`${root}/assets`)
          ).json();
          return assets.items.find(
            (item: { id: string }) => item.id === asset.id,
          )?.processingStatus;
        },
        { timeout: 30000 },
      )
      .toBe("ready");
    const saved = await page.request.post(`${root}/timeline/operations`, {
      headers,
      data: {
        expectedRevision: 0,
        requestId: "e2e-add-segments",
        operations: [0, 1, 2].map((index) => ({
          type: "addClip",
          clip: {
            id: `clip-${index}`,
            trackId: "visual-1",
            kind: "video",
            name: `镜头 ${index + 1}`,
            assetId: asset.id,
            timelineStartUs: index * 200000,
            sourceInUs: index * 200000,
            durationUs: 200000,
          },
        })),
      },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    await page.goto(`/apps/video-editor/projects/${project.id}/editor`);
    await page.getByRole("button", { name: "分段导出", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "分段导出" });
    await expect(dialog).toBeVisible();
    const first = dialog.getByRole("checkbox", { name: "选择片段 1：镜头 1" });
    await expect(first).toBeChecked();
    await first.focus();
    await page.keyboard.press("Space");
    await expect(first).not.toBeChecked();
    await dialog.getByRole("checkbox", { name: "导入画布项目" }).click();
    await expect(
      dialog.getByRole("button", { name: "开始导出", exact: true }),
    ).toBeEnabled();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        await setResponsiveTheme(page, theme);
        await expect(dialog).toHaveCSS("color", "rgb(223, 232, 239)");
        const bounds = (await dialog.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(
          await dialog.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        ).toBeTruthy();
        const body = dialog.locator(".ve-segment-body");
        expect(
          await body.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        ).toBeTruthy();
        await dialog.screenshot({
          path: info.outputPath(`segment-${width}-${theme}.png`),
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const submitted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/segment-exports") &&
        response.request().method() === "POST",
    );
    await dialog.getByRole("button", { name: "开始导出", exact: true }).click();
    const response = await submitted;
    expect(response.ok(), await response.text()).toBeTruthy();
    expect(response.request().postDataJSON()).toMatchObject({
      target: null,
      segments: [{ clipId: "clip-1" }, { clipId: "clip-2" }],
    });
    await expect(first).toBeDisabled();
    await dialog
      .getByRole("button", { name: "关闭", exact: true })
      .first()
      .click();
    await expect(dialog).not.toBeVisible();
    await page.goto("/apps/video-editor/tasks");
    const card = page
      .locator(".ve-task-list article")
      .filter({ hasText: "分段导出" })
      .first();
    await expect(
      card.getByRole("button", { name: "全部打包下载" }),
    ).toBeVisible({ timeout: 30000 });
    const zip = page.waitForEvent("download");
    await card.getByRole("button", { name: "全部打包下载" }).click();
    expect((await zip).suggestedFilename()).toMatch(/\.zip$/);
    await card.getByRole("button", { name: "逐段下载（2）" }).click();
    await page.setViewportSize({ width: 390, height: 900 });
    await expect(card.locator("li").first().locator("span")).toBeVisible();
    expect(
      await card
        .locator("li")
        .first()
        .locator("span")
        .evaluate((element) => element.getBoundingClientRect().height),
    ).toBeGreaterThan(10);
    await card.screenshot({ path: info.outputPath("segment-task-mobile.png") });
    const mp4 = page.waitForEvent("download");
    await card.getByRole("button", { name: "下载片段 1：镜头 2" }).click();
    expect((await mp4).suggestedFilename()).toBe("镜头 2.mp4");
  } finally {
    const current = await (await page.request.get(root)).json();
    await page.request.delete(`${root}?expected_revision=${current.revision}`, {
      headers,
    });
  }
});
