import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { VideoEditorTasksPage } from "@features/video-editor/VideoEditorTasksPage";
import { WorkspacePermissionsProvider } from "@platform/auth/WorkspacePermissions";
import * as api from "@features/video-editor/api";
import type { VideoEditorTask } from "@features/video-editor/types";

vi.mock("@features/video-editor/api", async (original) => ({
  ...(await original<typeof api>()),
  listVideoEditorProjects: vi.fn(),
  listVideoEditorRenders: vi.fn(),
  listVideoEditorSegmentExports: vi.fn(),
  listVideoEditorClipMerges: vi.fn().mockResolvedValue({ items: [] }),
  deleteVideoEditorRender: vi.fn(),
}));

const task: VideoEditorTask = {
  id: "render",
  projectId: "project",
  requestId: "request",
  kind: "render",
  status: "completed",
  progress: 100,
  revision: 8,
  outputAssetId: "asset",
  resultDetail: { outputFilename: "我的成片.mp4" },
  createdAt: "2026-09-10T01:00:00Z",
  updatedAt: "2026-09-10T01:00:00Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listVideoEditorClipMerges).mockResolvedValue({ items: [] });
  vi.mocked(api.listVideoEditorProjects).mockResolvedValue({
    items: [
      {
        id: "project",
        title: "工程",
        status: "draft",
        revision: 0,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
      },
    ],
  });
  vi.mocked(api.listVideoEditorRenders).mockResolvedValue({ items: [task] });
  vi.mocked(api.listVideoEditorSegmentExports).mockResolvedValue({ items: [] });
});

function show(permissions = ["content.write"]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <WorkspacePermissionsProvider permissions={permissions}>
        <VideoEditorTasksPage onOpenProject={vi.fn()} />
      </WorkspacePermissionsProvider>
    </QueryClientProvider>,
  );
}

it("confirms deletion, supports Escape, and refreshes the task list and count", async () => {
  const user = userEvent.setup();
  show();
  await user.click(
    await screen.findByRole("button", { name: "删除“我的成片.mp4”" }),
  );
  expect(screen.getByRole("alertdialog")).toHaveTextContent(
    "剪辑工程和源素材会保留",
  );
  await user.keyboard("{Escape}");
  expect(api.deleteVideoEditorRender).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "删除“我的成片.mp4”" }));
  vi.mocked(api.deleteVideoEditorRender).mockImplementation(async () => {
    vi.mocked(api.listVideoEditorRenders).mockResolvedValue({ items: [] });
    return { deleted: true };
  });
  await user.click(
    within(screen.getByRole("alertdialog")).getByRole("button", {
      name: "确认删除",
    }),
  );
  await screen.findByText("还没有渲染任务");
  expect(api.deleteVideoEditorRender).toHaveBeenCalledWith(
    task,
    expect.anything(),
  );
  expect(screen.getByRole("button", { name: /全部任务/ })).toHaveTextContent(
    "0",
  );
});

it("keeps the task and displays a deletion error in the dialog", async () => {
  vi.mocked(api.deleteVideoEditorRender).mockRejectedValue(
    new Error("素材仍被时间轴引用"),
  );
  const user = userEvent.setup();
  show();
  await user.click(
    await screen.findByRole("button", { name: "删除“我的成片.mp4”" }),
  );
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "素材仍被时间轴引用",
  );
  expect(screen.getByRole("article")).toBeInTheDocument();
  expect(screen.getByRole("alertdialog")).toBeInTheDocument();
});

it("hides deletion for readers and active tasks", async () => {
  show([]);
  await screen.findByRole("article");
  expect(
    screen.queryByRole("button", { name: /删除/ }),
  ).not.toBeInTheDocument();
});

it("does not expose deletion for an active render", async () => {
  vi.mocked(api.listVideoEditorRenders).mockResolvedValue({
    items: [{ ...task, status: "running" }],
  });
  show();
  await waitFor(() =>
    expect(screen.getByRole("progressbar")).toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("button", { name: /删除/ }),
  ).not.toBeInTheDocument();
});
