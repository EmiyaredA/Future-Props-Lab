import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type {
  VideoEditorClip,
  VideoEditorTimeline,
} from "../src/features/video-editor/types";

test("keeps speed changes and asset drops aligned with exact undo", async ({
  page,
}, testInfo) => {
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
  const getTimeline = async (): Promise<VideoEditorTimeline> =>
    (await page.request.get(`${base}/timeline`)).json();
  const getClips = (state: VideoEditorTimeline) =>
    state.document.tracks!.flatMap((track) => track.clips ?? []);
  try {
    const fixturePath = testInfo.outputPath("alignment.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=32x32:r=30",
      "-t",
      "8",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y",
      fixturePath,
    ]);
    const uploaded = await page.request.post(`${base}/assets`, {
      headers,
      multipart: {
        upload: {
          name: "对齐测试.mp4",
          mimeType: "video/mp4",
          buffer: readFileSync(fixturePath),
        },
      },
    });
    expect(uploaded.ok()).toBeTruthy();
    const asset = await uploaded.json();
    await expect
      .poll(async () => {
        const response = await page.request.get(`${base}/assets`);
        return (await response.json()).items.find(
          (item: { id: string }) => item.id === asset.id,
        )?.processingStatus;
      })
      .toBe("ready");
    const before = await getTimeline();
    const mixed = before.document.tracks!.find(
      (track) => track.kind === "mixed",
    )!;
    const selected: VideoEditorClip = {
      id: "speed-first",
      trackId: mixed.id,
      name: "变速片段",
      kind: "video",
      assetId: asset.id,
      timelineStartUs: 0,
      durationUs: 4_000_003,
      playbackRate: 1,
    };
    const next: VideoEditorClip = {
      ...selected,
      id: "speed-next",
      name: "后续片段",
      timelineStartUs: 4_000_003,
      durationUs: 1_234_567,
    };
    const seeded = await page.request.post(`${base}/timeline/operations`, {
      headers,
      data: {
        expectedRevision: before.revision,
        requestId: crypto.randomUUID(),
        operations: [
          { type: "addClip", clip: selected },
          { type: "addClip", clip: next },
        ],
      },
    });
    expect(seeded.ok()).toBeTruthy();
    const original = getClips(await getTimeline());
    await page.reload();
    await page.locator('[data-clip-id="speed-first"]').click();
    const follow = page.getByRole("switch", { name: "后续片段跟随" });
    await expect(follow).toBeChecked();
    await follow.focus();
    await page.keyboard.press("Space");
    await expect(follow).not.toBeChecked();
    await page.waitForTimeout(200);
    await page.reload();
    await expect(follow).not.toBeChecked();
    await follow.click();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await follow.focus();
      await expect(follow).toBeFocused();
      await expect(follow.locator(".ve-switch-indicator")).toHaveCSS(
        "background-color",
        "rgb(121, 100, 233)",
      );
      await page
        .locator(".ve-speed-section")
        .screenshot({ path: testInfo.outputPath(`speed-${theme}.png`) });
    }
    await page.getByLabel("播放速度倍率").fill("2");
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await expect
      .poll(
        async () =>
          getClips(await getTimeline()).find((clip) => clip.id === next.id)!
            .timelineStartUs,
      )
      .toBe(2_000_001);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect
      .poll(async () => getClips(await getTimeline()))
      .toEqual(original);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect
      .poll(
        async () =>
          getClips(await getTimeline()).find((clip) => clip.id === next.id)!
            .timelineStartUs,
      )
      .toBe(2_000_001);

    const seam = 3_234_568;
    const row = page.locator(`.ve-track-row[data-track-id="${mixed.id}"]`);
    const source = page
      .locator(".ve-asset-wrap")
      .filter({ hasText: "对齐测试.mp4" });
    const rowBounds = (await row.boundingBox())!;
    const nextBounds = (await page
      .locator('[data-clip-id="speed-next"]')
      .boundingBox())!;
    const x = nextBounds.x + nextBounds.width + 3;
    const y = rowBounds.y + 25;
    const sourceBounds = (await source.boundingBox())!;
    await page.mouse.move(sourceBounds.x + 30, sourceBounds.y + 20);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 12 });
    await page.mouse.move(x + 1, y);
    await expect(page.locator(".ve-snap-guide")).toBeVisible();
    expect((await page.locator(".ve-snap-guide").boundingBox())!.x).toBeCloseTo(
      nextBounds.x + nextBounds.width,
      0,
    );
    await page.mouse.up();
    await expect.poll(async () => getClips(await getTimeline()).length).toBe(3);
    const added = getClips(await getTimeline()).find(
      (clip) => ![selected.id, next.id].includes(clip.id),
    )!;
    expect(added.timelineStartUs).toBe(seam);
    await expect(page.locator(".ve-snap-guide")).toHaveCount(0);
    await page.reload();
    expect(
      getClips(await getTimeline()).find((clip) => clip.id === added.id)!
        .timelineStartUs,
    ).toBe(seam);

    // Existing clip right edge can also meet a non-frame-aligned seam.
    const addedClip = page.locator(`[data-clip-id="${added.id}"]`);
    const addedBounds = (await addedClip.boundingBox())!;
    await page.mouse.move(addedBounds.x + 30, addedBounds.y + 20);
    await page.mouse.down();
    await page.mouse.move(addedBounds.x + 45, addedBounds.y + 20);
    await page.mouse.move(addedBounds.x + 32, addedBounds.y + 20);
    await expect(page.locator(".ve-snap-guide")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await expect(page.locator(".ve-snap-guide")).toHaveCount(0);
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
