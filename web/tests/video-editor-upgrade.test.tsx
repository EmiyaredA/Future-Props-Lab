import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VideoEditorSegmentExportDialog } from "@features/video-editor/VideoEditorSegmentExportDialog";
import { VideoEditorTimeline } from "@features/video-editor/VideoEditorTimeline";
import { VideoEditorProjectsPage } from "@features/video-editor/VideoEditorProjectsPage";
import {
  createVideoEditorSegmentExport,
  exportVideoEditorProjectSnapshot,
  getVideoEditorSegmentExport,
  importVideoEditorProjectSnapshot,
  listVideoEditorProjects,
  openVideoEditorProjectFolder,
} from "@features/video-editor/api";
import { getVisualWorkshopProjects } from "@features/visual-workshop";
import type {
  VideoEditorAsset,
  VideoEditorTimeline as Timeline,
} from "@features/video-editor/types";

vi.mock("@features/video-editor/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/video-editor/api")
  >("@features/video-editor/api");
  return {
    ...actual,
    createVideoEditorSegmentExport: vi.fn(),
    getVideoEditorSegmentExport: vi.fn(),
    exportVideoEditorProjectSnapshot: vi.fn(),
    importVideoEditorProjectSnapshot: vi.fn(),
    listVideoEditorProjects: vi.fn(),
    openVideoEditorProjectFolder: vi.fn(),
  };
});
vi.mock("@features/visual-workshop", async () => {
  const actual = await vi.importActual<
    typeof import("@features/visual-workshop")
  >("@features/visual-workshop");
  return { ...actual, getVisualWorkshopProjects: vi.fn() };
});

const timeline: Timeline = {
  projectId: "editor-1",
  revision: 7,
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
        id: "v1",
        kind: "visual",
        name: "V1",
        order: 0,
        locked: false,
        hidden: false,
        muted: false,
        clips: [
          {
            id: "clip-a",
            trackId: "v1",
            kind: "video",
            name: "开场",
            assetId: "asset-a",
            timelineStartUs: 0,
            sourceInUs: 1_000_000,
            sourceLoop: false,
            durationUs: 2_000_000,
            fitMode: "native",
            flipX: false,
            fontSize: 72,
            textColor: "#ffffff",
            volume: 1,
            keyframes: [],
          },
          {
            id: "clip-b",
            trackId: "v1",
            kind: "video",
            name: "结尾",
            assetId: "asset-b",
            timelineStartUs: 2_000_000,
            sourceInUs: 4_000_000,
            sourceLoop: false,
            durationUs: 3_000_000,
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

const assets: VideoEditorAsset[] = [];
const editorProject = {
  id: "editor-1",
  title: "剪辑广告",
  status: "draft" as const,
  revision: 0,
  createdAt: "2026-08-29T00:00:00Z",
  updatedAt: "2026-08-29T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVisualWorkshopProjects).mockResolvedValue({
    items: [
      {
        id: "canvas-1",
        title: "广告画布",
        kind: "canvas",
        status: "draft",
        revision: 0,
        created_at: "2026-08-29T00:00:00Z",
        updated_at: "2026-08-29T00:00:00Z",
      },
    ],
  });
  vi.mocked(createVideoEditorSegmentExport).mockResolvedValue({
    id: "task-1",
    projectId: "editor-1",
    requestId: "request-1",
    kind: "segment_export",
    status: "queued",
    progress: 0,
    resultDetail: {},
    revision: 0,
    createdAt: "2026-08-29T00:00:00Z",
    updatedAt: "2026-08-29T00:00:00Z",
  });
  vi.mocked(getVideoEditorSegmentExport).mockResolvedValue({
    id: "task-1",
    projectId: "editor-1",
    requestId: "request-1",
    kind: "segment_export",
    status: "running",
    progress: 42,
    resultDetail: {
      segments: [{ clipId: "clip-b", name: "结尾", status: "encoded" }],
    },
    revision: 1,
    createdAt: "2026-08-29T00:00:00Z",
    updatedAt: "2026-08-29T00:00:00Z",
  });
  vi.mocked(listVideoEditorProjects).mockResolvedValue({
    items: [editorProject],
  });
  vi.mocked(exportVideoEditorProjectSnapshot).mockResolvedValue({
    blob: new Blob(["snapshot"]),
    filename: "video-editor-snapshot.zip",
  });
  vi.mocked(importVideoEditorProjectSnapshot).mockResolvedValue({
    project: { ...editorProject, id: "editor-copy", title: "剪辑广告（副本）" },
    warnings: [],
  });
  vi.mocked(openVideoEditorProjectFolder).mockResolvedValue({ opened: true });
});

