import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoEditorPreview } from "@features/video-editor/VideoEditorPreview";
import {
  exactFramePath,
  uploadVideoEditorAsset,
} from "@features/video-editor/api";
import { fetchApiBlob } from "@platform/api/client";
import type {
  VideoEditorAsset,
  VideoEditorTimeline,
} from "@features/video-editor/types";

vi.mock("@platform/api/client", async () => {
  const actual = await vi.importActual<typeof import("@platform/api/client")>(
    "@platform/api/client",
  );
  return { ...actual, fetchApiBlob: vi.fn() };
});

vi.mock("@features/video-editor/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/video-editor/api")
  >("@features/video-editor/api");
  return { ...actual, uploadVideoEditorAsset: vi.fn() };
});

const timeline: VideoEditorTimeline = {
  projectId: "editor-1",
  revision: 1,
  updatedAt: "2026-08-29T00:00:00Z",
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
        id: "visual-1",
        kind: "visual",
        name: "V1",
        order: 0,
        locked: false,
        hidden: false,
        muted: false,
        clips: [
          {
            id: "video-1",
            trackId: "visual-1",
            kind: "video",
            name: "视频",
            assetId: "asset-1",
            timelineStartUs: 0,
            durationUs: 100_000_000,
            sourceInUs: 0,
            sourceLoop: false,
            fitMode: "native",
            flipX: false,
            fontSize: 72,
            textColor: "#ffffff",
            volume: 1,
            keyframes: [],
          },
        ],
      },
      {
        id: "audio-1",
        kind: "audio",
        name: "A1",
        order: 1,
        locked: false,
        hidden: false,
        muted: false,
        clips: [
          {
            id: "audio-left",
            trackId: "audio-1",
            kind: "audio",
            name: "左侧音频",
            assetId: "asset-1",
            timelineStartUs: 0,
            durationUs: 2_000_000,
            sourceInUs: 0,
            sourceLoop: false,
            fitMode: "native",
            flipX: false,
            fontSize: 72,
            textColor: "#ffffff",
            volume: 1,
            keyframes: [],
          },
          {
            id: "audio-right",
            trackId: "audio-1",
            kind: "audio",
            name: "右侧音频",
            assetId: "asset-1",
            timelineStartUs: 2_000_000,
            durationUs: 2_000_000,
            sourceInUs: 2_000_000,
            sourceLoop: false,
            fitMode: "native",
            flipX: false,
            fontSize: 72,
            textColor: "#ffffff",
            volume: 1,
            keyframes: [],
          },
        ],
      },
    ],
  },
};

const assets: VideoEditorAsset[] = [
  {
    id: "asset-1",
    displayName: "视频",
    originalFilename: "video.mp4",
    mediaKind: "video",
    mimeType: "video/mp4",
    byteSize: 100,
    processingStatus: "ready",
    proxyUrl: "/proxy.mp4",
    probe: { width: 1920, height: 1080 },
    createdAt: "2026-08-29T00:00:00Z",
  },
];

