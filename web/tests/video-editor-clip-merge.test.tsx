import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { clipMergeSelection } from "@features/video-editor/clipMerge";
import { VideoEditorClipMergeDialog } from "@features/video-editor/VideoEditorClipMergeDialog";
import { VideoEditorTimeline } from "@features/video-editor/VideoEditorTimeline";
import * as api from "@features/video-editor/api";
import type {
  VideoEditorAsset,
  VideoEditorTask,
  VideoEditorTimeline as Timeline,
} from "@features/video-editor/types";

vi.mock("@features/video-editor/api", async (original) => ({
  ...(await original<typeof api>()),
  createVideoEditorClipMerge: vi.fn(),
  getVideoEditorClipMerge: vi.fn(),
  cancelVideoEditorClipMerge: vi.fn(),
}));
const timeline: Timeline = {
  projectId: "project",
  revision: 4,
  updatedAt: "2026-10-24",
  document: {
    schemaVersion: "1.0",
    tracks: [
      {
        id: "v",
        name: "画面",
        kind: "visual",
        order: 0,
        hidden: false,
        locked: false,
        muted: false,
        clips: [0, 1].map((index) => ({
          id: `clip-${index}`,
          trackId: "v",
          kind: "video",
          name: `镜头${index}`,
          assetId: `asset-${index}`,
          timelineStartUs: index * 200_000,
          durationUs: 200_000,
          sourceInUs: 0,
          sourceLoop: false,
          fitMode: "cover",
          flipX: false,
          fontSize: 72,
          textColor: "#ffffff",
          volume: 1,
        })),
      },
    ],
  },
};
const assets: VideoEditorAsset[] = [0, 1].map((index) => ({
  id: `asset-${index}`,
  displayName: "视频",
  originalFilename: "video.mp4",
  mediaKind: "video",
  mimeType: "video/mp4",
  byteSize: 1,
  revision: 0,
  processingStatus: "ready",
  createdAt: "2026-10-24",
}));
const task: VideoEditorTask = {
  id: "merge-task",
  kind: "clip_merge",
  projectId: "project",
  requestId: "request-1",
  status: "completed",
  progress: 100,
  revision: 1,
  createdAt: "2026-10-24",
  updatedAt: "2026-10-24",
  outputAssetId: "out",
};
beforeEach(() => vi.resetAllMocks());

function show() {
  const commit = vi.fn().mockResolvedValue(undefined),
    onApplied = vi.fn(),
    onClose = vi.fn();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <VideoEditorClipMergeDialog
        projectId="project"
        timeline={timeline}
        assets={assets}
        clipIds={["clip-1", "clip-0"]}
        disabled={false}
        commit={commit}
        onApplied={onApplied}
        onClose={onClose}
      />
    </QueryClientProvider>,
  );
  return { ...result, commit, onApplied, onClose };
}

it("sorts selections and explains gaps and linked clips", () => {
  expect(
    clipMergeSelection(timeline, assets, ["clip-1", "clip-0"]).clips.map(
      (clip) => clip.id,
    ),
  ).toEqual(["clip-0", "clip-1"]);
  const next = structuredClone(timeline);
  next.document.tracks![0]!.clips![1]!.timelineStartUs += 1;
  expect(clipMergeSelection(next, assets, ["clip-0", "clip-1"]).error).toMatch(
    /连续/,
  );
  next.document.tracks![0]!.clips![1]!.linkGroupId = "linked";
  expect(clipMergeSelection(next, assets, ["clip-0", "clip-1"]).error).toMatch(
    /解除/,
  );
});

it("provides toolbar and context menu entry points for the whole selection", () => {
  const request = vi.fn();
  const result = render(
    <VideoEditorTimeline
      timeline={timeline}
      assets={[]}
      playheadUs={0}
      setPlayheadUs={vi.fn()}
      zoom={100}
      scrollLeft={0}
      onScrollLeftChange={vi.fn()}
      selectedClipIds={["clip-0", "clip-1"]}
      selectClip={vi.fn()}
      commit={vi.fn()}
      onDropAsset={vi.fn()}
      onRequestClipMerge={request}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "合并片段" }));
  expect(request).toHaveBeenLastCalledWith(["clip-0", "clip-1"]);
  fireEvent.contextMenu(
    result.container.querySelector('[data-clip-id="clip-0"]')!,
  );
  fireEvent.click(screen.getByRole("menuitem", { name: "合并片段" }));
  expect(request).toHaveBeenLastCalledWith(["clip-0", "clip-1"]);
});

it("applies once after ready, with a matching undo operation", async () => {
  vi.mocked(api.createVideoEditorClipMerge).mockResolvedValue(task);
  vi.mocked(api.getVideoEditorClipMerge).mockResolvedValue(task);
  const { commit, onApplied } = show();
  expect(screen.getByRole("textbox", { name: "合并名称" })).toHaveValue(
    "镜头0－合并",
  );
  fireEvent.click(screen.getByRole("button", { name: "开始合并" }));
  await waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1));
  expect(commit).toHaveBeenCalledTimes(1);
  const [[redo], [undo]] = commit.mock.calls[0]!;
  expect(redo).toMatchObject({ type: "applyClipMerge", taskId: task.id });
  expect(undo).toEqual({ ...redo, type: "undoClipMerge" });
});

it("cancels a running task without replacing clips", async () => {
  const running = { ...task, status: "running" as const };
  vi.mocked(api.createVideoEditorClipMerge).mockResolvedValue(running);
  vi.mocked(api.getVideoEditorClipMerge).mockResolvedValue(running);
  vi.mocked(api.cancelVideoEditorClipMerge).mockResolvedValue({
    ...running,
    status: "cancelled",
  });
  const { commit, onClose } = show();
  fireEvent.click(screen.getByRole("button", { name: "开始合并" }));
  fireEvent.click(await screen.findByRole("button", { name: "取消合并" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(commit).not.toHaveBeenCalled();
  expect(api.cancelVideoEditorClipMerge).toHaveBeenCalledWith(
    "project",
    task.id,
  );
});

it("retains generated output when replacement fails", async () => {
  vi.mocked(api.createVideoEditorClipMerge).mockResolvedValue(task);
  vi.mocked(api.getVideoEditorClipMerge).mockResolvedValue(task);
  const { commit, onApplied } = show();
  commit.mockRejectedValue(new Error("片段已变更"));
  fireEvent.click(screen.getByRole("button", { name: "开始合并" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("片段已变更");
  expect(onApplied).not.toHaveBeenCalled();
  expect(commit).toHaveBeenCalledTimes(1);
});
