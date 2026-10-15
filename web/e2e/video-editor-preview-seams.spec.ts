import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type {
  VideoEditorClip,
  VideoEditorTimeline,
} from "../src/features/video-editor/types";

test("keeps decoded frames while scrubbing continuous seams with delayed exact frames", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/video-editor");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/video-editor/projects", {
    headers,
    data: { title: "连续接缝预览验收" },
  });
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  const base = `/v1/video-editor/projects/${project.id}`;
  let delayFrames = false;
  const releases: Array<() => void> = [];
  const waiting: number[] = [];
  await page.route(`**${base}/preview/frame?**`, async (route) => {
    if (delayFrames) {
      waiting.push(
        Number(new URL(route.request().url()).searchParams.get("timeUs")),
      );
      await new Promise<void>((resolve) => releases.push(resolve));
    }
    // Rapid scrubbing may cancel an obsolete image request before release.
    await route.continue().catch(() => undefined);
  });
  const releaseFrames = () => {
    delayFrames = false;
    for (const release of releases.splice(0)) release();
  };
  try {
    const fixture = info.outputPath("continuous.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=lime:s=320x180:r=24:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=320x180:r=24:d=4",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x180:r=24:d=4",
      "-filter_complex",
      "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]",
      "-map",
      "[v]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y",
      fixture,
    ]);
    const uploaded = await page.request.post(`${base}/assets`, {
      headers,
      multipart: {
        upload: {
          name: "连续.mp4",
          mimeType: "video/mp4",
          buffer: readFileSync(fixture),
        },
      },
    });
    expect(uploaded.ok()).toBeTruthy();
    const asset = await uploaded.json();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${base}/assets`)).json()).items.find(
            (item: { id: string }) => item.id === asset.id,
          )?.processingStatus,
      )
      .toBe("ready");
    const before: VideoEditorTimeline = await (
      await page.request.get(`${base}/timeline`)
    ).json();
    const track = before.document.tracks!.find(
      (item) => item.kind === "visual",
    )!;
    const left: VideoEditorClip = {
      id: "continuous-left",
      trackId: track.id,
      kind: "video",
      name: "连续左段",
      assetId: asset.id,
      timelineStartUs: 0,
      durationUs: 2_000_000,
      sourceInUs: 1_000_000,
      sourceLoop: false,
      fitMode: "cover",
      flipX: false,
      fontSize: 72,
      textColor: "#ffffff",
      volume: 1,
    };
    const right = {
      ...left,
      id: "continuous-right",
      name: "连续右段",
      timelineStartUs: 2_000_000,
      sourceInUs: 3_000_000,
    };
    const jump = {
      ...left,
      id: "jump",
      name: "跳剪",
      timelineStartUs: 4_000_000,
      sourceInUs: 6_000_000,
    };
    const black = {
      ...left,
      id: "black",
      kind: "color",
      name: "真实黑幕",
      assetId: undefined,
      color: "#000000",
      timelineStartUs: 7_000_000,
      durationUs: 1_000_000,
    };
    const seeded = await page.request.post(`${base}/timeline/operations`, {
      headers,
      data: {
        expectedRevision: before.revision,
        requestId: crypto.randomUUID(),
        operations: [left, right, jump, black].map((clip) => ({
          type: "addClip",
          clip,
        })),
      },
    });
    expect(seeded.ok()).toBeTruthy();
    await page.goto(`/apps/video-editor/projects/${project.id}/editor`);
    await expect(
      page.locator('[data-clip-id="continuous-left"]'),
    ).toBeVisible();
    const frame = page.getByAltText("后端精确停帧");
    const precise = page.getByRole("button", { name: "精确停帧", exact: true });
    if (!(await precise.getAttribute("class"))?.split(" ").includes("active"))
      await precise.click();
    await expect(precise).toHaveClass(/active/);
    const ruler = page.locator(".ve-ruler");
    const leftBounds = (await page
      .locator('[data-clip-id="continuous-left"]')
      .boundingBox())!;
    const rightBounds = (await page
      .locator('[data-clip-id="continuous-right"]')
      .boundingBox())!;
    const rulerBounds = (await ruler.boundingBox())!;
    const pixelsPerSecond = (rightBounds.x - leftBounds.x) / 2;
    const seek = async (seconds: number) => {
      await ruler.click({
        position: {
          x: leftBounds.x - rulerBounds.x + seconds * pixelsPerSecond,
          y: 10,
        },
      });
    };
    const sample = async () => {
      const visible = page.locator('.ve-precise-frame[style*="visible"]');
      await expect(visible).toHaveCount(1);
      return visible.evaluate((node) => {
        const image = node as HTMLImageElement;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0, 1, 1);
        return {
          src: image.src,
          red: context.getImageData(0, 0, 1, 1).data[0],
        };
      });
    };
    await seek(1.9);
    await expect(frame).toBeVisible();
    const first = await sample();
    expect(first.red).toBeGreaterThan(200);
    const video = page.locator(".ve-stage video");
    await video.evaluate((node) =>
      node.setAttribute("data-seam-decoder", "original"),
    );
    delayFrames = true;
    await seek(2.1);
    await expect.poll(() => waiting.length).toBeGreaterThan(0);
    await expect(video).toHaveAttribute("data-seam-decoder", "original");
    expect(await sample()).toEqual(first);
    await expect(page.getByText("画面更新中…", { exact: true })).toBeVisible();
    await seek(1.8);
    await seek(2.2);
    expect(await sample()).toEqual(first);
    const latestRequest = new URL(
      (await frame.getAttribute("src"))!,
      page.url(),
    ).href;
    releaseFrames();
    await expect(frame).toBeVisible();
    expect((await sample()).red).toBeGreaterThan(200);
    expect((await sample()).src).toBe(latestRequest);
    await expect(page.getByText("画面更新中…", { exact: true })).toHaveCount(0);
    await expect(video).toHaveAttribute("data-seam-decoder", "original");

    // Playback also keeps the same real HTMLVideoElement across the split.
    await seek(1.9);
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await expect
      .poll(async () =>
        video.evaluate((node) => (node as HTMLVideoElement).currentTime),
      )
      .toBeGreaterThan(3.1);
    await expect(video).toHaveAttribute("data-seam-decoder", "original");
    await page.getByRole("button", { name: "暂停", exact: true }).click();

    // Green is outside every trim. Sample the presented canvas throughout a
    // real playing cut from the red trim to a non-contiguous blue trim.
    await seek(3.8);
    await page.getByRole("button", { name: "播放", exact: true }).click();
    const samplePlayingCut = () =>
      page.locator(".ve-stage canvas.ve-keyed-media").evaluate(
        (node) =>
          new Promise<number[][]>((resolve) => {
            const source = node as HTMLCanvasElement;
            const tiny = document.createElement("canvas");
            tiny.width = tiny.height = 1;
            const ctx = tiny.getContext("2d")!;
            const samples: number[][] = [];
            const start = performance.now();
            const sample = () => {
              ctx.drawImage(source, 0, 0, 1, 1);
              samples.push([...ctx.getImageData(0, 0, 1, 1).data]);
              if (performance.now() - start < 700)
                requestAnimationFrame(sample);
              else resolve(samples);
            };
            sample();
          }),
      );
    const colors = await samplePlayingCut();
    expect(colors.some((color) => color[0] > 200)).toBeTruthy();
    expect(colors.some((color) => color[2] > 200)).toBeTruthy();
    expect(
      colors.every((color) => color[1] < 30 && color[3] === 255),
    ).toBeTruthy();
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await seek(4.2);
    await expect(frame).toBeVisible();
    await expect(video).toHaveAttribute("data-seam-decoder", "original");
    expect((await sample()).red).toBeLessThan(10);
    for (const seconds of [6.5, 7.5]) {
      await seek(seconds);
      await expect(frame).toBeVisible();
      expect((await sample()).red).toBeLessThan(10);
    }
    await seek(2.1);
    await expect(frame).toBeVisible();
    expect((await sample()).red).toBeGreaterThan(200);
    await page
      .locator(".ve-stage")
      .screenshot({ path: info.outputPath("continuous-seam.png") });

    // A transition on the preceding seam must not split this plain cut's
    // display buffer, even while the new source position is being decoded.
    const latestTimeline: VideoEditorTimeline = await (
      await page.request.get(`${base}/timeline`)
    ).json();
    const transitioned = await page.request.post(
      `${base}/timeline/operations`,
      {
        headers,
        data: {
          expectedRevision: latestTimeline.revision,
          requestId: crypto.randomUUID(),
          operations: [
            {
              type: "addTransition",
              transition: {
                id: "preceding-spin",
                kind: "spin-blur",
                placement: "between",
                fromClipId: left.id,
                toClipId: right.id,
                durationUs: 200_000,
                direction: "left",
                easing: "ease-in-out",
              },
            },
          ],
        },
      },
    );
    expect(transitioned.ok()).toBeTruthy();
    await page.reload();
    await expect(
      page.locator('[data-clip-id="continuous-left"]'),
    ).toBeVisible();
    await seek(3.5);
    await expect(frame).toBeVisible();
    await video.evaluate((node) =>
      node.setAttribute("data-seam-decoder", "after-spin"),
    );
    await page.getByRole("button", { name: "播放", exact: true }).click();
    const afterSpinColors = await samplePlayingCut();
    await expect(video).toHaveAttribute("data-seam-decoder", "after-spin");
    expect(afterSpinColors.some((color) => color[0] > 200)).toBeTruthy();
    expect(afterSpinColors.some((color) => color[2] > 200)).toBeTruthy();
    expect(
      afterSpinColors.every((color) => color[1] < 30 && color[3] === 255),
    ).toBeTruthy();
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    // Settle the final precise frame before deleting its source assets.
    await expect(frame).toBeVisible();
    await expect(page.getByText("画面更新中…", { exact: true })).toHaveCount(0);
  } finally {
    releaseFrames();
    const latest = await (await page.request.get(base)).json();
    expect(
      (
        await page.request.delete(
          `${base}?expected_revision=${latest.revision}`,
          { headers },
        )
      ).ok(),
    ).toBeTruthy();
  }
});
