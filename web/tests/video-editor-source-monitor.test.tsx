import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VideoEditorAssetPanel } from "@features/video-editor/VideoEditorAssetPanel";
import { VideoEditorPreview } from "@features/video-editor/VideoEditorPreview";
import { listVideoEditorImportSources } from "@features/video-editor/api";
import type {
  VideoEditorAsset,
  VideoEditorTimeline,
} from "@features/video-editor/types";

vi.mock("@features/video-editor/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/video-editor/api")
  >("@features/video-editor/api");
  return {
    ...actual,
    listVideoEditorImportSources: vi.fn(),
    uploadVideoEditorAsset: vi.fn(),
  };
});

const asset: VideoEditorAsset = {
  id: "asset-video",
  displayName: "SHOWTIME.mp4",
  originalFilename: "showtime.mp4",
  mediaKind: "video",
  mimeType: "video/mp4",
  byteSize: 1024,
  processingStatus: "ready",
  proxyUrl: "/proxy-showtime.mp4",
  probe: { durationUs: 4_000_000, width: 1920, height: 1080 },
  createdAt: "2026-08-29T00:00:00Z",
};

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
        clips: [],
      },
    ],
  },
};

describe("video editor source monitor", () => {
  it("opens source monitor from asset click and can return to program", () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.mocked(listVideoEditorImportSources).mockResolvedValue({ items: [] });
    const onPreview = vi.fn();
    const onAdd = vi.fn();
    const onClear = vi.fn();
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const { rerender } = render(
      <QueryClientProvider client={client}>
        <VideoEditorAssetPanel
          projectId="project-1"
          assets={[asset]}
          onPreview={onPreview}
          onAdd={onAdd}
          onAddBatch={vi.fn()}
          onAddGenerated={vi.fn()}
          onOrganizationChange={vi.fn()}
        />
        <VideoEditorPreview
          projectId="editor-1"
          timeline={timeline}
          assets={[asset]}
          playheadUs={0}
          setPlayheadUs={vi.fn()}
          playing={false}
          setPlaying={vi.fn()}
          preciseFrame={false}
          onPreciseFrameChange={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByText("节目监视器")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "预览素材“SHOWTIME.mp4”，双击添加到时间轴",
      }),
    );
    expect(onPreview).toHaveBeenCalledWith(asset);

    rerender(
      <QueryClientProvider client={client}>
        <VideoEditorAssetPanel
          projectId="project-1"
          assets={[asset]}
          previewingAssetId={asset.id}
          onPreview={onPreview}
          onAdd={onAdd}
          onAddBatch={vi.fn()}
          onAddGenerated={vi.fn()}
          onOrganizationChange={vi.fn()}
        />
        <VideoEditorPreview
          projectId="editor-1"
          timeline={timeline}
          assets={[asset]}
          playheadUs={0}
          setPlayheadUs={vi.fn()}
          playing={false}
          setPlaying={vi.fn()}
          preciseFrame={false}
          onPreciseFrameChange={vi.fn()}
          previewingAsset={asset}
          onClearPreviewingAsset={onClear}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByRole("button", { name: "素材监视器" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTitle("SHOWTIME.mp4", { exact: true })).toHaveClass(
      "ve-preview-meta",
    );
    expect(screen.queryByRole("button", { name: "精确停帧" })).toBeNull();
    expect(
      document.querySelector(
        'video.ve-source-media[src="/proxy-showtime.mp4"]',
      ),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", {
        name: "预览素材“SHOWTIME.mp4”，双击添加到时间轴",
      }),
    ).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "节目监视器" }));
    expect(onClear).toHaveBeenCalled();

    fireEvent.doubleClick(
      screen.getByRole("button", {
        name: "预览素材“SHOWTIME.mp4”，双击添加到时间轴",
      }),
    );
    expect(onAdd).toHaveBeenCalledWith(asset);
  });

  it("starts playback without rewriting currentTime while playing", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    let currentTime = 1.2;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "seeking", {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "ended", {
      configurable: true,
      get: () => false,
    });

    render(
      <VideoEditorPreview
        projectId="editor-1"
        timeline={timeline}
        assets={[asset]}
        playheadUs={0}
        setPlayheadUs={vi.fn()}
        playing={false}
        setPlaying={vi.fn()}
        preciseFrame={false}
        onPreciseFrameChange={vi.fn()}
        previewingAsset={asset}
        onClearPreviewingAsset={vi.fn()}
      />,
    );

    const before = currentTime;
    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    await Promise.resolve();
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();
    // Playhead follows the media clock; do not seek-fight during playback.
    expect(currentTime).toBe(before);
  });

  it("restarts from the beginning when play is pressed near the end", async () => {
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    let currentTime = 3.98;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "ended", {
      configurable: true,
      get: () => false,
    });

    render(
      <VideoEditorPreview
        projectId="editor-1"
        timeline={timeline}
        assets={[asset]}
        playheadUs={0}
        setPlayheadUs={vi.fn()}
        playing={false}
        setPlaying={vi.fn()}
        preciseFrame={false}
        onPreciseFrameChange={vi.fn()}
        previewingAsset={asset}
        onClearPreviewingAsset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "播放" }));
    await Promise.resolve();
    expect(currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("seeks the source media when the transport scrubber moves", () => {
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    let currentTime = 0;
    Object.defineProperty(HTMLMediaElement.prototype, "currentTime", {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    });

    render(
      <VideoEditorPreview
        projectId="editor-1"
        timeline={timeline}
        assets={[asset]}
        playheadUs={0}
        setPlayheadUs={vi.fn()}
        playing={false}
        setPlaying={vi.fn()}
        preciseFrame={false}
        onPreciseFrameChange={vi.fn()}
        previewingAsset={asset}
        onClearPreviewingAsset={vi.fn()}
      />,
    );

    const scrubber = screen.getByRole("slider", { name: "素材播放位置" });
    expect(scrubber).toBeEnabled();
    fireEvent.change(scrubber, { target: { value: "2000000" } });
    expect(currentTime).toBe(2);
    expect(screen.getByText("00:02.000 / 00:04.000")).toBeInTheDocument();
  });
});
