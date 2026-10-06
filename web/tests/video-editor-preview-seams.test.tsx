import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoEditorPreview } from "@features/video-editor/VideoEditorPreview";
import { VideoEditorPreciseFrame } from "@features/video-editor/VideoEditorPreciseFrame";
import { previewVideoPlaybackKeys } from "@features/video-editor/previewPlayback";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorTimeline,
} from "@features/video-editor/types";

const left: VideoEditorClip = {
  id: "left",
  trackId: "mixed",
  kind: "video",
  name: "第三段",
  assetId: "source",
  timelineStartUs: 13_224_941,
  durationUs: 2_974_897,
  sourceInUs: 716_513,
  sourceLoop: false,
  fitMode: "cover",
  flipX: false,
  fontSize: 72,
  textColor: "#ffffff",
  volume: 1,
  keyframes: [],
};
const right: VideoEditorClip = {
  ...left,
  id: "right",
  timelineStartUs: 16_199_838,
  durationUs: 933_324,
  sourceInUs: 3_691_410,
};
const timeline: VideoEditorTimeline = {
  projectId: "project",
  revision: 1194,
  updatedAt: "2026-10-07T00:00:00Z",
  document: {
    schemaVersion: "1.0",
    settings: {
      width: 1920,
      height: 1080,
      fps: 30,
      backgroundColor: "#000000",
    },
    tracks: [
      {
        id: "mixed",
        kind: "mixed",
        name: "混合 1",
        order: 0,
        locked: false,
        hidden: false,
        muted: true,
        clips: [left, right],
      },
    ],
  },
};
const assets: VideoEditorAsset[] = [
  {
    id: "source",
    revision: 0,
    displayName: "视频",
    originalFilename: "video.mp4",
    mediaKind: "video",
    mimeType: "video/mp4",
    byteSize: 100,
    processingStatus: "ready",
    proxyUrl: "/proxy.mp4",
    probe: { width: 1920, height: 1080 },
    createdAt: "2026-10-07T00:00:00Z",
  },
];
const props = {
  projectId: "project",
  timeline,
  assets,
  setPlayheadUs: vi.fn(),
  playing: false,
  setPlaying: vi.fn(),
  preciseFrame: true,
  onPreciseFrameChange: vi.fn(),
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
});

