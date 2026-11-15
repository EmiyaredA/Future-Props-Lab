import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

async function playbackSample(page: Page) {
  return page.evaluate(async () => {
    const started = performance.now();
    let last = started;
    let longestFrameMs = 0;
    let ticks = 0;
    await new Promise<void>((resolve) => {
      const tick = () => {
        const now = performance.now();
        longestFrameMs = Math.max(longestFrameMs, now - last);
        last = now;
        ticks++;
        if (now - started < 1200) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
    return {
      elapsedMs: performance.now() - started,
      ticks,
      longestFrameMs,
      videoCount: document.querySelectorAll(".ve-stage video").length,
      audioCount: document.querySelectorAll(".ve-proxy-audio audio").length,
      canvasCount: document.querySelectorAll(".ve-stage canvas").length,
      videos: [
        ...document.querySelectorAll<HTMLVideoElement>(".ve-stage video"),
      ].map((video) => ({
        currentTime: video.currentTime,
        width: video.videoWidth,
        height: video.videoHeight,
        totalFrames: video.getVideoPlaybackQuality().totalVideoFrames,
        droppedFrames: video.getVideoPlaybackQuality().droppedVideoFrames,
      })),
    };
  });
}

test("plays a retained multi-track 60 FPS preview with one decoder across dense cuts", async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/video-editor");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const project = await (
    await page.request.post("/v1/video-editor/projects", {
      headers,
      data: { title: "预渲染 · 密集切镜验收" },
    })
  ).json();
  const base = `/v1/video-editor/projects/${project.id}`;
  try {
    const fixture = info.outputPath("pattern-audio.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=60:duration=4",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=48000:duration=4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-y",
      fixture,
    ]);
    const uploaded = await page.request.post(base + "/assets", {
      headers,
      multipart: {
        upload: {
          name: "pattern-audio.mp4",
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
          (await (await page.request.get(base + "/assets")).json()).items[0]
            ?.processingStatus,
        { timeout: 30_000 },
      )
      .toBe("ready");
    const timeline = await (await page.request.get(base + "/timeline")).json();
    const operations = [
      { type: "updateSettings", patch: { fps: 60 } },
      { type: "reorderTrack", trackId: "visual-1", order: 3 },
      ...Array.from({ length: 8 }, (_, index) => ({
        type: "addClip",
        clip: {
          id: `cut-${index}`,
          trackId: "visual-1",
          kind: "video",
          name: `切镜 ${index + 1}`,
          assetId: asset.id,
          timelineStartUs: index * 500_000,
          durationUs: 500_000,
          sourceInUs: index % 2 ? 2_500_000 : 500_000,
          transitionIn: { kind: "crossfade", durationUs: 80_000 },
        },
      })),
      {
        type: "addClip",
        clip: {
          id: "pip",
          trackId: "mixed-1",
          kind: "video",
          name: "画中画与音频",
          assetId: asset.id,
          timelineStartUs: 0,
          durationUs: 4_000_000,
          volume: 0.5,
          transform: { x: 300, y: 840, scaleX: 0.25, scaleY: 0.25 },
        },
      },
      {
        type: "addTrack",
        track: {
          id: "titles",
          name: "标题",
          kind: "visual",
          order: 0,
          locked: false,
          hidden: false,
          muted: false,
          clips: [],
        },
      },
      {
        type: "addClip",
        clip: {
          id: "title",
          trackId: "titles",
          kind: "text",
          name: "标签",
          text: "60 FPS · 预渲染测试",
          fitMode: "native",
          fontSize: 64,
          transform: { x: 960, y: 140, scaleX: 1, scaleY: 1 },
          timelineStartUs: 0,
          durationUs: 4_000_000,
        },
      },
    ];
    const seeded = await page.request.post(base + "/timeline/operations", {
      headers,
      data: {
        expectedRevision: timeline.revision,
        requestId: crypto.randomUUID(),
        operations,
      },
    });
    expect(seeded.ok(), await seeded.text()).toBeTruthy();
    await page.goto(`/apps/video-editor/projects/${project.id}/editor`);
    await expect(
      page.getByRole("button", { name: "预渲染", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "跳到开头", exact: true }).click();
    await page.getByRole("button", { name: "播放", exact: true }).click();
    const realtime = await playbackSample(page);
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await page.getByRole("button", { name: "预渲染", exact: true }).click();
    await expect(
      page.getByText("预览已就绪 · 720p", { exact: true }),
    ).toBeVisible({ timeout: 240_000 });
    const cached = (
      await (await page.request.get(base + "/preview/renders")).json()
    ).items[0];
    expect(cached.resultDetail.preset).toBe("720p60");
    const movie = await page.request.get(cached.mediaUrl);
    expect(movie.ok()).toBeTruthy();
    const previewFile = info.outputPath("rendered-preview.mp4");
    writeFileSync(previewFile, await movie.body());
    const probe = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_streams",
          "-show_format",
          "-of",
          "json",
          previewFile,
        ],
        { encoding: "utf8" },
      ),
    );
    expect(
      probe.streams.find(
        (stream: { codec_type: string }) => stream.codec_type === "video",
      ).r_frame_rate,
    ).toBe("60/1");
    expect(
      probe.streams.find(
        (stream: { codec_type: string }) => stream.codec_type === "audio",
      ).codec_name,
    ).toBe("aac");
    expect(Number(probe.format.duration)).toBeCloseTo(4, 1);
    writeFileSync(
      info.outputPath("rendered-probe.json"),
      JSON.stringify(probe, null, 2),
    );
    await page.reload();
    await expect(
      page.getByText("预览已就绪 · 720p", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "跳到开头", exact: true }).click();
    await page.getByRole("button", { name: "播放", exact: true }).click();
    const video = page.getByLabel("预渲染节目预览");
    await expect(video).toBeVisible();
    await video.evaluate((node) =>
      node.setAttribute("data-decoder", "retained"),
    );
    const rendered = await playbackSample(page);
    expect(rendered.videoCount).toBe(1);
    expect(rendered.audioCount).toBe(0);
    expect(rendered.canvasCount).toBe(0);
    expect(rendered.videos[0].width).toBe(1280);
    expect(rendered.videos[0].height).toBe(720);
    expect(rendered.videos[0].currentTime).toBeGreaterThan(0.6);
    expect(rendered.videos[0].totalFrames).toBeGreaterThan(20);
    await expect(video).toHaveAttribute("data-decoder", "retained");
    await page.screenshot({ path: info.outputPath("cached-playback.png") });
    writeFileSync(
      info.outputPath("playback-comparison.json"),
      JSON.stringify({ realtime, rendered }, null, 2),
    );
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await expect(video).toHaveCount(0);
    // A cache loading failure returns to the realtime players at the current playhead.
    await page.route(`**${base}/preview/renders/*/media`, (route) =>
      route.abort(),
    );
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await expect(
      page.getByText(/预览缓存加载失败，已切回实时预览/),
    ).toBeVisible();
    await expect(
      page.locator(".ve-stage canvas.ve-keyed-media"),
    ).not.toHaveCount(0);
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await page.getByRole("button", { name: "清理缓存", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get(base + "/preview/renders")).json())
            .items.length,
      )
      .toBe(0);
  } finally {
    const current = await (await page.request.get(base)).json();
    await page.request.delete(base, {
      headers,
      params: { expected_revision: current.revision },
    });
  }
});
