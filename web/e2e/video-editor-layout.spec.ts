import { expect, test, type Page, type Locator } from "@playwright/test";
import { execFileSync } from "node:child_process";
import type {
  VideoEditorTimeline,
  VideoEditorOperation,
} from "../src/features/video-editor/types";

async function withEditor(
  page: Page,
  run: (id: string, headers: Record<string, string>) => Promise<void>,
) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/apps/video-editor");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const created = await page.request.post("/v1/video-editor/projects", {
    headers,
    data: { title: "布局回归" },
  });
  expect(created.ok()).toBeTruthy();
  const project = await created.json();
  try {
    const timeline: VideoEditorTimeline = await (
      await page.request.get(`/v1/video-editor/projects/${project.id}/timeline`)
    ).json();
    const operations: VideoEditorOperation[] = [
      { type: "updateSettings", patch: { videoFitPolicyVersion: 1 } },
      ...Array.from({ length: 17 }, (_, index): VideoEditorOperation => ({
        type: "addTrack",
        track: {
          id: `layout-track-${index + 3}`,
          name: `测试轨 ${index + 3}`,
          kind: "visual",
          order: index + 3,
          locked: false,
          hidden: false,
          muted: false,
          clips: [],
        },
      })),
      ...[12, 14, 19].map((index): VideoEditorOperation => ({
        type: "addClip",
        clip: {
          id: `layout-clip-${index}`,
          trackId: `layout-track-${index}`,
          kind: "color",
          name: `测试片段 ${index}`,
          timelineStartUs: index === 19 ? 117_000_000 : 40_000_000,
          durationUs: 3_000_000,
          sourceInUs: 0,
          sourceLoop: false,
          color: "#5577bb",
          keyframes: [],
        },
      })),
    ];
    const updated = await page.request.post(
      `/v1/video-editor/projects/${project.id}/timeline/operations`,
      {
        headers,
        data: {
          expectedRevision: timeline.revision,
          requestId: crypto.randomUUID(),
          operations,
        },
      },
    );
    expect(updated.ok(), await updated.text()).toBeTruthy();
    await page.goto(`/apps/video-editor/projects/${project.id}/editor`);
    await expect(page.locator(".ve-track-head")).toHaveCount(20);
    await run(project.id, headers);
  } finally {
    const current = await (
      await page.request.get(`/v1/video-editor/projects/${project.id}`)
    ).json();
    const removed = await page.request.delete(
      `/v1/video-editor/projects/${project.id}?expected_revision=${current.revision}`,
      { headers },
    );
    expect(removed.ok()).toBeTruthy();
  }
}

async function dragSeparator(
  page: Page,
  separator: Locator,
  deltaX: number,
  deltaY = 0,
) {
  const rect = (await separator.boundingBox())!;
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + deltaX, y + deltaY, { steps: 8 });
  await page.mouse.up();
}

