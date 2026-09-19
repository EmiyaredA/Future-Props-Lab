import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ClipSpeedControl } from "@features/video-editor/ClipSpeedControl";
import { VideoEditorTimeline } from "@features/video-editor/VideoEditorTimeline";
import { snapClipPosition } from "@features/video-editor/timelineSnap";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorTrack,
} from "@features/video-editor/types";

function dragEvent(
  type: string,
  target: Element | Window,
  values: Record<string, unknown> = {},
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, values);
  fireEvent(target, event);
}

const clip: VideoEditorClip = {
  id: "selected",
  name: "片段 A",
  kind: "video",
  assetId: "asset",
  trackId: "mixed",
  timelineStartUs: 0,
  durationUs: 1_234_567,
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
  id: "mixed",
  name: "混合",
  kind: "mixed",
  order: 0,
  locked: false,
  hidden: false,
  muted: false,
  clips: [clip],
};
const asset: VideoEditorAsset = {
  id: "asset",
  displayName: "新素材",
  originalFilename: "clip.mp4",
  mediaKind: "video",
  mimeType: "video/mp4",
  byteSize: 12,
  processingStatus: "ready",
  createdAt: "2026-09-10T00:00:00Z",
  probe: { durationUs: 500_001 },
};

describe("speed ripple control", () => {
  it("submits one atomic undo for long sequences and excludes unrelated tracks", async () => {
    const commit = vi.fn(async () => undefined);
    const following = Array.from({ length: 250 }, (_, index) => ({
      ...clip,
      id: `next-${index}`,
      timelineStartUs: clip.durationUs + index * clip.durationUs,
      linkGroupId: `link-${index}`,
    }));
    const linked = {
      ...following[0],
      id: "sound",
      kind: "audio" as const,
      trackId: "audio",
    };
    const unrelated = { ...linked, id: "music", linkGroupId: undefined };
    const all = [clip, ...following, linked, unrelated];
    render(<ClipSpeedControl clip={clip} clips={all} commit={commit} />);
    expect(screen.getByRole("switch", { name: "后续片段跟随" })).toBeChecked();
    fireEvent.change(screen.getByLabelText("播放速度倍率"), {
      target: { value: "2" },
    });
    fireEvent.keyDown(screen.getByLabelText("播放速度倍率"), { key: "Enter" });
    await waitFor(() => expect(commit).toHaveBeenCalledOnce());
    expect(commit).toHaveBeenCalledWith(
      [
        {
          type: "setClipSpeed",
          clipId: clip.id,
          playbackRate: 2,
          ripple: true,
        },
      ],
      [
        {
          type: "restoreClipStates",
          clips: all.filter((item) => item.id !== "music"),
        },
      ],
    );
  });

  it("lets the user disable follow and reports failed saves without losing the setting", async () => {
    const commit = vi.fn(async () => {
      throw new Error("后续片段的轨道已锁定");
    });
    function Control() {
      const [ripple, setRipple] = useState(true);
      return (
        <ClipSpeedControl
          clip={clip}
          clips={[clip]}
          ripple={ripple}
          onRippleChange={setRipple}
          commit={commit}
        />
      );
    }
    render(<Control />);
    fireEvent.click(screen.getByRole("switch", { name: "后续片段跟随" }));
    fireEvent.change(screen.getByLabelText("播放速度倍率"), {
      target: { value: "0.5" },
    });
    fireEvent.click(screen.getByRole("button", { name: "应用" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("轨道已锁定");
    expect(screen.getByRole("switch")).not.toBeChecked();
    expect(commit).toHaveBeenCalledWith(
      [
        {
          type: "setClipSpeed",
          clipId: clip.id,
          playbackRate: 0.5,
          ripple: false,
        },
      ],
      [{ type: "restoreClipStates", clips: [clip] }],
    );
  });
});

describe("exact seam feedback", () => {
  it.each([30, 60])(
    "reports the matched edge, not the moving start, at %i fps",
    (fps) => {
      const options = {
        candidateUs: 3_520_000,
        durationUs: 500_001,
        targetTrackId: track.id,
        tracks: [
          { ...track, clips: [{ ...clip, timelineStartUs: 4_000_003 }] },
        ],
        movingClipIds: new Set<string>(),
        fps,
        zoom: 80,
        timelineEndUs: 30_000_000,
        enabled: true,
      };
      expect(snapClipPosition(options)).toEqual({
        startUs: 3_500_002,
        guideUs: 4_000_003,
      });
      expect(
        snapClipPosition({ ...options, enabled: false }).guideUs,
      ).toBeUndefined();
      expect(
        snapClipPosition({ ...options, candidateUs: 2_500_000 }).guideUs,
      ).toBeUndefined();
      expect(
        snapClipPosition({ ...options, movingClipIds: new Set([clip.id]) })
          .guideUs,
      ).toBeUndefined();
      expect(
        snapClipPosition({
          ...options,
          candidateUs: 0,
          minimumStartUs: 700_003,
        }).startUs,
      ).toBe(700_003);
    },
  );

  it("snaps a moving clip to an edge on another track", () => {
    const otherTrack: VideoEditorTrack = {
      id: "visual",
      name: "视觉",
      kind: "visual",
      order: 1,
      locked: false,
      hidden: false,
      muted: false,
      clips: [
        {
          ...clip,
          id: "anchor",
          trackId: "visual",
          timelineStartUs: 4_000_003,
          durationUs: 2_000_000,
        },
      ],
    };
    expect(
      snapClipPosition({
        candidateUs: 3_520_000,
        durationUs: 500_001,
        targetTrackId: track.id,
        tracks: [{ ...track, clips: [] }, otherTrack],
        movingClipIds: new Set<string>(),
        fps: 30,
        zoom: 80,
        timelineEndUs: 30_000_000,
        enabled: true,
      }),
    ).toEqual({
      startUs: 3_500_002,
      guideUs: 4_000_003,
    });
  });

  function setup({
    zoom = 80,
    fps = 30,
    locked = false,
    enabled = true,
    kind = "mixed" as VideoEditorTrack["kind"],
  } = {}) {
    const drop = vi.fn();
    const notice = vi.fn();
    const props = {
      timeline: {
        projectId: "test",
        revision: 0,
        updatedAt: "now",
        document: {
          schemaVersion: "1.0" as const,
          settings: {
            fps: fps as 30 | 60,
            width: 1920 as const,
            height: 1080 as const,
            backgroundColor: "#000000",
          },
          tracks: [{ ...track, locked, kind }],
        },
      },
      assets: [asset],
      draggingAsset: asset,
      playheadUs: 0,
      setPlayheadUs: vi.fn(),
      zoom,
      scrollLeft: 200,
      onScrollLeftChange: vi.fn(),
      selectedClipIds: [],
      selectClip: vi.fn(),
      commit: vi.fn(async () => undefined),
      onDropAsset: drop,
      onNotice: notice,
      snapEnabled: enabled,
    };
    const view = render(<VideoEditorTimeline {...props} />);
    const row = view.container.querySelector(".ve-track-row")!;
    // Timeline canvas may be offset by horizontal scrolling.
    const canvas = view.container.querySelector(".ve-track-canvas")!;
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      left: -200,
    } as DOMRect);
    const transfer = { getData: () => asset.id, dropEffect: "copy" };
    const clientX = -200 + (clip.durationUs / 1_000_000) * zoom + 2;
    return { ...view, row, transfer, clientX, drop, notice, props };
  }

  it.each([
    [30, 20],
    [30, 240],
    [60, 80],
  ])(
    "snaps new assets without a second rounding at %i fps / %i zoom",
    (fps, zoom) => {
      const view = setup({ fps, zoom });
      dragEvent("dragover", view.row, {
        clientX: view.clientX,
        dataTransfer: view.transfer,
      });
      expect(view.container.querySelector(".ve-snap-guide")).toHaveStyle({
        left: `${(clip.durationUs / 1_000_000) * zoom}px`,
      });
      dragEvent("drop", view.row, {
        clientX: view.clientX,
        dataTransfer: view.transfer,
      });
      expect(view.drop).toHaveBeenCalledWith(asset, track.id, clip.durationUs);
      expect(view.container.querySelector(".ve-snap-guide")).toBeNull();
    },
  );

  it.each([{ locked: true }, { kind: "audio" as const }])(
    "rejects unavailable target tracks %j",
    (options) => {
      const view = setup(options);
      dragEvent("dragover", view.row, {
        clientX: view.clientX,
        dataTransfer: view.transfer,
      });
      expect(view.transfer.dropEffect).toBe("none");
      dragEvent("drop", view.row, {
        clientX: view.clientX,
        dataTransfer: view.transfer,
      });
      expect(view.drop).not.toHaveBeenCalled();
      expect(view.notice).toHaveBeenCalledOnce();
    },
  );

  it("aligns a new asset's right edge and places the guide at that seam", () => {
    const view = setup();
    const future = { ...clip, timelineStartUs: 4_000_003 };
    view.rerender(
      <VideoEditorTimeline
        {...view.props}
        timeline={{
          ...view.props.timeline,
          document: {
            ...view.props.timeline.document,
            tracks: [{ ...track, clips: [future] }],
          },
        }}
      />,
    );
    const clientX = -200 + (3_500_002 / 1_000_000) * 80 + 2;
    dragEvent("dragover", view.row, { clientX, dataTransfer: view.transfer });
    expect(view.container.querySelector(".ve-snap-guide")).toHaveStyle({
      left: `${(4_000_003 / 1_000_000) * 80}px`,
    });
    dragEvent("drop", view.row, { clientX, dataTransfer: view.transfer });
    expect(view.drop).toHaveBeenCalledWith(asset, track.id, 3_500_002);
  });

  it("does not display seam feedback when snapping is disabled", () => {
    const view = setup({ enabled: false });
    dragEvent("dragover", view.row, {
      clientX: view.clientX,
      dataTransfer: view.transfer,
    });
    expect(view.container.querySelector(".ve-snap-guide")).toBeNull();
    dragEvent("drop", view.row, {
      clientX: view.clientX,
      dataTransfer: view.transfer,
    });
    expect(view.drop).toHaveBeenCalledWith(asset, track.id, 1_266_654);
  });

  it("accepts preparing media with a duration and explains drops before duration is known", () => {
    const view = setup();
    const preparing = { ...asset, processingStatus: "processing" };
    view.rerender(
      <VideoEditorTimeline
        {...view.props}
        assets={[preparing]}
        draggingAsset={preparing}
      />,
    );
    dragEvent("drop", view.row, {
      clientX: view.clientX,
      dataTransfer: view.transfer,
    });
    expect(view.drop).toHaveBeenCalledWith(
      preparing,
      track.id,
      clip.durationUs,
    );
    view.drop.mockClear();
    const detecting = { ...preparing, probe: {} };
    view.rerender(
      <VideoEditorTimeline
        {...view.props}
        assets={[detecting]}
        draggingAsset={detecting}
      />,
    );
    dragEvent("drop", view.row, {
      clientX: view.clientX,
      dataTransfer: view.transfer,
    });
    expect(view.drop).not.toHaveBeenCalled();
    expect(view.notice).toHaveBeenCalledWith(
      expect.stringContaining("正在读取时长"),
    );
  });

  it("clears guides on leave/cancel and rejects overlapping drops", () => {
    const view = setup();
    const drag = () =>
      dragEvent("dragover", view.row, {
        clientX: view.clientX,
        dataTransfer: view.transfer,
      });
    drag();
    dragEvent("dragleave", view.row);
    expect(view.container.querySelector(".ve-snap-guide")).toBeNull();
    drag();
    dragEvent("dragend", window);
    expect(view.container.querySelector(".ve-snap-guide")).toBeNull();
    dragEvent("drop", view.row, { clientX: -160, dataTransfer: view.transfer });
    expect(view.drop).not.toHaveBeenCalled();
    expect(view.notice).toHaveBeenCalledOnce();
  });
});
