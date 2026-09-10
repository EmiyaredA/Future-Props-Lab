import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { clipTrimPreview } from "@features/video-editor/clipTrim";
import { operationsForAsset } from "@features/video-editor/editorModel";
import { clipPlacementError } from "@features/video-editor/timelineSnap";
import { VideoEditorTimeline } from "@features/video-editor/VideoEditorTimeline";
import type {
  VideoEditorClip,
  VideoEditorTrack,
  VideoEditorAsset,
} from "@features/video-editor/types";

const clip: VideoEditorClip = {
  id: "image",
  trackId: "v",
  kind: "image",
  assetId: "asset",
  name: "结尾",
  timelineStartUs: 2_000_000,
  durationUs: 5_000_000,
  sourceInUs: 0,
  playbackRate: 1,
  fitMode: "cover",
  flipX: false,
  fontSize: 72,
  sourceLoop: false,
  textColor: "#ffffff",
  volume: 1,
};
const track: VideoEditorTrack = {
  id: "v",
  kind: "mixed",
  name: "混合",
  order: 0,
  locked: false,
  muted: false,
  hidden: false,
  clips: [clip],
};
const asset: VideoEditorAsset = {
  id: "asset",
  displayName: "结尾",
  originalFilename: "image.png",
  mediaKind: "image",
  mimeType: "image/png",
  byteSize: 100,
  processingStatus: "ready",
  createdAt: "now",
};
const options = {
  clip,
  edge: "end" as const,
  candidateUs: 10_000_000,
  tracks: [track],
  assets: [asset],
  fps: 30,
  zoom: 80,
  seconds: 30,
  snapEnabled: true,
};
function pointer(type: string, target: Element | Window, x: number) {
  fireEvent(
    target,
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: x,
    }),
  );
}

