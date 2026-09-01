import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useVideoEditor } from "@features/video-editor/useVideoEditor";
import {
  loadVideoEditorWorkspacePreferences,
  storeVideoEditorWorkspacePreferences,
} from "@features/video-editor/workspacePreferences";
import {
  getVideoEditorProject,
  getVideoEditorTimeline,
  listVideoEditorAssets,
  listVideoEditorRenders,
} from "@features/video-editor/api";

vi.mock("@features/video-editor/api", () => ({
  applyVideoEditorOperations: vi.fn(),
  getVideoEditorProject: vi.fn(),
  getVideoEditorTimeline: vi.fn(),
  listVideoEditorAssets: vi.fn(),
  listVideoEditorRenders: vi.fn(),
  patchVideoEditorProject: vi.fn(),
}));

const project = {
  id: "editor-1",
  title: "剪辑",
  status: "draft" as const,
  revision: 0,
  createdAt: "2026-08-30T00:00:00Z",
  updatedAt: "2026-08-30T00:00:00Z",
};

const timeline = {
  projectId: "editor-1",
  revision: 0,
  updatedAt: "2026-08-30T00:00:00Z",
  document: {
    schemaVersion: "1.0" as const,
    settings: {
      width: 1920 as const,
      height: 1080 as const,
      fps: 30 as const,
      backgroundColor: "#000000",
    },
    tracks: [
      {
        id: "visual-1",
        kind: "visual" as const,
        name: "V1",
        order: 0,
        locked: false,
        hidden: false,
        muted: false,
        clips: [
          {
            id: "video-1",
            trackId: "visual-1",
            kind: "video" as const,
            name: "视频",
            assetId: "asset-1",
            timelineStartUs: 0,
            durationUs: 10_000_000,
            sourceInUs: 0,
            sourceLoop: false,
            fitMode: "native" as const,
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

function PlaybackProbe() {
  const editor = useVideoEditor("editor-1");
  if (!editor.timeline.data) return <span>加载中</span>;
  return (
    <>
      <output aria-label="播放进度">{Math.round(editor.playheadUs)}</output>
      <button onClick={() => editor.setPlaying(true)}>播放</button>
      <button onClick={() => editor.setPlayheadUs(5_000_000)}>跳转</button>
    </>
  );
}

function WorkspaceProbe() {
  const editor = useVideoEditor("editor-1");
  if (!editor.timeline.data) return <span>加载中</span>;
  return (
    <>
      <output aria-label="工作位置">
        {[
          Math.round(editor.playheadUs),
          editor.selectedClipIds.join(","),
          editor.zoom,
          editor.timelineScrollLeft,
          String(editor.preciseFrame),
          String(editor.playing),
          String(editor.canUndo),
          String(editor.canRedo),
        ].join("|")}
      </output>
      <button onClick={() => editor.setPlayheadUs(7_000_000)}>
        调整播放头
      </button>
      <button onClick={() => editor.selectClip("video-1")}>选择片段</button>
      <button onClick={() => editor.setZoom(145)}>调整缩放</button>
      <button onClick={() => editor.setTimelineScrollLeft(630)}>滚动</button>
      <button onClick={() => editor.setPreciseFrame(false)}>
        关闭精确停帧
      </button>
    </>
  );
}

function testClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("video editor playback clock", () => {
  let now = 0;
  let animationFrame: FrameRequestCallback | undefined;

  beforeEach(() => {
    now = 0;
    animationFrame = undefined;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        animationFrame = callback;
        return 1;
      }),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.mocked(getVideoEditorProject).mockResolvedValue(project);
    vi.mocked(getVideoEditorTimeline).mockResolvedValue(timeline);
    vi.mocked(listVideoEditorAssets).mockResolvedValue({ items: [] });
    vi.mocked(listVideoEditorRenders).mockResolvedValue({ items: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("continues playback from a manual timeline seek", async () => {
    const user = userEvent.setup();
    const client = testClient();
    render(
      <QueryClientProvider client={client}>
        <PlaybackProbe />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "播放" });

    await user.click(screen.getByRole("button", { name: "播放" }));
    await waitFor(() => expect(animationFrame).toBeTypeOf("function"));
    now = 1_000;
    act(() => animationFrame?.(now));
    expect(screen.getByLabelText("播放进度")).toHaveTextContent("1000000");

    await user.click(screen.getByRole("button", { name: "跳转" }));
    expect(screen.getByLabelText("播放进度")).toHaveTextContent("5000000");
    now = 1_100;
    act(() => animationFrame?.(now));

    expect(screen.getByLabelText("播放进度")).toHaveTextContent("5100000");
  });

  it("flushes and restores the complete per-project work position", async () => {
    const user = userEvent.setup();
    const first = render(
      <QueryClientProvider client={testClient()}>
        <WorkspaceProbe />
      </QueryClientProvider>,
    );
    await screen.findByRole("button", { name: "调整播放头" });

    await user.click(screen.getByRole("button", { name: "调整播放头" }));
    await user.click(screen.getByRole("button", { name: "选择片段" }));
    await user.click(screen.getByRole("button", { name: "调整缩放" }));
    await user.click(screen.getByRole("button", { name: "滚动" }));
    await user.click(screen.getByRole("button", { name: "关闭精确停帧" }));
    first.unmount();

    expect(loadVideoEditorWorkspacePreferences("editor-1")).toMatchObject({
      playheadUs: 7_000_000,
      selectedClipIds: ["video-1"],
      zoom: 145,
      timelineScrollLeft: 630,
      preciseFrame: false,
    });

    render(
      <QueryClientProvider client={testClient()}>
        <WorkspaceProbe />
      </QueryClientProvider>,
    );

    expect(await screen.findByLabelText("工作位置")).toHaveTextContent(
      "7000000|video-1|145|630|false|false|false|false",
    );
  });

  it("clamps the playhead and removes deleted selections after loading", async () => {
    storeVideoEditorWorkspacePreferences("editor-1", {
      version: 1,
      playheadUs: 99_000_000,
      selectedClipIds: ["deleted-clip", "video-1"],
      zoom: 80,
      timelineScrollLeft: 0,
      preciseFrame: true,
    });

    render(
      <QueryClientProvider client={testClient()}>
        <WorkspaceProbe />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("工作位置")).toHaveTextContent(
        "10000000|video-1|80|0|true|false|false|false",
      ),
    );
  });
});
