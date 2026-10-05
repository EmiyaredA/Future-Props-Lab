import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test, type Locator } from "@playwright/test";
import type {
  VideoEditorClip,
  VideoEditorTimeline,
} from "../src/features/video-editor/types";

test("transforms video in the monitor with exact-frame restoration, persistence and undo", async ({
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
    data: { title: "变换操作框验收" },
  });
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  const base = `/v1/video-editor/projects/${project.id}`;
  const getTimeline = async (): Promise<VideoEditorTimeline> =>
    (await page.request.get(`${base}/timeline`)).json();
  const getClip = async () =>
    (await getTimeline()).document
      .tracks!.flatMap((track) => track.clips ?? [])
      .find((clip) => clip.id === "transform-video")!;
  try {
    const fixture = info.outputPath("transform.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=640x360:r=30",
      "-t",
      "3",
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
          name: "变换.mp4",
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
    const before = await getTimeline();
    const track = before.document.tracks!.find(
      (track) => track.kind === "visual",
    )!;
    const clip: VideoEditorClip = {
      id: "transform-video",
      trackId: track.id,
      kind: "video",
      name: "框线测试视频",
      assetId: asset.id,
      timelineStartUs: 0,
      durationUs: 3_000_000,
      sourceInUs: 0,
      sourceLoop: false,
      fitMode: "cover",
      flipX: false,
      fontSize: 72,
      textColor: "#ffffff",
      volume: 1,
      transform: {
        x: 960,
        y: 540,
        scaleX: 0.5,
        scaleY: 0.5,
        rotation: 0,
        opacity: 1,
        brightness: 1,
        anchor: "center",
      },
    };
    const seeded = await page.request.post(`${base}/timeline/operations`, {
      headers,
      data: {
        expectedRevision: before.revision,
        requestId: crypto.randomUUID(),
        operations: [{ type: "addClip", clip }],
      },
    });
    expect(seeded.ok()).toBeTruthy();
    await page.goto(`/apps/video-editor/projects/${project.id}/editor`);
    await page.locator('[data-clip-id="transform-video"]').click();
    const stage = page.locator(".ve-stage");
    const frame = page.getByAltText("后端精确停帧");
    if (!(await frame.count()))
      await page.getByRole("button", { name: "精确停帧", exact: true }).click();
    await expect(frame).toBeVisible();
    const move = page.getByRole("button", { name: "移动画面", exact: true });
    let bounds = (await stage.boundingBox())!;
    const start = {
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y + 20, { steps: 5 });
    await expect(frame).toHaveCount(0);
    const expectedX = 960 + (40 * 1920) / bounds.width;
    await expect
      .poll(async () =>
        Number(await page.getByLabel("位置 X", { exact: true }).inputValue()),
      )
      .toBeCloseTo(expectedX, 3);
    const saving = page.waitForResponse(
      (response) =>
        response.url().endsWith("/timeline/operations") &&
        response.request().method() === "POST",
    );
    await page.mouse.up();
    expect((await saving).ok()).toBeTruthy();
    await expect(frame).toBeVisible();
    await expect
      .poll(async () => (await getClip()).transform!.x)
      .toBeCloseTo(expectedX, 3);
    const moved = (await getClip()).transform!;
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect
      .poll(async () => (await getClip()).transform)
      .toEqual(clip.transform);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect.poll(async () => (await getClip()).transform).toEqual(moved);

    const dragHandle = async (handle: Locator, dx: number, dy: number) => {
      const handleBounds = (await handle.boundingBox())!;
      const x = handleBounds.x + handleBounds.width / 2,
        y = handleBounds.y + handleBounds.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 5 });
      const response = page.waitForResponse(
        (response) =>
          response.url().endsWith("/timeline/operations") &&
          response.request().method() === "POST",
      );
      await page.mouse.up();
      expect((await response).ok()).toBeTruthy();
      await expect(frame).toBeVisible();
      await expect(move).toBeEnabled();
    };
    await dragHandle(
      page.getByRole("button", { name: "右下等比缩放" }),
      30,
      (30 * 1080) / 1920,
    );
    const scaled = (await getClip()).transform!;
    expect(scaled.scaleX).toBeGreaterThan(moved.scaleX);
    expect(scaled.scaleX).toBeCloseTo(scaled.scaleY, 6);
    await dragHandle(page.getByRole("button", { name: "右侧拉伸" }), 20, 0);
    const stretched = (await getClip()).transform!;
    expect(stretched.scaleX).toBeGreaterThan(scaled.scaleX);
    expect(stretched.scaleY).toBe(scaled.scaleY);
    await page.keyboard.down("Shift");
    await dragHandle(
      page.getByRole("button", { name: "旋转画面", exact: true }),
      50,
      20,
    );
    await page.keyboard.up("Shift");
    const rotated = (await getClip()).transform!;
    const sampledFrame = await frame.evaluate((node) => {
      const image = node as HTMLImageElement;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return { width: canvas.width, height: canvas.height, src: image.src };
    });
    expect(sampledFrame.width / sampledFrame.height).toBeCloseTo(
      1920 / 1080,
      2,
    );
    expect(new URL(sampledFrame.src).searchParams.get("revision")).toBe(
      String((await getTimeline()).revision),
    );
    const anchorPixel = await frame.evaluate((node, position) => {
      const image = node as HTMLImageElement,
        canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return Array.from(
        context.getImageData(
          Math.round((position.x / 1920) * canvas.width),
          Math.round((position.y / 1080) * canvas.height),
          1,
          1,
        ).data,
      );
    }, rotated);
    expect(anchorPixel[0]).toBeGreaterThan(200);
    expect(anchorPixel[1]).toBeLessThan(40);

    expect(rotated.rotation).not.toBe(0);
    expect(rotated.rotation % 15).toBe(0);
    bounds = (await stage.boundingBox())!;
    await page.mouse.move(
      bounds.x + (rotated.x / 1920) * bounds.width,
      bounds.y + (rotated.y / 1080) * bounds.height,
    );
    await page.mouse.down();
    await page.mouse.move(
      bounds.x + bounds.width / 2 + 30,
      bounds.y + bounds.height / 2 + 30,
    );
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect((await getClip()).transform).toEqual(rotated);
    await page.reload();
    await page.locator('[data-clip-id="transform-video"]').click();
    await expect(page.getByLabel("旋转", { exact: true })).toHaveValue(
      String(rotated.rotation),
    );
    await expect(frame).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.getByRole("button", { name: "旋转画面", exact: true }).focus();
      await expect(
        page.getByRole("button", { name: "旋转画面", exact: true }),
      ).toBeFocused();
      await stage.screenshot({
        path: info.outputPath(`transform-${theme}.png`),
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(move).toBeVisible();
    await page.getByRole("button", { name: "全屏预览" }).click();
    await expect
      .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
      .toBe(true);
    await expect(move).toBeVisible();
    await move.focus();
    await page.keyboard.press("ArrowRight");
    bounds = (await stage.boundingBox())!;
    expect(bounds.width / bounds.height).toBeCloseTo(1920 / 1080, 2);
    await expect
      .poll(async () => (await getClip()).transform!.x)
      .toBeCloseTo(rotated.x + 1, 5);
    await page.evaluate(() => document.exitFullscreen());

    // At full canvas size all edge handles and the elevated rotation handle remain reachable.
    await page.getByLabel("水平缩放", { exact: true }).fill("1");
    await page.getByLabel("水平缩放", { exact: true }).blur();
    await expect.poll(async () => (await getClip()).transform!.scaleX).toBe(1);
    await page.getByLabel("垂直缩放", { exact: true }).fill("1");
    await page.getByLabel("垂直缩放", { exact: true }).blur();
    await expect.poll(async () => (await getClip()).transform!.scaleY).toBe(1);
    for (const [label, value, property] of [
      ["位置 X", "960", "x"],
      ["位置 Y", "540", "y"],
      ["旋转", "0", "rotation"],
    ] as const) {
      await page.getByLabel(label, { exact: true }).fill(value);
      await page.getByLabel(label, { exact: true }).blur();
      await expect
        .poll(async () => (await getClip()).transform![property])
        .toBe(Number(value));
      await expect(frame).toBeVisible();
    }
    await expect(
      page.getByRole("button", { name: /等比缩放|拉伸|旋转画面/ }),
    ).toHaveCount(9);
    for (const label of ["左上等比缩放", "右下等比缩放", "旋转画面"]) {
      await expect(
        page.getByRole("button", { name: label, exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: label, exact: true })
        .click({ trial: true });
    }

    const mirroredState = await getTimeline();
    const mirrored = await page.request.post(`${base}/timeline/operations`, {
      headers,
      data: {
        expectedRevision: mirroredState.revision,
        requestId: crypto.randomUUID(),
        operations: [
          {
            type: "restoreClipStates",
            clips: [
              {
                ...clip,
                flipX: true,
                transform: {
                  ...clip.transform,
                  x: 480,
                  y: 270,
                  anchor: "topLeft",
                },
              },
            ],
          },
        ],
      },
    });
    expect(mirrored.ok()).toBeTruthy();
    await page.reload();
    await page.locator('[data-clip-id="transform-video"]').click();
    await expect(frame).toBeVisible();
    const mirroredBounds = (await stage.boundingBox())!;
    const layerBounds = (await page.locator(".ve-stage-layer").boundingBox())!;
    expect(layerBounds.x - mirroredBounds.x).toBeCloseTo(
      mirroredBounds.width / 4,
      1,
    );
    expect(layerBounds.y - mirroredBounds.y).toBeCloseTo(
      mirroredBounds.height / 4,
      1,
    );
    await expect(page.locator(".ve-stage-media-content")).toHaveCSS(
      "transform",
      "matrix(-1, 0, 0, 1, 0, 0)",
    );
    const mirroredPixels = await frame.evaluate((node) => {
      const image = node as HTMLImageElement,
        canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      return [0.15, 0.35].map(
        (x) =>
          context.getImageData(
            Math.round(x * canvas.width),
            Math.round(canvas.height / 2),
            1,
            1,
          ).data[0],
      );
    });
    expect(mirroredPixels[0]).toBeLessThan(20);
    expect(mirroredPixels[1]).toBeGreaterThan(200);
    await move.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await getClip()).transform!.x).toBe(481);
  } finally {
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
