import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoEditorPreview } from "@features/video-editor/VideoEditorPreview";
import type {
  VideoEditorAsset,
  VideoEditorTimeline,
} from "@features/video-editor/types";

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
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
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

    rerender(<VideoEditorPreview {...props} playheadUs={2_010_000} />);

    expect(container.querySelector("audio")).toBe(audio);
    expect(audio.currentTime).toBeCloseTo(1.99, 6);
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
});