test("resizes all panels, preserves per-project preferences and resets layout", async ({
  page,
}, testInfo) => {
  await withEditor(page, async (id, headers) => {
    const revision = page.locator(".ve-editor-title small");
    const originalRevision = await revision.textContent();
    const asset = page.getByRole("separator", { name: "调整素材栏宽度" });
    const inspector = page.getByRole("separator", { name: "调整属性栏宽度" });
    const timeline = page.getByRole("separator", { name: "调整时间轴高度" });
    const head = page.getByRole("separator", { name: "调整轨道名称栏宽度" });
    await expect(page.getByRole("separator")).toHaveCount(4);
    await dragSeparator(page, asset, 100);
    await dragSeparator(page, inspector, -80);
    await dragSeparator(page, timeline, 0, -100);
    await dragSeparator(page, head, 64);
    await expect(asset).toHaveAttribute("aria-valuenow", "350");
    await expect(inspector).toHaveAttribute("aria-valuenow", "420");
    await expect(head).toHaveAttribute("aria-valuenow", "240");
    const height = await timeline.getAttribute("aria-valuenow");
    const stage = (await page.locator(".ve-stage").boundingBox())!;
    const wrap = (await page.locator(".ve-stage-wrap").boundingBox())!;
    expect(stage.height).toBeLessThanOrEqual(wrap.height);
    expect(stage.width / stage.height).toBeCloseTo(16 / 9, 2);
    await head.focus();
    await page.keyboard.press("Shift+ArrowRight");
    await expect(head).toHaveAttribute("aria-valuenow", "280");
    await page.keyboard.press("ArrowLeft");
    await expect(head).toHaveAttribute("aria-valuenow", "270");
    await expect(page.locator(".ve-timeline-tools > span")).toHaveText(
      "00:00.000",
    );
    await expect(revision).toHaveText(originalRevision!);
    await expect
      .poll(() =>
        page.evaluate(
          (key) =>
            JSON.parse(localStorage.getItem(key)!).layout.trackHeaderWidth,
          `future-props.video-editor.workspace:${id}`,
        ),
      )
      .toBe(270);
    await page.reload();
    await expect(head).toHaveAttribute("aria-valuenow", "270");
    await expect(asset).toHaveAttribute("aria-valuenow", "350");
    await expect(inspector).toHaveAttribute("aria-valuenow", "420");
    await expect(timeline).toHaveAttribute("aria-valuenow", height!);
    await page.setViewportSize({ width: 1160, height: 600 });
    expect(
      (await page.locator(".ve-preview-panel").boundingBox())!.width,
    ).toBeGreaterThanOrEqual(399);
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(asset).toHaveAttribute("aria-valuenow", "350");
    await expect(inspector).toHaveAttribute("aria-valuenow", "420");
    await expect(timeline).toHaveAttribute("aria-valuenow", height!);
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.screenshot({
        path: testInfo.outputPath(`layout-${theme}.png`),
      });
    }
    // Navigation to another real project must not inherit this layout.
    const created = await page.request.post("/v1/video-editor/projects", {
      headers,
      data: { title: "独立布局" },
    });
    const other = await created.json();
    try {
      await page.goto(`/apps/video-editor/projects/${other.id}/editor`);
      await expect(asset).toHaveAttribute("aria-valuenow", "250");
      await expect(head).toHaveAttribute("aria-valuenow", "176");
      await page.goto(`/apps/video-editor/projects/${id}/editor`);
      await expect(head).toHaveAttribute("aria-valuenow", "270");
    } finally {
      const current = await (
        await page.request.get(`/v1/video-editor/projects/${other.id}`)
      ).json();
      expect(
        (
          await page.request.delete(
            `/v1/video-editor/projects/${other.id}?expected_revision=${current.revision}`,
            { headers },
          )
        ).ok(),
      ).toBeTruthy();
    }
    await head.dblclick();
    await expect(head).toHaveAttribute("aria-valuenow", "176");
    await page.getByRole("button", { name: "重置布局" }).click();
    await expect(asset).toHaveAttribute("aria-valuenow", "250");
    await expect(inspector).toHaveAttribute("aria-valuenow", "340");
    await expect(timeline).toHaveAttribute("aria-valuenow", "278");
    await page.setViewportSize({ width: 1160, height: 400 });
    expect(
      await page
        .locator(".ve-editor-shell")
        .evaluate((node) => node.scrollHeight > node.clientHeight),
    ).toBeTruthy();
  });
});

