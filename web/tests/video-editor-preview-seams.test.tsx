import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoEditorPreview } from "@features/video-editor/VideoEditorPreview";
import { VideoEditorPreciseFrame } from "@features/video-editor/VideoEditorPreciseFrame";
import { previewVideoPlaybackKeys } from "@features/video-editor/previewPlayback";
import { VideoEditorProxyVideo } from "@features/video-editor/VideoEditorProxyVideo";
import * as chromaCanvas from "@features/video-editor/chromaCanvas";
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
  it("publishes only the latest positioned frame and holds the display across source jumps", () => {
    const paint = vi
      .spyOn(chromaCanvas, "paintChromaCanvas")
      .mockImplementation(() => {});
    const keyed = {
      ...left,
      sourceInUs: 5_000_000,
      chromaKey: {
        enabled: true,
        color: "#00ff00",
        similarity: 42,
        softness: 18,
        despill: 30,
      },
    };
    const mediaProps = {
      source: "/proxy.mp4",
      clip: keyed,
      localUs: 500_000,
      playing: true,
      crop: {
        leftPercent: 0,
        topPercent: 0,
        widthPercent: 100,
        heightPercent: 100,
      },
      chromaKey: keyed.chromaKey,
    };
    const view = render(<VideoEditorProxyVideo {...mediaProps} />);
    const video = view.container.querySelector("video")!;
    const surface = view.container.querySelector("canvas")!;
    Object.defineProperties(video, {
      readyState: { configurable: true, value: 2 },
      videoWidth: { configurable: true, value: 320 },
      videoHeight: { configurable: true, value: 180 },
    });
    video.currentTime = 0;
    fireEvent.loadedData(video);
    expect(video.currentTime).toBe(5.5);
    expect(paint).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(video).not.toBeVisible();
    fireEvent.seeked(video);
    expect(paint).toHaveBeenCalledOnce();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();

    Object.defineProperty(video, "seeking", {
      configurable: true,
      value: true,
    });
    const jump = { ...keyed, id: "jump", sourceInUs: 8_000_000 };
    view.rerender(
      <VideoEditorProxyVideo {...mediaProps} clip={jump} localUs={200_000} />,
    );
    view.rerender(
      <VideoEditorProxyVideo {...mediaProps} clip={jump} localUs={400_000} />,
    );
    fireEvent.loadedData(video);
    expect(paint).toHaveBeenCalledOnce();
    expect(view.container.querySelector("canvas")).toBe(surface);
    Object.defineProperty(video, "seeking", {
      configurable: true,
      value: false,
    });
    fireEvent.seeked(video);
    expect(video.currentTime).toBe(8.4);
    expect(paint).toHaveBeenCalledOnce();
    fireEvent.seeked(video);
    expect(paint).toHaveBeenCalledTimes(2);
  });

  it("pauses held transition tails and rejects drift beyond the trimmed source", () => {
    const paint = vi
      .spyOn(chromaCanvas, "paintChromaCanvas")
      .mockImplementation(() => {});
    const clip = { ...left, sourceInUs: 5_000_000, durationUs: 1_000_000 };
    const mediaProps = {
      source: "/proxy.mp4",
      clip,
      localUs: 999_999,
      playing: true,
      crop: {
        leftPercent: 0,
        topPercent: 0,
        widthPercent: 100,
        heightPercent: 100,
      },
      chromaKey: {
        enabled: true,
        color: "#00ff00",
        similarity: 42,
        softness: 18,
        despill: 30,
      },
    };
    const view = render(<VideoEditorProxyVideo {...mediaProps} />);
    const video = view.container.querySelector("video")!;
    Object.defineProperties(video, {
      readyState: { configurable: true, value: 2 },
      videoWidth: { configurable: true, value: 320 },
      videoHeight: { configurable: true, value: 180 },
    });
    video.currentTime = 6.05; // Under the drift tolerance, but outside [5, 6).
    fireEvent.seeked(video);
    expect(paint).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(5.999999);
    fireEvent.seeked(video);
    expect(paint).toHaveBeenCalledOnce();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
  });

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

  it("shares the display buffer across source jumps but clears gaps and separates transition partners", () => {
    const jumped = structuredClone(timeline);
    jumped.document.tracks![0].clips![1].sourceInUs += 100_000;
    expect(previewVideoPlaybackKeys(jumped.document.tracks!, [])).toEqual(
      new Map([
        ["left", "left"],
        ["right", "left"],
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

  it("holds the incoming transition player's frame across the following plain source cut", () => {
    const paint = vi
      .spyOn(chromaCanvas, "paintChromaCanvas")
      .mockImplementation(() => {});
    const doc = structuredClone(timeline);
    const first = { ...left, id: "first", timelineStartUs: 0 };
    const middle = {
      ...left,
      id: "middle",
      timelineStartUs: first.durationUs,
      sourceInUs: 0,
      chromaKey: {
        enabled: true,
        color: "#00ff00",
        similarity: 42,
        softness: 18,
        despill: 30,
      },
    };
    const last = {
      ...middle,
      id: "last",
      assetId: "other-source",
      timelineStartUs: middle.timelineStartUs + middle.durationUs,
    };
    doc.document.tracks![0].clips = [first, middle, last];
    doc.document.transitions = [
      {
        id: "spin",
        kind: "spin-blur",
        placement: "between",
        fromClipId: first.id,
        toClipId: middle.id,
        durationUs: 1_000_000,
        direction: "left",
        easing: "ease-in-out",
      },
    ];
    expect(
      previewVideoPlaybackKeys(doc.document.tracks!, doc.document.transitions),
    ).toEqual(
      new Map([
        [first.id, first.id],
        [middle.id, middle.id],
        [last.id, middle.id],
      ]),
    );
    const media = [
      ...assets,
      { ...assets[0], id: "other-source", proxyUrl: "/other.mp4" },
    ];
    const seamUs = last.timelineStartUs;
    const view = render(
      <VideoEditorPreview
        {...props}
        timeline={doc}
        assets={media}
        playing
        playheadUs={seamUs - 100_000}
      />,
    );
    const video = view.container.querySelector("video")!;
    const surface = view.container.querySelector("canvas")!;
    Object.defineProperties(video, {
      readyState: { configurable: true, value: 2 },
      videoWidth: { configurable: true, value: 320 },
      videoHeight: { configurable: true, value: 180 },
    });
    fireEvent.seeked(video);
    expect(paint).toHaveBeenCalledOnce();
    view.rerender(
      <VideoEditorPreview
        {...props}
        timeline={doc}
        assets={media}
        playing
        playheadUs={seamUs + 10_000}
      />,
    );
    expect(view.container.querySelector("video")).toBe(video);
    expect(view.container.querySelector("canvas")).toBe(surface);
    expect(video).toHaveAttribute("src", "/other.mp4");
    expect(paint).toHaveBeenCalledOnce();
    fireEvent.seeked(video);
    expect(paint).toHaveBeenCalledTimes(2);
  });

  it("reuses a preceding plain cut's buffer until the actual transition", () => {
    const tracks = structuredClone(timeline.document.tracks!);
    const third = {
      ...right,
      id: "third",
      timelineStartUs: right.timelineStartUs + right.durationUs,
    };
    tracks[0].clips!.push(third);
    expect(
      previewVideoPlaybackKeys(tracks, [
        {
          id: "spin",
          kind: "spin-blur",
          placement: "between",
          fromClipId: right.id,
          toClipId: third.id,
          durationUs: 500_000,
          direction: "left",
          easing: "ease-in-out",
        },
      ]),
    ).toEqual(
      new Map([
        [left.id, left.id],
        [right.id, left.id],
        [third.id, third.id],
      ]),
    );
  });
});