describe("video editor preview playback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(fetchApiBlob).mockReset();
    vi.mocked(uploadVideoEditorAsset).mockReset();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:frame"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  });

  it("shows a paused split comparison for a selected keyed clip", () => {
    const keyedTimeline = structuredClone(timeline);
    keyedTimeline.document.tracks![0]!.clips![0]!.chromaKey = {
      enabled: true,
      color: "#00ff00",
      similarity: 42,
      softness: 18,
      despill: 30,
    };
    render(
      <VideoEditorPreview
        projectId="editor-1"
        timeline={keyedTimeline}
        assets={assets}
        playheadUs={1_000_000}
        setPlayheadUs={vi.fn()}
        playing={false}
        setPlaying={vi.fn()}
        selectedClipId="video-1"
        preciseFrame={true}
        onPreciseFrameChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "抠像对比" }));
    expect(screen.getByAltText("抠像前的节目帧")).toHaveAttribute(
      "src",
      expect.stringContaining("withoutChromaClipId=video-1"),
    );
    expect(screen.getByRole("status")).toHaveTextContent("分屏对比");
    fireEvent.click(screen.getByRole("button", { name: "原图" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在查看抠像前");
    expect(screen.getByAltText("抠像前的节目帧")).toHaveStyle({
      clipPath: "inset(0 0 0 0)",
    });
    fireEvent.click(screen.getByRole("button", { name: "抠像后" }));
    expect(screen.getByRole("status")).toHaveTextContent("正在查看抠像后");
    expect(screen.getByAltText("抠像前的节目帧")).toHaveStyle({
      clipPath: "inset(0 100% 0 0)",
    });
    fireEvent.click(screen.getByRole("button", { name: "分屏" }));
    fireEvent.change(
      screen.getByRole("slider", { name: "调整抠像前后对比分界线" }),
      { target: { value: "70" } },
    );
    expect(screen.getByAltText("抠像前的节目帧")).toHaveStyle({
      clipPath: "inset(0 30% 0 0)",
    });
  });

  it("seeks every paused frame even when the delta is below playback tolerance", () => {
    const props = {
      projectId: "editor-1",
      timeline,
      assets,
      setPlayheadUs: vi.fn(),
      playing: false,
      setPlaying: vi.fn(),
      selectedClipId: "video-1",
      preciseFrame: true,
      onPreciseFrameChange: vi.fn(),
    };
    const { container, rerender } = render(
      <VideoEditorPreview {...props} playheadUs={30_000_000} />,
    );
    const video = container.querySelector("video")!;
    expect(video.currentTime).toBe(30);

    rerender(<VideoEditorPreview {...props} playheadUs={30_033_333} />);

    expect(video.currentTime).toBeCloseTo(30.033333, 6);
  });

  it("keeps one audio player across continuous split boundaries", () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const props = {
      projectId: "editor-1",
      timeline,
      assets,
      setPlayheadUs: vi.fn(),
      playing: true,
      setPlaying: vi.fn(),
      selectedClipId: "video-1",
      preciseFrame: true,
      onPreciseFrameChange: vi.fn(),
    };
    const { container, rerender } = render(
      <VideoEditorPreview {...props} playheadUs={1_990_000} />,
    );
    const audio = container.querySelector("audio")!;
    expect(audio.currentTime).toBeCloseTo(1.99, 6);
    expect(play).toHaveBeenCalledTimes(2);

    rerender(<VideoEditorPreview {...props} playheadUs={2_010_000} />);

    expect(container.querySelector("audio")).toBe(audio);
    expect(audio.currentTime).toBeCloseTo(1.99, 6);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("does not restart media playback on every playhead refresh", () => {
    const play = vi.mocked(HTMLMediaElement.prototype.play);
    const props = {
      projectId: "editor-1",
      timeline,
      assets,
      setPlayheadUs: vi.fn(),
      playing: true,
      setPlaying: vi.fn(),
      selectedClipId: "video-1",
      preciseFrame: true,
      onPreciseFrameChange: vi.fn(),
    };
    const { rerender } = render(
      <VideoEditorPreview {...props} playheadUs={1_000_000} />,
    );
    expect(play).toHaveBeenCalledTimes(2);

    for (let frame = 1; frame <= 12; frame += 1) {
      rerender(
        <VideoEditorPreview
          {...props}
          playheadUs={1_000_000 + frame * 16_667}
        />,
      );
    }

    expect(play).toHaveBeenCalledTimes(2);
  });

  it("lets audio free-run through moderate playhead drift while playing", () => {
    const props = {
      projectId: "editor-1",
      timeline,
      assets,
      setPlayheadUs: vi.fn(),
      playing: true,
      setPlaying: vi.fn(),
      selectedClipId: "video-1",
      preciseFrame: true,
      onPreciseFrameChange: vi.fn(),
    };
    const { container, rerender } = render(
      <VideoEditorPreview {...props} playheadUs={1_000_000} />,
    );
    const audio = container.querySelector("audio")!;
    expect(audio.currentTime).toBeCloseTo(1, 6);

    rerender(<VideoEditorPreview {...props} playheadUs={1_250_000} />);

    expect(audio.currentTime).toBeCloseTo(1, 6);
  });

  it("does not stack audio seeks while the element is already seeking", () => {
    const props = {
      projectId: "editor-1",
      timeline,
      assets,
      setPlayheadUs: vi.fn(),
      playing: true,
      setPlaying: vi.fn(),
      selectedClipId: "video-1",
      preciseFrame: true,
      onPreciseFrameChange: vi.fn(),
    };
    const { container, rerender } = render(
      <VideoEditorPreview {...props} playheadUs={1_000_000} />,
    );
    const audio = container.querySelector("audio")!;
    Object.defineProperty(audio, "seeking", {
      configurable: true,
      get: () => true,
    });

    rerender(<VideoEditorPreview {...props} playheadUs={3_000_000} />);

    expect(audio.currentTime).toBeCloseTo(1, 6);
  });

  it("resyncs audio after playhead jumps beyond the playback tolerance", () => {
    const props = {
      projectId: "editor-1",
      timeline,
      assets,
      setPlayheadUs: vi.fn(),
      playing: true,
      setPlaying: vi.fn(),
      selectedClipId: "video-1",
      preciseFrame: true,
      onPreciseFrameChange: vi.fn(),
    };
    const { container, rerender } = render(
      <VideoEditorPreview {...props} playheadUs={1_000_000} />,
    );
    const audio = container.querySelector("audio")!;
    expect(audio.currentTime).toBeCloseTo(1, 6);

    rerender(<VideoEditorPreview {...props} playheadUs={1_250_000} />);
    expect(audio.currentTime).toBeCloseTo(1, 6);

    rerender(<VideoEditorPreview {...props} playheadUs={2_000_000} />);
    expect(audio.currentTime).toBeCloseTo(2, 6);
  });

  it("keeps source jump cuts on separate audio players", () => {
    const jumpCutTimeline = structuredClone(timeline);
    const rightClip = jumpCutTimeline.document.tracks?.[1]?.clips?.[1];
    if (!rightClip) throw new Error("missing right-hand audio clip");
    rightClip.sourceInUs = 3_000_000;

    const { container } = render(
      <VideoEditorPreview
        projectId="editor-1"
        timeline={jumpCutTimeline}
        assets={assets}
        playheadUs={1_000_000}
        setPlayheadUs={vi.fn()}
        playing
        setPlaying={vi.fn()}
        selectedClipId="video-1"
        preciseFrame
        onPreciseFrameChange={vi.fn()}
      />,
    );

    expect(container.querySelectorAll("audio")).toHaveLength(2);
  });

  it("reports precise-frame preference changes to the editor workspace", () => {
    const onPreciseFrameChange = vi.fn();
    render(
      <VideoEditorPreview
        projectId="editor-1"
        timeline={timeline}
        assets={assets}
        playheadUs={1_000_000}
        setPlayheadUs={vi.fn()}
        playing={false}
        setPlaying={vi.fn()}
        selectedClipId="video-1"
        preciseFrame
        onPreciseFrameChange={onPreciseFrameChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "精确停帧" }));
    expect(onPreciseFrameChange).toHaveBeenCalledWith(false);
  });

  it("exports the locked full-resolution program frame into project assets", async () => {
    const setPlaying = vi.fn();
    const setPlayheadUs = vi.fn();
    const onFrameSaved = vi.fn();
    const download = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    vi.mocked(fetchApiBlob).mockResolvedValue(
      new Blob(["frame"], { type: "image/png" }),
    );
    vi.mocked(uploadVideoEditorAsset).mockResolvedValue(assets[0]!);

    render(
      <VideoEditorPreview
        projectId="editor-1"
        projectTitle="预告片"
        timeline={timeline}
        assets={assets}
        playheadUs={3_250_000}
        setPlayheadUs={setPlayheadUs}
        playing
        setPlaying={setPlaying}
        selectedClipId="video-1"
        preciseFrame
        onPreciseFrameChange={vi.fn()}
        onFrameSaved={onFrameSaved}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "导出当前节目帧" }));
    expect(setPlaying).toHaveBeenCalledWith(false);
    expect(await screen.findByAltText("当前导出视频帧预览")).toBeVisible();
    expect(fetchApiBlob).toHaveBeenCalledWith(
      exactFramePath("editor-1", 1, 3_250_000, 1920),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    const scrubber = screen.getByRole("slider", {
      name: "导出视频帧时间点",
    });
    fireEvent.change(scrubber, { target: { value: "4.5" } });
    fireEvent.pointerUp(scrubber);
    await waitFor(() =>
      expect(fetchApiBlob).toHaveBeenCalledWith(
        exactFramePath("editor-1", 1, 4_500_000, 1920),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    expect(setPlayheadUs).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "导出并保存" }));
    await waitFor(() =>
      expect(uploadVideoEditorAsset).toHaveBeenCalledTimes(1),
    );
    const [projectId, file] = vi.mocked(uploadVideoEditorAsset).mock.calls[0]!;
    expect(projectId).toBe("editor-1");
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("预告片-frame_00-00-04-500.png");
    expect(onFrameSaved).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledOnce();
  });
});