test("scrolls track headers and clips together and keeps editing coordinates correct", async ({
  page,
}) => {
  await withEditor(page, async (id) => {
    const scroller = page.locator(".ve-tracks-scroll");
    await dragSeparator(
      page,
      page.getByRole("separator", { name: "调整时间轴高度" }),
      0,
      -160,
    );
    await dragSeparator(
      page,
      page.getByRole("separator", { name: "调整轨道名称栏宽度" }),
      64,
    );
    const viewport = (await scroller.boundingBox())!;
    await page.mouse.move(viewport.x + 50, viewport.y + 80);
    await page.mouse.wheel(0, 400);
    await expect
      .poll(() => scroller.evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    await scroller.evaluate((node) => {
      node.scrollLeft = 2960;
      node.scrollTop = 560;
    });
    await expect
      .poll(() => scroller.evaluate((node) => node.scrollTop))
      .toBe(560);
    const head = page.getByRole("group", { name: "视觉轨：测试轨 12" });
    const row = page.locator('[data-track-id="layout-track-12"]');
    const headRect = (await head.boundingBox())!;
    const rowRect = (await row.boundingBox())!;
    expect(headRect.x).toBeCloseTo(viewport.x, 0);
    expect(headRect.y).toBeCloseTo(rowRect.y, 0);
    const ruler = (await page.locator(".ve-ruler").boundingBox())!;
    expect(ruler.y).toBeCloseTo(viewport.y, 0);
    await page.mouse.click(viewport.x + 240 + 400, viewport.y + 10);
    await expect(page.locator(".ve-timeline-tools > span")).toHaveText(
      "00:42.000",
    );
    // Box selection after both axes have scrolled.
    const first = page.locator('[data-clip-id="layout-clip-12"]');
    const second = page.locator('[data-clip-id="layout-clip-14"]');
    const firstRect = (await first.boundingBox())!;
    const secondRect = (await second.boundingBox())!;
    await page.mouse.move(firstRect.x - 8, firstRect.y - 2);
    await page.mouse.down();
    await page.mouse.move(
      secondRect.x + secondRect.width + 8,
      secondRect.y + secondRect.height + 2,
      { steps: 6 },
    );
    await page.mouse.up();
    await expect(first).toHaveClass(/selected/);
    await expect(second).toHaveClass(/selected/);
    // Select a single clip, then move it vertically without changing time.
    await first.click();
    const target = page.locator('[data-track-id="layout-track-13"]');
    const targetRect = (await target.boundingBox())!;
    await page.mouse.move(firstRect.x + 30, firstRect.y + 20);
    await page.mouse.down();
    await page.mouse.move(firstRect.x + 30, targetRect.y + 25, { steps: 6 });
    await page.mouse.up();
    await expect(target.locator('[data-clip-id="layout-clip-12"]')).toHaveCount(
      1,
    );
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect(row.locator('[data-clip-id="layout-clip-12"]')).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).timelineScrollTop,
          `future-props.video-editor.workspace:${id}`,
        ),
      )
      .toBe(560);
    await page.reload();
    await expect
      .poll(() =>
        scroller.evaluate((node) => [node.scrollLeft, node.scrollTop]),
      )
      .toEqual([2960, 560]);
    // Scroll from the clip region all the way down to the last track.
    await page.mouse.move(viewport.x + 500, viewport.y + 100);
    await page.mouse.wheel(0, 2000);
    await expect
      .poll(() =>
        scroller.evaluate((node) =>
          Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop),
        ),
      )
      .toBeLessThanOrEqual(1);
    await expect
      .poll(async () => {
        const rect = (await page
          .getByRole("group", { name: "视觉轨：测试轨 19" })
          .boundingBox())!;
        const currentViewport = (await scroller.boundingBox())!;
        return (
          rect.y + rect.height <= currentViewport.y + currentViewport.height + 1
        );
      })
      .toBeTruthy();
  });
});

test("anchors timeline zoom at the playhead and persists clamped scroll offsets", async ({
  page,
}) => {
  await withEditor(page, async (id) => {
    const scroller = page.locator(".ve-tracks-scroll");
    const slider = page.getByRole("slider", { name: "时间轴缩放" });
    const playhead = page.locator(".ve-playhead");
    const time = page.locator(".ve-timeline-tools > span");
    const revision = page.locator(".ve-editor-title small");
    const originalRevision = await revision.textContent();
    await scroller.evaluate((node) => {
      node.scrollLeft = 2960;
    });
    await expect
      .poll(() => scroller.evaluate((node) => node.scrollLeft))
      .toBe(2960);
    const viewport = (await scroller.boundingBox())!;
    await page.mouse.click(viewport.x + 176 + 400, viewport.y + 10);
    await expect(time).toHaveText("00:42.000");
    const anchorX = (await playhead.boundingBox())!.x;
    for (const zoom of [120, 60, 100, 30]) {
      await slider.fill(String(zoom));
      await expect
        .poll(async () => Math.abs((await playhead.boundingBox())!.x - anchorX))
        .toBeLessThanOrEqual(1);
      await expect(time).toHaveText("00:42.000");
    }
    await slider.focus();
    await page.keyboard.press("ArrowRight");
    await expect(slider).toHaveValue("31");
    await expect
      .poll(async () => Math.abs((await playhead.boundingBox())!.x - anchorX))
      .toBeLessThanOrEqual(1);
    await expect(time).toHaveText("00:42.000");
    await expect(revision).toHaveText(originalRevision!);
    const preferenceKey = `future-props.video-editor.workspace:${id}`;
    await expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).timelineScrollLeft,
          preferenceKey,
        ),
      )
      .toBe(902);
    await page.reload();
    await expect(slider).toHaveValue("31");
    await expect(time).toHaveText("00:42.000");
    await expect
      .poll(() => scroller.evaluate((node) => node.scrollLeft))
      .toBe(902);

    // Zooming out at the left edge stops at zero instead of requesting
    // negative scroll; the playhead time still stays unchanged.
    await scroller.evaluate((node) => {
      node.scrollLeft = 0;
    });
    const ruler = (await page.locator(".ve-ruler").boundingBox())!;
    await page.mouse.click(ruler.x + 62, ruler.y + 10);
    await expect(time).toHaveText("00:02.000");
    await slider.fill("10");
    await expect
      .poll(() => scroller.evaluate((node) => node.scrollLeft))
      .toBe(0);
    await expect(time).toHaveText("00:02.000");

    // At the far edge the browser's actual scroll range wins. Persist that
    // offset and use it for the next zoom without drifting back to a stale one.
    await slider.fill("80");
    await page.getByRole("button", { name: "跳到结尾" }).click();
    await scroller.evaluate((node) => {
      node.scrollLeft = node.scrollWidth;
    });
    await slider.fill("30");
    await expect
      .poll(() =>
        scroller.evaluate((node) =>
          Math.abs(node.scrollLeft - (node.scrollWidth - node.clientWidth)),
        ),
      )
      .toBeLessThanOrEqual(1);
    const clamped = await scroller.evaluate((node) => node.scrollLeft);
    await expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)!).timelineScrollLeft,
          preferenceKey,
        ),
      )
      .toBe(clamped);
    const endAnchorX = (await playhead.boundingBox())!.x;
    await slider.fill("60");
    await expect
      .poll(async () =>
        Math.abs((await playhead.boundingBox())!.x - endAnchorX),
      )
      .toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "适配时间轴宽度" }).click();
    await expect
      .poll(() => scroller.evaluate((node) => node.scrollLeft))
      .toBe(0);
    expect(Number(await slider.inputValue())).toBeLessThanOrEqual(10);
    await expect(time).toHaveText("02:00.000");
    await expect(revision).toHaveText(originalRevision!);
  });
});

