import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

test("merges continuous selected clips, supports undo redo, and retains the result after reload", async ({
  page,
}, info) => {
  test.setTimeout(120000);
  const path = info.outputPath("source.mp4");
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
    path,
  ]);
  await page.goto("/apps/video-editor");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/video-editor/projects", {
    headers,
    data: { title: "连续片段合并" },
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
          buffer: readFileSync(path),
        },
      },
    });
    expect(upload.ok()).toBeTruthy();
    const asset = await upload.json();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${root}/assets`)).json()).items.find(
            (item: { id: string }) => item.id === asset.id,
          )?.processingStatus,
        { timeout: 30000 },
      )
      .toBe("ready");
    const saved = await page.request.post(`${root}/timeline/operations`, {
      headers,
      data: {
        expectedRevision: 0,
        requestId: "e2e-merge-setup",
        operations: [
          { type: "updateSettings", patch: { videoFitPolicyVersion: 1 } },
          ...[0, 1, 2].map((index) => ({
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
        ],
      },
    });
    expect(saved.ok(), await saved.text()).toBeTruthy();
    await page.goto(`/apps/video-editor/projects/${project.id}/editor`);
    await page.getByRole("slider", { name: "时间轴缩放", exact: true }).focus();
    await page.keyboard.press("End");
    await page.locator('[data-clip-id="clip-0"]').click();
    await page
      .locator('[data-clip-id="clip-1"]')
      .click({ modifiers: ["ControlOrMeta"] });
    await page.getByRole("button", { name: "合并片段", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "合并片段", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "合并名称" })).toHaveValue(
      "镜头 1－合并",
    );
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        const bounds = (await dialog.boundingBox())!;
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        expect(
          await dialog.evaluate(
            (element) => element.scrollWidth <= element.clientWidth + 1,
          ),
        ).toBeTruthy();
        await dialog.screenshot({
          path: info.outputPath(`merge-${width}-${theme}.png`),
        });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await dialog.getByRole("textbox", { name: "合并名称" }).fill("完整镜头");
    await dialog.getByRole("button", { name: "开始合并" }).focus();
    await page.keyboard.press("Enter");
    await expect(dialog).not.toBeVisible({ timeout: 60000 });
    await expect(page.locator(".ve-clip")).toHaveCount(2);
    await expect(page.locator(".ve-clip.selected")).toContainText("完整镜头");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(page.locator(".ve-clip")).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: "重做", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect(page.locator(".ve-clip")).toHaveCount(2);
    await page.reload();
    await expect(page.locator(".ve-clip")).toHaveCount(2);
    const merged = page.locator(".ve-clip").filter({ hasText: "完整镜头" });
    await merged.click({ button: "right" });
    await page.getByRole("menuitem", { name: "合并片段", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("请选择 2～100");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  } finally {
    await page.request.delete(`${root}?expected_revision=0`, { headers });
  }
});
