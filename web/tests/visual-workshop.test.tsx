import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { VisualWorkshopProjectsPage } from "@features/visual-workshop/projects";
import {
  createVisualWorkshopProject,
  deleteVisualWorkshopProject,
  exportVisualWorkshopProjectSnapshot,
  getVisualWorkshopProjects,
  importVisualWorkshopProjectSnapshot,
  openVisualWorkshopProjectFolder,
  patchVisualWorkshopProject,
} from "@features/visual-workshop/api";

vi.mock("@features/visual-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/visual-workshop/api")
  >("@features/visual-workshop/api");
  return {
    ...actual,
    createVisualWorkshopProject: vi.fn(),
    deleteVisualWorkshopProject: vi.fn(),
    exportVisualWorkshopProjectSnapshot: vi.fn(),
    getVisualWorkshopProjects: vi.fn(),
    importVisualWorkshopProjectSnapshot: vi.fn(),
    openVisualWorkshopProjectFolder: vi.fn(),
    patchVisualWorkshopProject: vi.fn(),
  };
});

const project = {
  id: "project-1",
  title: "产品主视觉",
  kind: "image" as const,
  status: "draft" as const,
  revision: 0,
  created_at: "2026-08-03T08:00:00Z",
  updated_at: "2026-08-03T08:00:00Z",
};

function renderPage(options?: {
  onOpenProject?: (projectId: string) => void;
  onOpenAssets?: (projectId: string) => void;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <VisualWorkshopProjectsPage
        onOpenProject={options?.onOpenProject}
        onOpenAssets={options?.onOpenAssets}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(getVisualWorkshopProjects).mockResolvedValue({ items: [] });
  vi.mocked(createVisualWorkshopProject).mockResolvedValue(project);
  vi.mocked(patchVisualWorkshopProject).mockImplementation(
    async (current, changes) => ({
      ...current,
      ...changes,
      revision: current.revision + 1,
      updated_at: "2026-08-03T09:00:00Z",
    }),
  );
  vi.mocked(deleteVisualWorkshopProject).mockResolvedValue({ deleted: true });
  vi.mocked(exportVisualWorkshopProjectSnapshot).mockResolvedValue({
    blob: new Blob(["snapshot"]),
    filename: "visual-workshop-snapshot.zip",
  });
  vi.mocked(importVisualWorkshopProjectSnapshot).mockResolvedValue({
    project: { ...project, id: "project-copy", title: "产品主视觉（副本）" },
    warnings: [],
  });
  vi.mocked(openVisualWorkshopProjectFolder).mockResolvedValue({
    opened: true,
  });
});

test("creates an unnamed canvas project and opens it without a dialog", async () => {
  const user = userEvent.setup();
  const onOpenProject = vi.fn();
  renderPage({ onOpenProject });
  expect(await screen.findByText("还没有创作项目")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /新建第一个项目/ }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await waitFor(() =>
    expect(createVisualWorkshopProject).toHaveBeenCalledWith(
      "未命名项目",
      "canvas",
    ),
  );
  expect(onOpenProject).toHaveBeenCalledWith("project-1");
});

test("renames, completes, restores, filters, and deletes projects", async () => {
  vi.mocked(getVisualWorkshopProjects).mockResolvedValueOnce({
    items: [project],
  });
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findByText("产品主视觉")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "重命名" }));
  const name = screen.getByLabelText("项目名称");
  await user.clear(name);
  await user.type(name, "新版主视觉");
  await user.click(screen.getByRole("button", { name: "保存名称" }));
  expect(await screen.findByText("新版主视觉")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "完成" }));
  expect(
    await screen.findByRole("button", { name: "恢复" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "已完成" }));
  expect(screen.getByText("新版主视觉")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "恢复" }));
  await user.click(screen.getByRole("button", { name: "全部" }));
  await user.click(screen.getByRole("button", { name: "删除" }));
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(deleteVisualWorkshopProject).toHaveBeenCalled());
  expect(await screen.findByText("还没有创作项目")).toBeInTheDocument();
});

test("imports, exports, and opens a visual project snapshot", async () => {
  vi.mocked(getVisualWorkshopProjects).mockResolvedValueOnce({
    items: [project],
  });
  const createObjectURL = vi.fn(() => "blob:snapshot");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
  const onOpenProject = vi.fn();
  const user = userEvent.setup();
  renderPage({ onOpenProject });
  expect(await screen.findByText("产品主视觉")).toBeInTheDocument();

  await user.click(
    screen.getByRole("button", { name: "导出“产品主视觉”项目快照" }),
  );
  await waitFor(() =>
    expect(exportVisualWorkshopProjectSnapshot).toHaveBeenCalledWith(
      "project-1",
    ),
  );
  expect(createObjectURL).toHaveBeenCalled();
  expect(click).toHaveBeenCalled();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:snapshot");

  await user.click(
    screen.getByRole("button", { name: "打开“产品主视觉”项目文件夹" }),
  );
  await waitFor(() =>
    expect(openVisualWorkshopProjectFolder).toHaveBeenCalledWith("project-1"),
  );
  await user.upload(
    screen.getByLabelText("选择项目快照压缩包"),
    new File(["zip"], "project.zip", { type: "application/zip" }),
  );
  await waitFor(() =>
    expect(importVisualWorkshopProjectSnapshot).toHaveBeenCalled(),
  );
  expect(onOpenProject).toHaveBeenCalledWith("project-copy");
});
