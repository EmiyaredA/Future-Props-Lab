import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { GalgameWorkshopProjectsPage } from "@features/galgame-workshop/projects";
import {
  createGalgameWorkshopProject,
  deleteGalgameWorkshopProject,
  exportGalgameWorkshopProjectSnapshot,
  getGalgameWorkshopProjects,
  importGalgameWorkshopProjectSnapshot,
  openGalgameWorkshopProjectFolder,
  patchGalgameWorkshopProject,
} from "@features/galgame-workshop/api";

vi.mock("@features/galgame-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/galgame-workshop/api")
  >("@features/galgame-workshop/api");
  return {
    ...actual,
    createGalgameWorkshopProject: vi.fn(),
    deleteGalgameWorkshopProject: vi.fn(),
    exportGalgameWorkshopProjectSnapshot: vi.fn(),
    getGalgameWorkshopProjects: vi.fn(),
    importGalgameWorkshopProjectSnapshot: vi.fn(),
    openGalgameWorkshopProjectFolder: vi.fn(),
    patchGalgameWorkshopProject: vi.fn(),
  };
});

const project = {
  id: "project-1",
  title: "命运石之门",
  status: "draft" as const,
  revision: 0,
  created_at: "2026-08-05T08:00:00Z",
  updated_at: "2026-08-05T08:00:00Z",
};

function renderPage(options?: { onOpenProject?: (projectId: string) => void }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <GalgameWorkshopProjectsPage onOpenProject={options?.onOpenProject} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getGalgameWorkshopProjects).mockResolvedValue({ items: [] });
  vi.mocked(createGalgameWorkshopProject).mockResolvedValue(project);
  vi.mocked(patchGalgameWorkshopProject).mockImplementation(
    async (current, changes) => ({
      ...current,
      ...changes,
      revision: current.revision + 1,
      updated_at: "2026-08-05T09:00:00Z",
    }),
  );
  vi.mocked(deleteGalgameWorkshopProject).mockResolvedValue({ deleted: true });
  vi.mocked(exportGalgameWorkshopProjectSnapshot).mockResolvedValue({
    blob: new Blob(["snapshot"]),
    filename: "galgame-snapshot.zip",
  });
  vi.mocked(importGalgameWorkshopProjectSnapshot).mockResolvedValue({
    project: { ...project, id: "project-copy", title: "命运石之门（副本）" },
    warnings: [],
  });
  vi.mocked(openGalgameWorkshopProjectFolder).mockResolvedValue({
    opened: true,
  });
});

test("creates an unnamed project and opens overview without a dialog", async () => {
  const user = userEvent.setup();
  const onOpenProject = vi.fn();
  renderPage({ onOpenProject });
  expect(await screen.findByText("还没有 Galgame 工程")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /新建第一个工程/ }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(createGalgameWorkshopProject).toHaveBeenCalledWith("未命名工程"),
  );
  expect(onOpenProject).toHaveBeenCalledWith("project-1");
});

test("renames, completes, restores, searches, and deletes projects", async () => {
  vi.mocked(getGalgameWorkshopProjects).mockResolvedValueOnce({
    items: [project],
  });
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findByText("命运石之门")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重命名" }));
  const name = screen.getByLabelText("工程名称");
  await user.clear(name);
  await user.type(name, "新版工程");
  await user.click(screen.getByRole("button", { name: "保存名称" }));
  expect(await screen.findByText("新版工程")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "完成" }));
  expect(
    await screen.findByRole("button", { name: "恢复" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("group", { name: "工程状态" }),
  ).not.toBeInTheDocument();
  const search = screen.getByRole("textbox", { name: "搜索工程" });
  await user.type(search, "不存在");
  expect(screen.queryByText("新版工程")).not.toBeInTheDocument();
  await user.clear(search);
  expect(screen.getByText("新版工程")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "恢复" }));
  await user.click(screen.getByRole("button", { name: "删除" }));
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(deleteGalgameWorkshopProject).toHaveBeenCalled());
  expect(await screen.findByText("还没有 Galgame 工程")).toBeInTheDocument();
});

test("imports and opens a Galgame snapshot copy", async () => {
  vi.mocked(getGalgameWorkshopProjects).mockResolvedValueOnce({
    items: [project],
  });
  const onOpenProject = vi.fn();
  const user = userEvent.setup();
  renderPage({ onOpenProject });
  expect(await screen.findByText("命运石之门")).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "打开“命运石之门”项目文件夹" }),
  );
  await waitFor(() =>
    expect(openGalgameWorkshopProjectFolder).toHaveBeenCalledWith("project-1"),
  );
  await user.upload(
    screen.getByLabelText("选择项目快照压缩包"),
    new File(["zip"], "story.zip", { type: "application/zip" }),
  );
  await waitFor(() =>
    expect(importGalgameWorkshopProjectSnapshot).toHaveBeenCalled(),
  );
  expect(onOpenProject).toHaveBeenCalledWith("project-copy");
  expect(
    screen.getByRole("button", { name: "导出“命运石之门”项目快照" }),
  ).toBeEnabled();
});
