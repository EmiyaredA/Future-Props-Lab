import { expect, test } from "@playwright/test";
import type {
  VideoEditorClip,
  VideoEditorTimeline,
} from "../src/features/video-editor/types";

test("drags images into mixed tracks and resizes edges with exact undo", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/apps/video-editor");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/v1/video-editor/projects") &&
      response.request().method() === "POST",
  );
  await page
    .locator(".workshop-page-header")
    .getByRole("button", { name: "新建剪辑" })
    .click();
  const project = await (await created).json();
  const base = `/v1/video-editor/projects/${project.id}`;
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const timeline = async (): Promise<VideoEditorTimeline> =>
    (await page.request.get(`${base}/timeline`)).json();
  const clips = async (): Promise<VideoEditorClip[]> =>
    (await timeline()).document.tracks!.flatMap((track) => track.clips ?? []);
  try {
    await page.getByLabel("上传素材（可多选）").setInputFiles({
      name: "结尾.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(page.getByRole("status")).toHaveText("上传完成：成功 1 个");
    const track = (await timeline()).document.tracks!.find(
      (track) => track.kind === "mixed",
    )!;
    const row = page.locator(`.ve-track-row[data-track-id="${track.id}"]`);
    const source = page.locator(".ve-asset-wrap").filter({ hasText: "结尾" });
    await expect(source.getByText("图片", { exact: true })).toBeVisible();
    const sourceBounds = (await source.boundingBox())!;
    const rowBounds = (await row.boundingBox())!;
    await page.mouse.move(sourceBounds.x + 30, sourceBounds.y + 20);
    await page.mouse.down();
    await page.mouse.move(rowBounds.x + 160, rowBounds.y + 25, { steps: 12 });
    await page.mouse.move(rowBounds.x + 161, rowBounds.y + 25);
    await page.mouse.up();
    await expect.poll(async () => (await clips()).length).toBe(1);
    const original = (await clips())[0];
    expect(original).toMatchObject({
      kind: "image",
      trackId: track.id,
      durationUs: 5_000_000,
    });
    const node = page.locator(`[data-clip-id="${original.id}"]`);
    await node.locator(".ve-clip-body").click();
    const end = node.getByRole("slider", { name: "结尾：调整结束边缘" });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await end.focus();
      await expect(end).toBeFocused();
      await expect(end).toHaveCSS("cursor", "ew-resize");
      await node.screenshot({ path: testInfo.outputPath(`trim-${theme}.png`) });
    }
    const bounds = (await end.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 20);
    await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width / 2 + 80, bounds.y + 20, {
      steps: 5,
    });
    await expect(node.locator("small")).toHaveText("6.00s");
    await page.mouse.up();
    await expect
      .poll(async () => (await clips())[0].durationUs)
      .toBeGreaterThan(5_900_000);
    const longer = (await clips())[0];
    await expect(page.getByLabel("片段时长 秒")).toHaveValue(
      (longer.durationUs / 1_000_000).toFixed(3),
    );
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect.poll(clips).toEqual([original]);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect.poll(clips).toEqual([longer]);
    const start = node.getByRole("slider", { name: "结尾：调整开始边缘" });
    const left = (await start.boundingBox())!;
    await page.mouse.move(left.x + 3, left.y + 20);
    await page.mouse.down();
    await page.mouse.move(left.x + 43, left.y + 20, { steps: 5 });
    await page.keyboard.press("Escape");
    await expect(node.locator("small")).toHaveText(
      `${(longer.durationUs / 1_000_000).toFixed(2)}s`,
    );
    await page.mouse.up();
    expect(await clips()).toEqual([longer]);
    await start.focus();
    await page.keyboard.press("ArrowRight");
    await expect
      .poll(async () => (await clips())[0].timelineStartUs)
      .toBeGreaterThan(longer.timelineStartUs);
    const trimmed = (await clips())[0];
    expect(trimmed.timelineStartUs + trimmed.durationUs).toBe(
      longer.timelineStartUs + longer.durationUs,
    );
    await page.reload();
    expect(await clips()).toEqual([trimmed]);
    const state = await timeline();
    const preflight = await page.request.post(`${base}/renders/preflight`, {
      headers,
      data: {
        expectedRevision: state.revision,
        preset: "720p30",
        startUs: trimmed.timelineStartUs,
        endUs: trimmed.timelineStartUs + trimmed.durationUs,
      },
    });
    expect(preflight.ok()).toBeTruthy();
    expect((await preflight.json()).ready).toBe(true);
  } finally {
    const current = await (await page.request.get(base)).json();
    expect(
      (
        await page.request.delete(
          `${base}?expected_revision=${current.revision}`,
          { headers },
        )
      ).ok(),
    ).toBeTruthy();
  }
});