describe("video editor seam preview", () => {
  it("keeps the decoded program frame visible while the next request loads", () => {
    const view = render(<VideoEditorPreciseFrame url="/frame-a.png" />);
    const first = screen.getByAltText("后端精确停帧");
    expect(first).not.toBeVisible();
    fireEvent.load(first);
    expect(first).toBeVisible();
    view.rerender(<VideoEditorPreciseFrame url="/frame-b.png" />);
    const next = screen.getByAltText("后端精确停帧");
    expect(first).toBeVisible();
    expect(first).toHaveAttribute("src", "/frame-a.png");
    expect(next).not.toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("画面更新中");
    fireEvent.load(next);
    expect(next).toBeVisible();
    expect(first).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("ignores superseded responses during fast scrubbing in both directions", () => {
    const view = render(<VideoEditorPreciseFrame url="/frame-a.png" />);
    const first = screen.getByAltText("后端精确停帧");
    fireEvent.load(first);
    view.rerender(<VideoEditorPreciseFrame url="/frame-b.png" />);
    const obsolete = screen.getByAltText("后端精确停帧");
    view.rerender(<VideoEditorPreciseFrame url="/frame-c.png" />);
    fireEvent.load(obsolete);
    expect(first).toBeVisible();
    const current = screen.getByAltText("后端精确停帧");
    fireEvent.load(current);
    expect(current).toBeVisible();
    view.rerender(<VideoEditorPreciseFrame url="/frame-a.png" />);
    expect(current).toBeVisible();
    fireEvent.load(screen.getByAltText("后端精确停帧"));
    expect(screen.getByAltText("后端精确停帧")).toHaveAttribute(
      "src",
      "/frame-a.png",
    );
    expect(screen.getByAltText("后端精确停帧")).toBeVisible();
  });

  it("retains the last frame on failure and replaces it with a real black frame when ready", () => {
    const view = render(<VideoEditorPreciseFrame url="/red.png" />);
    const red = screen.getByAltText("后端精确停帧");
    fireEvent.load(red);
    view.rerender(<VideoEditorPreciseFrame url="/failed.png" />);
    fireEvent.error(screen.getByAltText("后端精确停帧"));
    expect(red).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("精确画面加载失败");
    view.rerender(<VideoEditorPreciseFrame url="/intentional-black.png" />);
    const black = screen.getByAltText("后端精确停帧");
    fireEvent.load(black);
    expect(black).toBeVisible();
    expect(red).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([false, true])(
    "reuses the video decoder across the continuous split when playing=%s",
    (playing) => {
      const view = render(
        <VideoEditorPreview
          {...props}
          playing={playing}
          playheadUs={16_180_000}
        />,
      );
      const video = view.container.querySelector("video")!;
      const playCount = vi.mocked(HTMLMediaElement.prototype.play).mock.calls
        .length;
      view.rerender(
        <VideoEditorPreview
          {...props}
          playing={playing}
          playheadUs={16_210_000}
        />,
      );
      expect(view.container.querySelector("video")).toBe(video);
      expect(vi.mocked(HTMLMediaElement.prototype.play)).toHaveBeenCalledTimes(
        playCount,
      );
      if (!playing) expect(video.currentTime).toBeCloseTo(3.701572, 6);
      view.rerender(
        <VideoEditorPreview
          {...props}
          playing={playing}
          playheadUs={16_180_000}
        />,
      );
      expect(view.container.querySelector("video")).toBe(video);
    },
  );

  it("retains a precise frame at the seam but clears it for revisions, projects and playback", () => {
    const view = render(
      <VideoEditorPreview {...props} playheadUs={16_180_000} />,
    );
    const first = screen.getByAltText("后端精确停帧");
    fireEvent.load(first);
    view.rerender(<VideoEditorPreview {...props} playheadUs={16_210_000} />);
    expect(first).toBeVisible();
    view.rerender(
      <VideoEditorPreview
        {...props}
        timeline={{ ...timeline, revision: 1195 }}
        playheadUs={16_210_000}
      />,
    );
    expect(first).not.toBeInTheDocument();
    const revised = screen.getByAltText("后端精确停帧");
    expect(revised).not.toBeVisible();
    fireEvent.load(revised);
    view.rerender(
      <VideoEditorPreview
        {...props}
        projectId="other"
        playheadUs={16_210_000}
      />,
    );
    expect(revised).not.toBeInTheDocument();
    view.rerender(
      <VideoEditorPreview {...props} playing playheadUs={16_210_000} />,
    );
    expect(view.container.querySelector(".ve-precise-frame")).toBeNull();
  });

  it("applies the latest paused scrub position once an outstanding seek finishes", () => {
    const view = render(
      <VideoEditorPreview {...props} playheadUs={16_180_000} />,
    );
    const video = view.container.querySelector("video")!;
    let seeking = true;
    Object.defineProperty(video, "seeking", {
      configurable: true,
      get: () => seeking,
    });
    view.rerender(<VideoEditorPreview {...props} playheadUs={16_300_000} />);
    expect(video.currentTime).toBeCloseTo(3.671572, 6);
    seeking = false;
    fireEvent.seeked(video);
    expect(video.currentTime).toBeCloseTo(3.791572, 6);
    const setter = vi.spyOn(video, "currentTime", "set");
    fireEvent.seeked(video);
    expect(setter).not.toHaveBeenCalled();
    video.currentTime = 0;
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBeCloseTo(3.791572, 6);
  });

  it("keeps separate decoders for source jumps, real gaps and simultaneous transition partners", () => {
    const jumped = structuredClone(timeline);
    jumped.document.tracks![0].clips![1].sourceInUs += 100_000;
    expect(previewVideoPlaybackKeys(jumped.document.tracks!, [])).toEqual(
      new Map([
        ["left", "left"],
        ["right", "right"],
      ]),
    );
    const gap = structuredClone(timeline);
    gap.document.tracks![0].clips![1].timelineStartUs += 100_000;
    expect(
      previewVideoPlaybackKeys(gap.document.tracks!, []).get("right"),
    ).toBe("right");
    const transition = {
      id: "seam",
      placement: "between" as const,
      kind: "crossfade" as const,
      fromClipId: "left",
      toClipId: "right",
      durationUs: 500_000,
      direction: "in" as const,
      easing: "linear" as const,
    };
    const view = render(
      <VideoEditorPreview
        {...props}
        timeline={{
          ...timeline,
          document: { ...timeline.document, transitions: [transition] },
        }}
        playheadUs={16_199_838}
      />,
    );
    expect(view.container.querySelectorAll("video")).toHaveLength(2);
    expect(previewVideoPlaybackKeys(timeline.document.tracks!, [])).toEqual(
      new Map([
        ["left", "left"],
        ["right", "left"],
      ]),
    );
    view.rerender(
      <VideoEditorPreview {...props} timeline={gap} playheadUs={16_220_000} />,
    );
    expect(view.container.querySelectorAll("video")).toHaveLength(0);
  });
});