describe("video editor upgrade", () => {
  it("imports a snapshot and opens the copied video project", async () => {
    const user = userEvent.setup();
    const onOpenProject = vi.fn();
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <VideoEditorProjectsPage onOpenProject={onOpenProject} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("剪辑广告")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "打开“剪辑广告”项目文件夹" }),
    );
    await waitFor(() =>
      expect(openVideoEditorProjectFolder).toHaveBeenCalledWith("editor-1"),
    );
    await user.upload(
      screen.getByLabelText("选择项目快照压缩包"),
      new File(["zip"], "edit.zip", { type: "application/zip" }),
    );
    await waitFor(() =>
      expect(importVideoEditorProjectSnapshot).toHaveBeenCalled(),
    );
    expect(onOpenProject).toHaveBeenCalledWith("editor-copy");
    expect(
      screen.getByRole("button", { name: "导出“剪辑广告”项目快照" }),
    ).toBeEnabled();
  });

  it("uses selected clips by default and submits per-segment overrides with a stable request id", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <VideoEditorSegmentExportDialog
          projectId="editor-1"
          timeline={timeline}
          assets={assets}
          selectedClipIds={["clip-b"]}
          onClose={vi.fn()}
        />
      </QueryClientProvider>,
    );

    expect(screen.getByDisplayValue("结尾")).toBeVisible();
    expect(screen.queryByDisplayValue("开场")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("视频名称"));
    expect(
      screen.getByRole("button", { name: "开始导出并导入" }),
    ).toBeDisabled();
    await user.type(screen.getByLabelText("视频名称"), "  最终片段  ");
    await user.click(screen.getByRole("button", { name: "新建画布项目" }));
    await user.clear(screen.getByLabelText("新画布项目名称"));
    await user.type(screen.getByLabelText("新画布项目名称"), "成片工坊");
    await user.click(screen.getByRole("button", { name: "开始导出并导入" }));

    await waitFor(() =>
      expect(createVideoEditorSegmentExport).toHaveBeenCalledTimes(1),
    );
    const call = vi.mocked(createVideoEditorSegmentExport).mock.calls[0];
    expect(call?.[0]).toBe("editor-1");
    expect(call?.[1]).toMatchObject({
      expectedRevision: 7,
      target: { newProjectTitle: "成片工坊" },
      segments: [{ clipId: "clip-b", name: "最终片段" }],
    });
    expect(call?.[2]).toEqual(expect.any(String));
  });

  it("passes Cmd/Ctrl additive selection through the timeline", () => {
    const selectClip = vi.fn();
    render(
      <VideoEditorTimeline
        timeline={timeline}
        assets={assets}
        playheadUs={0}
        setPlayheadUs={vi.fn()}
        zoom={80}
        scrollLeft={0}
        onScrollLeftChange={vi.fn()}
        selectedClipId="clip-a"
        selectedClipIds={["clip-a"]}
        selectClip={selectClip}
        commit={vi.fn().mockResolvedValue(undefined)}
        onDropAsset={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /结尾/ }), {
      ctrlKey: true,
    });
    expect(selectClip).toHaveBeenCalledWith("clip-b", true);
  });

  it("keeps the dialog open and shows task progress after submission", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <VideoEditorSegmentExportDialog
          projectId="editor-1"
          timeline={timeline}
          assets={assets}
          selectedClipIds={["clip-b"]}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );

    await user.click(screen.getByRole("button", { name: "开始导出并导入" }));
    expect(await screen.findByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "42",
    );
    expect(screen.getByText("正在导出并导入")).toBeInTheDocument();
    expect(screen.getByText("已编码，正在导入")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
