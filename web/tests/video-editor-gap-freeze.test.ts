import { zipSync } from "fflate";
import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  freezeGapTemplate,
  freezeSourcePositionMs,
  planFreezeGaps,
  prepareGapFreezes,
} from "@features/video-editor/gapFreeze";
import { findTimelineGaps } from "@features/video-editor/timelineGaps";
import { fetchApiBlob } from "@platform/api/client";
import {
  listVideoEditorAssets,
  uploadVideoEditorAsset,
} from "@features/video-editor/api";
import {
  gapAsset,
  gapClip,
  gapTimeline,
  gapTrack,
} from "./helpers/video-editor-gaps";

vi.mock("@platform/api/client", () => ({ fetchApiBlob: vi.fn() }));
vi.mock("@features/video-editor/api", () => ({
  listVideoEditorAssets: vi.fn(),
  uploadVideoEditorAsset: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());
describe("explicit gap freezes", () => {
  it("fixes the last transform, preserves effects and disconnects audio and animation", () => {
    const state = gapTimeline();
    const left = state.document.tracks![0].clips![0];
    left.linkGroupId = "av";
    left.keyframes = [
      {
        id: "key",
        property: "x",
        timeUs: 0,
        value: 40,
        interpolation: "linear",
      },
    ];
    left.flipX = true;
    left.name = "长".repeat(255);
    const picture = freezeGapTemplate(left, findTimelineGaps(state)[0]);
    expect(picture).toMatchObject({
      kind: "image",
      timelineStartUs: 1_000_003,
      durationUs: 49_707,
      transform: { x: 40 },
      flipX: true,
      keyframes: [],
      volume: 0,
      linkGroupId: null,
      playbackRate: 1,
      sourceInUs: 0,
      transitionOut: null,
    });
    expect(left.keyframes).toHaveLength(1);
    expect(picture.name.length).toBeLessThanOrEqual(255);
    expect(picture.name).toContain("空隙修复定帧");
  });
  it("extracts a safe source frame accounting for rate, in-point and source FPS", () => {
    const state = gapTimeline();
    const left = state.document.tracks![0].clips![0];
    left.playbackRate = 2;
    const asset = gapAsset({
      probe: {
        durationUs: 4_000_000,
        streams: [{ codec_type: "video", avg_frame_rate: "60/1" }],
      },
    });
    expect(freezeSourcePositionMs(left, asset)).toBe(1983);
    left.sourceLoop = true;
    left.durationUs = 4_000_000;
    expect(freezeSourcePositionMs(left, asset)).toBe(0);
    left.sourceInUs = 1_000_000;
    left.durationUs = 4_750_000;
    expect(freezeSourcePositionMs(left, asset)).toBe(2483);
    expect(
      freezeSourcePositionMs(
        left,
        gapAsset({ probe: { durationUs: 4_000_000, streams: "unknown" } }),
      ),
    ).toBe(2466);
  });
  it("prepares a PNG asset before one atomic add/remove edit", async () => {
    const state = gapTimeline();
    const selected = [findTimelineGaps(state)[0]];
    const archive = zipSync({ "last.png": new Uint8Array([1, 2, 3]) });
    vi.mocked(fetchApiBlob).mockResolvedValue(
      new NodeBlob([new Uint8Array(archive)]) as unknown as Blob,
    );
    vi.mocked(uploadVideoEditorAsset).mockResolvedValue(
      gapAsset({ id: "freeze" }),
    );
    vi.mocked(listVideoEditorAssets).mockResolvedValue({
      items: [gapAsset({ id: "freeze" })],
    });
    const edit = await prepareGapFreezes(
      state,
      [gapAsset()],
      selected,
      new AbortController().signal,
      () => true,
    );
    expect(fetchApiBlob).toHaveBeenCalledWith(
      "/v1/files/media/frames",
      expect.objectContaining({ method: "POST" }),
    );
    expect(uploadVideoEditorAsset).toHaveBeenCalledOnce();
    expect(edit.redo).toMatchObject([
      { type: "addClip", clip: { assetId: "freeze", durationUs: 49_707 } },
    ]);
    expect(edit.undo).toMatchObject([{ type: "removeClip" }]);
  });
  it("stops before uploading if metadata changes during extraction", async () => {
    const state = gapTimeline();
    let current = true;
    vi.mocked(fetchApiBlob).mockImplementation(async () => {
      current = false;
      return new Blob();
    });
    await expect(
      prepareGapFreezes(
        state,
        [gapAsset()],
        [findTimelineGaps(state)[0]],
        new AbortController().signal,
        () => current,
      ),
    ).rejects.toThrow("已变化");
    expect(uploadVideoEditorAsset).not.toHaveBeenCalled();
  });
  it("returns no timeline edits after extraction or image preparation failure/cancellation", async () => {
    const state = gapTimeline();
    const selected = [findTimelineGaps(state)[0]];
    vi.mocked(fetchApiBlob).mockRejectedValue(new Error("decoder failed"));
    await expect(
      prepareGapFreezes(
        state,
        [gapAsset()],
        selected,
        new AbortController().signal,
        () => true,
      ),
    ).rejects.toThrow("decoder failed");
    vi.mocked(fetchApiBlob).mockResolvedValue(
      new NodeBlob([
        new Uint8Array(zipSync({ "last.png": new Uint8Array([1]) })),
      ]) as unknown as Blob,
    );
    vi.mocked(uploadVideoEditorAsset).mockResolvedValue(
      gapAsset({ id: "freeze" }),
    );
    vi.mocked(listVideoEditorAssets).mockResolvedValue({
      items: [gapAsset({ id: "freeze", processingStatus: "failed" })],
    });
    await expect(
      prepareGapFreezes(
        state,
        [gapAsset()],
        selected,
        new AbortController().signal,
        () => true,
      ),
    ).rejects.toThrow("时间线未修改");
    const controller = new AbortController();
    controller.abort();
    await expect(
      prepareGapFreezes(
        state,
        [gapAsset()],
        selected,
        controller.signal,
        () => true,
      ),
    ).rejects.toThrow();
    expect(state.revision).toBe(4);
  });
  it("rejects locked, unknown, overlapping and >200 freeze selections", () => {
    const many = gapTimeline([
      gapTrack(
        "v",
        Array.from({ length: 202 }, (_, index) =>
          gapClip(`color-${index}`, index * 1_000_004, { kind: "color" }),
        ),
      ),
    ]);
    expect(
      planFreezeGaps(many, [], findTimelineGaps(many)).issues.join(),
    ).toContain("最多处理 200");
    const state = gapTimeline();
    const gaps = findTimelineGaps(state);
    state.document.tracks![0].locked = true;
    expect(
      planFreezeGaps(state, [gapAsset({ probe: {} })], gaps).issues.join(),
    ).toMatch(/锁定.*长度未知/);
    state.document.tracks![0].locked = false;
    state.document.tracks![0].clips!.push({
      ...state.document.tracks![0].clips![0],
      id: "text",
      kind: "text",
      timelineStartUs: gaps[0].startUs,
      durationUs: 3,
    });
    expect(planFreezeGaps(state, [gapAsset()], gaps).issues.join()).toContain(
      "重叠",
    );
  });
});
