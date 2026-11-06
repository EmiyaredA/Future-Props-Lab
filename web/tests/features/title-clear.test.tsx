import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { VideoEditorPage } from "@features/video-editor/VideoEditorPage";
import { PresentationEditor } from "@features/presentation-workshop/PresentationEditor";
import { NoteEditorPane } from "@features/thought-workshop/NoteEditorPane";
import { newDeck } from "@features/presentation-workshop/templates";
import type { Project } from "@features/presentation-workshop/types";
import type { Note } from "@features/thought-workshop/api";

const video = vi.hoisted(() => ({ renameProject: vi.fn() }));

vi.mock("@features/video-editor/useVideoEditor", () => ({
  useVideoEditor: () => ({
    renameProject: video.renameProject,
    project: {
      isLoading: false,
      data: { id: "clip", title: "未命名剪辑" },
    },
    timeline: {
      isLoading: false,
      data: {
        revision: 0,
        document: { tracks: [], settings: { fps: 30 } },
      },
    },
    assets: { data: { items: [] }, refetch: vi.fn() },
    layout: {
      assetWidth: 250,
      inspectorWidth: 340,
      trackHeaderWidth: 176,
      timelineRatio: 0.35,
    },
    setLayout: vi.fn(),
    playheadUs: 0,
    setPlayheadUs: vi.fn(),
    playing: false,
    setPlaying: vi.fn(),
    zoom: 40,
    setZoom: vi.fn(),
    timelineScrollLeft: 0,
    timelineScrollTop: 0,
    setTimelineScrollLeft: vi.fn(),
    setTimelineScrollTop: vi.fn(),
    preciseFrame: false,
    setPreciseFrame: vi.fn(),
    snapEnabled: true,
    speedRippleEnabled: false,
    setSnapEnabled: vi.fn(),
    setSpeedRippleEnabled: vi.fn(),
    notice: "",
    setNotice: vi.fn(),
    hasClipboard: false,
    copyClip: vi.fn(),
    pasteClipboardClip: vi.fn(),
    commit: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    saving: false,
    selected: undefined,
    selectedClipId: undefined,
    selectedClipIds: [],
    selectClip: vi.fn(),
  }),
}));
vi.mock("@features/video-editor/VideoEditorAssetPanel", () => ({
  VideoEditorAssetPanel: () => null,
}));
vi.mock("@features/video-editor/VideoEditorPreview", () => ({
  VideoEditorPreview: () => null,
}));
vi.mock("@features/video-editor/VideoEditorTimeline", () => ({
  VideoEditorTimeline: () => null,
}));
vi.mock("@features/video-editor/VideoEditorInspector", () => ({
  VideoEditorInspector: () => null,
}));
vi.mock("@features/video-editor/VideoEditorExportDialog", () => ({
  VideoEditorExportDialog: () => null,
}));
vi.mock("@features/video-editor/VideoEditorSegmentExportDialog", () => ({
  VideoEditorSegmentExportDialog: () => null,
}));
vi.mock("@features/presentation-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/presentation-workshop/api")
  >("@features/presentation-workshop/api");
  return { ...actual, saveProject: vi.fn(), createProject: vi.fn() };
});
vi.mock("@features/thought-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/thought-workshop/api")
  >("@features/thought-workshop/api");
  return { ...actual, saveNote: vi.fn(), createNote: vi.fn() };
});
vi.mock("@features/thought-workshop/RichEditor", () => ({
  RichEditor: ({ beforeContent }: { beforeContent?: ReactNode }) =>
    beforeContent ?? null,
}));

beforeEach(() => {
  video.renameProject.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const note = {
  id: "note-a",
  title: "未命名笔记",
  document: { type: "doc", content: [{ type: "paragraph" }] },
  schema_version: 2,
  tags: [],
  favorite: false,
  pinned: false,
  knowledge_base_id: "kb",
  parent_id: null,
  position: 0,
  is_home: false,
  deleted_at: null,
  revision: 0,
  created_at: "2026-09-08T00:00:00Z",
  updated_at: "2026-09-08T00:00:00Z",
  excerpt: "",
} satisfies Note;

function presentation() {
  const project: Project = {
    id: "deck",
    title: "未命名演示",
    document: newDeck(),
    revision: 0,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
  };
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PresentationEditor
        initial={project}
        readOnly={false}
        onOpen={vi.fn()}
        onBack={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

it("视频剪辑标题可以删光后重写，空着失焦则恢复原名", async () => {
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <VideoEditorPage projectId="clip" onBack={vi.fn()} />
    </QueryClientProvider>,
  );
  const title = screen.getByRole("textbox", { name: "项目名称" });
  await user.clear(title);
  expect(title).toHaveValue("");
  await user.type(title, "成片");
  expect(title).toHaveValue("成片");
  await user.tab();
  expect(video.renameProject).toHaveBeenCalledWith("成片");

  await user.click(title);
  await user.clear(title);
  await user.tab();
  expect(title).toHaveValue("未命名剪辑");
  expect(video.renameProject).toHaveBeenCalledTimes(1);

  await user.click(title);
  await user.clear(title);
  await user.keyboard("{Escape}");
  expect(title).toHaveValue("未命名剪辑");
  expect(video.renameProject).toHaveBeenCalledTimes(1);
});

it("演示文稿标题可以删光后重写，空着失焦则恢复原名", async () => {
  const user = userEvent.setup();
  presentation();
  const title = screen.getByRole("textbox", { name: "文稿名称" });
  await user.clear(title);
  expect(title).toHaveValue("");
  await user.type(title, "发布会");
  expect(title).toHaveValue("发布会");
  await user.tab();
  expect(title).toHaveValue("发布会");

  await user.click(title);
  await user.clear(title);
  expect(title).toHaveValue("");
  await user.tab();
  expect(title).toHaveValue("发布会");
});

it("笔记标题可以删光后重写，空着失焦则恢复原名", async () => {
  const user = userEvent.setup();
  render(
    <NoteEditorPane
      note={note}
      onSaved={vi.fn()}
      onOpen={vi.fn()}
      registerNavigationGuard={vi.fn()}
    />,
  );
  const title = await screen.findByRole("textbox", { name: "笔记标题" });
  await user.clear(title);
  expect(title).toHaveValue("");
  expect(title).not.toHaveValue("未命名笔记");
  await user.type(title, "会议记录");
  expect(title).toHaveValue("会议记录");
  await user.tab();
  expect(title).toHaveValue("会议记录");

  await user.click(title);
  await user.clear(title);
  await user.tab();
  expect(title).toHaveValue("会议记录");
});