describe("clip edge trimming", () => {
  it("extends images freely and clamps start, duration and exact neighboring seams", () => {
    expect(clipTrimPreview(options).states![0].durationUs).toBeGreaterThan(
      7_000_000,
    );
    const next = { ...clip, id: "next", timelineStartUs: 9_234_567 };
    const result = clipTrimPreview({
      ...options,
      candidateUs: 9_250_000,
      tracks: [{ ...track, clips: [clip, next] }],
    });
    expect(result.states![0].durationUs).toBe(7_234_567);
    expect(result.guideUs).toBe(9_234_567);
    const clamped = clipTrimPreview({
      ...options,
      tracks: [{ ...track, clips: [clip, next] }],
    });
    expect(clamped.states![0].durationUs).toBe(7_234_567);
    expect(clamped.guideUs).toBeUndefined();
    expect(
      clipTrimPreview({ ...options, edge: "start", candidateUs: -1_000_000 })
        .states![0],
    ).toMatchObject({
      timelineStartUs: 0,
      durationUs: 7_000_000,
      sourceInUs: 0,
    });
    expect(
      clipTrimPreview({ ...options, candidateUs: 0 }).states![0].durationUs,
    ).toBe(33_333);
  });
  it("bounds sped-up source ranges and trims linked audio while leaving music alone", () => {
    const video = {
      ...clip,
      kind: "video" as const,
      playbackRate: 2,
      sourceInUs: 2_000_000,
      linkGroupId: "av",
    };
    const audio = {
      ...video,
      id: "sound",
      trackId: "a",
      kind: "audio" as const,
    };
    const tracks = [
      { ...track, kind: "visual" as const, clips: [video] },
      {
        ...track,
        id: "a",
        kind: "audio" as const,
        clips: [audio, { ...audio, id: "music", linkGroupId: undefined }],
      },
    ];
    const opts = {
      ...options,
      clip: video,
      tracks,
      assets: [
        { ...asset, mediaKind: "video", probe: { durationUs: 14_000_000 } },
      ],
    };
    const right = clipTrimPreview(opts);
    expect(right.states).toHaveLength(2);
    expect(right.states!.map((item) => item.durationUs)).toEqual([
      6_000_000, 6_000_000,
    ]);
    const left = clipTrimPreview({ ...opts, edge: "start", candidateUs: 0 });
    expect(
      left.states!.map((item) => [
        item.timelineStartUs,
        item.durationUs,
        item.sourceInUs,
      ]),
    ).toEqual([
      [1_000_000, 6_000_000, 0],
      [1_000_000, 6_000_000, 0],
    ]);
    expect(
      clipTrimPreview({
        ...opts,
        tracks: [tracks[0], { ...tracks[1], locked: true }],
      }).error,
    ).toContain("锁定");
    expect(clipTrimPreview({ ...opts, assets: [] }).states![0].durationUs).toBe(
      video.durationUs,
    );
  });
  it("allows images on mixed tracks and rejects audio targets", () => {
    expect(operationsForAsset(asset, [track], 0, track.id)[0]).toMatchObject({
      type: "addClip",
      clip: { kind: "image", trackId: "v", durationUs: 5_000_000 },
    });
    expect(
      clipPlacementError(clip, 0, "v", [track], new Set([clip.id])),
    ).toBeUndefined();
    expect(
      clipPlacementError(
        clip,
        0,
        "a",
        [{ ...track, id: "a", kind: "audio" }],
        new Set([clip.id]),
      ),
    ).toContain("只接收音频");
    expect(
      clipPlacementError(
        clip,
        0,
        "visual",
        [track, { ...track, id: "visual", kind: "visual", clips: [] }],
        new Set([clip.id]),
      ),
    ).toBeUndefined();
  });
  function setup() {
    const commit = vi.fn(async () => undefined);
    const view = render(
      <VideoEditorTimeline
        timeline={{
          projectId: "p",
          revision: 0,
          updatedAt: "now",
          document: { schemaVersion: "1.0", tracks: [track] },
        }}
        assets={[asset]}
        playheadUs={0}
        setPlayheadUs={vi.fn()}
        zoom={80}
        scrollLeft={0}
        onScrollLeftChange={vi.fn()}
        selectedClipIds={[clip.id]}
        selectClip={vi.fn()}
        commit={commit}
        onDropAsset={vi.fn()}
      />,
    );
    return { ...view, commit };
  }
  it("previews a resize, commits one undo snapshot, and permits keyboard adjustment", async () => {
    const view = setup();
    const handle = screen.getByRole("slider", { name: "结尾：调整结束边缘" });
    pointer("pointerdown", handle, 560);
    pointer("pointermove", window, 640);
    expect(view.container.querySelector(".ve-clip small")).toHaveTextContent(
      "6.00s",
    );
    pointer("pointerup", window, 640);
    await waitFor(() => expect(view.commit).toHaveBeenCalledOnce());
    expect(view.commit.mock.calls[0]).toEqual([
      [expect.objectContaining({ type: "trimClip", durationUs: 5_999_920 })],
      [{ type: "restoreClipStates", clips: [clip] }],
    ]);
    await waitFor(() =>
      expect(view.container.querySelector(".ve-clip small")).toHaveTextContent(
        "5.00s",
      ),
    );
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    await waitFor(() => expect(view.commit).toHaveBeenCalledTimes(2));
  });
  it.each(["escape", "pointercancel", "blur"])(
    "cancels %s without saving",
    (reason) => {
      const view = setup();
      pointer(
        "pointerdown",
        screen.getByRole("slider", { name: "结尾：调整开始边缘" }),
        160,
      );
      pointer("pointermove", window, 80);
      if (reason === "escape")
        fireEvent.keyDown(
          screen.getByRole("slider", { name: "结尾：调整开始边缘" }),
          { key: "Escape" },
        );
      else fireEvent(window, new Event(reason));
      pointer("pointerup", window, 80);
      expect(view.commit).not.toHaveBeenCalled();
      expect(view.container.querySelector(".ve-clip small")).toHaveTextContent(
        "5.00s",
      );
    },
  );
});
