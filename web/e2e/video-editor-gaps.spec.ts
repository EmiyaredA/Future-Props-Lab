import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type {
  VideoEditorClip,
  VideoEditorTimeline,
} from "../src/features/video-editor/types";

test("inspects precise gaps, filters batches and freezes source frames with undo across responsive layouts", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto("/apps/video-editor");
  const csrf = (await page.context().cookies()).find(
    (cookie) => cookie.name === "fpl_csrf",
  )!.value;
  const headers = { "X-CSRF-Token": csrf, Origin: new URL(page.url()).origin };
  const project = await (
    await page.request.post("/v1/video-editor/projects", {
      headers,
      data: { title: "空隙隔离验收" },
    })
  ).json();
  const base = `/v1/video-editor/projects/${project.id}`;
  const timeline = async (): Promise<VideoEditorTimeline> =>
    (await page.request.get(`${base}/timeline`)).json();
  const clips = (state: VideoEditorTimeline) =>
    state.document.tracks!.flatMap((track) => track.clips ?? []);
  const open = async () => {
    await page.getByRole("button", { name: "检查空隙", exact: true }).click();
    return page.getByRole("dialog", { name: "空隙检查" });
  };
  const choose = async (label: string, option: string) => {
    await page.getByRole("combobox", { name: label }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  try {
    await page.goto(`/apps/video-editor/projects/${project.id}/editor`);
    const source = testInfo.outputPath("red-source.mp4");
    execFileSync("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=64x64:r=30",
      "-t",
      "4",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-y",
      source,
    ]);
    await page.getByLabel("上传素材（可多选）").setInputFiles({
      name: "红色源.mp4",
      mimeType: "video/mp4",
      buffer: readFileSync(source),
    });
    await expect
      .poll(
        async () =>
          (await (await page.request.get(`${base}/assets`)).json()).items[0]
            ?.processingStatus,
      )
      .toBe("ready");
    const asset = (await (await page.request.get(`${base}/assets`)).json())
      .items[0];
    const before = await timeline();
    const picture: VideoEditorClip = {
      id: "left",
      trackId: "visual-1",
      name: "左片段",
      kind: "video",
      assetId: asset.id,
      timelineStartUs: 0,
      durationUs: 1_000_003,
      sourceInUs: 0,
      sourceLoop: false,
      playbackRate: 1,
      fitMode: "cover",
      flipX: false,
      fontSize: 72,
      textColor: "#ffffff",
      volume: 0,
    };
    const seeded = await page.request.post(`${base}/timeline/operations`, {
      headers,
      data: {
        expectedRevision: before.revision,
        requestId: crypto.randomUUID(),
        operations: [
          { type: "addClip", clip: picture },
          {
            type: "addClip",
            clip: {
              ...picture,
              id: "middle",
              name: "中片段",
              timelineStartUs: 1_049_710,
            },
          },
          {
            type: "addClip",
            clip: {
              ...picture,
              id: "right",
              name: "右片段",
              timelineStartUs: 2_449_713,
            },
          },
          {
            type: "addClip",
            clip: {
              ...picture,
              id: "overlay",
              trackId: "mixed-1",
              name: "另一轨画面",
              durationUs: 4_000_000,
            },
          },
        ],
      },
    });
    expect(seeded.ok(), await seeded.text()).toBeTruthy();
    const original = clips(await timeline());
    await page.reload();
    let panel = await open();
    await expect(panel.getByRole("checkbox")).toHaveCount(2);
    await expect(panel.getByText("49.707 毫秒 · 约 1.49 帧")).toBeVisible();
    await panel.getByRole("button", { name: "定位空隙 00:01.000003" }).click();
    await expect(page.locator(".ve-timeline-tools > span")).toHaveText(
      "00:01.000",
    );
    for (const width of [390, 768, 1600]) {
      await page.setViewportSize({ width, height: width === 390 ? 700 : 1000 });
      for (const theme of ["light", "dark"]) {
        await page.evaluate((value) => {
          document.documentElement.dataset.theme = value;
        }, theme);
        await panel
          .getByRole("button", { name: "处理全部显示项" })
          .scrollIntoViewIfNeeded();
        expect(
          await panel.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await panel.screenshot({
          path: testInfo.outputPath(`gaps-${width}-${theme}.png`),
        });
      }
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
    await choose("空隙时长筛选", "短空隙 ≤100 毫秒");
    await panel.getByRole("button", { name: "处理全部显示项" }).click();
    await expect
      .poll(
        async () =>
          clips(await timeline()).find((clip) => clip.id === "left")!
            .durationUs,
      )
      .toBe(1_049_710);
    expect(
      clips(await timeline()).filter((clip) => clip.id !== "left"),
    ).toEqual(original.filter((clip) => clip.id !== "left"));
    await panel.getByRole("button", { name: "关闭空隙检查" }).click();
    await expect(
      page.getByRole("button", { name: "检查空隙", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect.poll(async () => clips(await timeline())).toEqual(original);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect
      .poll(
        async () =>
          clips(await timeline()).find((clip) => clip.id === "left")!
            .durationUs,
      )
      .toBe(1_049_710);
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect.poll(async () => clips(await timeline())).toEqual(original);

    panel = await open();
    await choose("空隙时长筛选", "短空隙 ≤100 毫秒");
    await choose("空隙处理方式", "前移后续片段，闭合空隙");
    await panel.getByRole("checkbox").check();
    await panel.getByRole("button", { name: "处理选中" }).click();
    await expect
      .poll(
        async () =>
          clips(await timeline()).find((clip) => clip.id === "middle")!
            .timelineStartUs,
      )
      .toBe(1_000_003);
    expect(
      clips(await timeline()).find((clip) => clip.id === "right")!
        .timelineStartUs,
    ).toBe(2_400_006);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect.poll(async () => clips(await timeline())).toEqual(original);

    panel = await open();
    await choose("空隙时长筛选", "短空隙 ≤100 毫秒");
    await choose("空隙处理方式", "定帧填补空隙，保持后续时序");
    await panel.getByRole("button", { name: "处理全部显示项" }).click();
    await expect
      .poll(async () => clips(await timeline()).length, { timeout: 30_000 })
      .toBe(5);
    const repaired = clips(await timeline());
    const frozen = repaired.find((clip) => clip.name.includes("空隙修复定帧"))!;
    expect(frozen).toMatchObject({
      kind: "image",
      timelineStartUs: 1_000_003,
      durationUs: 49_707,
      volume: 0,
      linkGroupId: null,
    });
    expect(repaired.filter((clip) => clip.id !== frozen.id)).toEqual(original);
    const png = await page.request.get(`/v1/files/${frozen.assetId}/content`);
    expect(png.ok()).toBeTruthy();
    expect((await png.body()).subarray(1, 4).toString()).toBe("PNG");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "撤销", exact: true }).click();
    await expect.poll(async () => clips(await timeline())).toEqual(original);
    await page.getByRole("button", { name: "重做", exact: true }).click();
    await expect.poll(async () => clips(await timeline())).toEqual(repaired);
    await page.reload();
    panel = await open();
    await expect(panel.getByRole("checkbox")).toHaveCount(1);

    // An actual CAS conflict leaves the entire proposed extension unapplied.
    const committed = await timeline();
    const concurrent = await page.request.post(`${base}/timeline/operations`, {
      headers,
      data: {
        expectedRevision: committed.revision,
        requestId: crypto.randomUUID(),
        operations: [
          { type: "updateSettings", patch: { backgroundColor: "#111111" } },
        ],
      },
    });
    expect(concurrent.ok()).toBeTruthy();
    const server = await timeline();
    await panel.getByRole("button", { name: "处理全部显示项" }).click();
    await expect(
      page.getByRole("button", { name: /查看未保存操作/ }),
    ).toBeVisible();
    expect((await timeline()).document).toEqual(server.document);
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