test("drops a video after scrolling and keeps playback alive during resizing", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await withEditor(page, async (id) => {
    const buffer = execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x90:r=10",
      "-t",
      "10",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "frag_keyframe+empty_moov",
      "-f",
      "mp4",
      "pipe:1",
    ]);
    await page.getByLabel("上传素材（可多选）", { exact: true }).setInputFiles({
      name: "layout-video.mp4",
      mimeType: "video/mp4",
      buffer,
    });
    const asset = page.locator(".ve-asset-wrap", { hasText: "layout-video" });
    await expect(asset.locator(".ve-asset-main")).toBeEnabled({
      timeout: 20_000,
    });
    await dragSeparator(
      page,
      page.getByRole("separator", { name: "调整时间轴高度" }),
      0,
      -160,
    );
    await dragSeparator(
      page,
      page.getByRole("separator", { name: "调整轨道名称栏宽度" }),
      64,
    );
    await page.locator(".ve-tracks-scroll").evaluate((node) => {
      node.scrollLeft = 2960;
      node.scrollTop = 560;
    });
    const target = page.locator('[data-track-id="layout-track-13"]');
    await asset.dragTo(target, { targetPosition: { x: 3520, y: 25 } });
    const clip = target.locator(".ve-clip.video");
    await expect(clip).toHaveCount(1);
    const saved: VideoEditorTimeline = await (
      await page.request.get(`/v1/video-editor/projects/${id}/timeline`)
    ).json();
    expect(
      saved.document.tracks!.find((track) => track.id === "layout-track-13")!
        .clips![0].timelineStartUs,
    ).toBeCloseTo(44_000_000, -4);
    await clip.click();
    await page.getByRole("button", { name: "播放", exact: true }).click();
    const video = page.locator(".ve-stage video");
    await expect(video).toHaveCount(1);
    await expect
      .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
      .toBeGreaterThan(0.1);
    const handle = (await video.elementHandle())!;
    const source = await video.getAttribute("src");
    const time = await video.evaluate(
      (node: HTMLVideoElement) => node.currentTime,
    );
    const revision = await page.locator(".ve-editor-title small").textContent();
    await dragSeparator(
      page,
      page.getByRole("separator", { name: "调整素材栏宽度" }),
      100,
    );
    await dragSeparator(
      page,
      page.getByRole("separator", { name: "调整属性栏宽度" }),
      -60,
    );
    await dragSeparator(
      page,
      page.getByRole("separator", { name: "调整时间轴高度" }),
      0,
      90,
    );
    expect(await handle.evaluate((node) => node.isConnected)).toBeTruthy();
    expect(await video.getAttribute("src")).toBe(source);
    await expect
      .poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
      .toBeGreaterThan(time);
    await expect(
      page.getByRole("button", { name: "暂停", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".ve-editor-title small")).toHaveText(revision!);
    await page.getByRole("button", { name: "暂停", exact: true }).click();
  });
});
