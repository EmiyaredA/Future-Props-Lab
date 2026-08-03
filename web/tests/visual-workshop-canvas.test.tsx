import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { VisualWorkshopCanvasPage } from "@features/visual-workshop/VisualWorkshopCanvasPage";
import { getFiles, getFolders, uploadManagedFile } from "@features/files/api";
import {
  createGenerationTask,
  getGenerationTask,
  getVisualCanvas,
  getVisualWorkshopProject,
  patchVisualWorkshopProject,
  putVisualCanvas,
} from "@features/visual-workshop/api";
import { ApiError } from "@platform/api/client";

vi.mock("@features/files/AssetBrowser", () => ({
  AssetBrowser: ({ importMode }: { importMode?: boolean }) => (
    <div>{importMode ? "文件管理内容" : "项目素材内容"}</div>
  ),
}));
vi.mock("@features/files/api", async () => {
  const actual = await vi.importActual<typeof import("@features/files/api")>(
    "@features/files/api",
  );
  return {
    ...actual,
    getFiles: vi.fn(),
    getFolders: vi.fn(),
    uploadManagedFile: vi.fn(),
  };
});
vi.mock("@features/visual-workshop/api", async () => {
  const actual = await vi.importActual<
    typeof import("@features/visual-workshop/api")
  >("@features/visual-workshop/api");
  return {
    ...actual,
    createGenerationTask: vi.fn(),
    getGenerationTask: vi.fn(),
    getVisualCanvas: vi.fn(),
    getVisualWorkshopProject: vi.fn(),
    patchVisualWorkshopProject: vi.fn(),
    putVisualCanvas: vi.fn(),
  };
});

const project = {
  id: "project-1",
  title: "未命名项目",
  kind: "canvas" as const,
  status: "draft" as const,
  revision: 0,
  created_at: "2026-08-03T08:00:00Z",
  updated_at: "2026-08-03T08:00:00Z",
};

function renderCanvas() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <VisualWorkshopCanvasPage
        projectId="project-1"
        onBack={vi.fn()}
        onAssets={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(getVisualWorkshopProject).mockResolvedValue(project);
  vi.mocked(getVisualCanvas).mockResolvedValue({
    project_id: "project-1",
    nodes: [],
    revision: 0,
    updated_at: "2026-08-03T08:00:00Z",
  });
  vi.mocked(putVisualCanvas).mockImplementation(
    async (_projectId, nodes, expectedRevision) => ({
      project_id: "project-1",
      nodes,
      revision: expectedRevision + 1,
      updated_at: "2026-08-03T08:00:01Z",
    }),
  );
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
  vi.mocked(getFiles).mockResolvedValue({ items: [] });
  vi.mocked(uploadManagedFile).mockReset();
  vi.mocked(createGenerationTask).mockReset();
  vi.mocked(getGenerationTask).mockReset();
  vi.mocked(patchVisualWorkshopProject).mockImplementation(
    async (current, changes) => ({
      ...current,
      ...changes,
      revision: current.revision + 1,
    }),
  );
  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: vi.fn().mockRejectedValue(new Error("unsupported")),
  });
});

test("opens an Updream-style context menu and persists created nodes", async () => {
  const user = userEvent.setup();
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();
  const surface = container.querySelector(".visual-canvas-surface")!;

  fireEvent.contextMenu(surface, { clientX: 260, clientY: 220 });
  expect(screen.getByRole("menuitem", { name: "上传" })).toBeInTheDocument();
  expect(
    screen.getByRole("menuitem", { name: "添加音频节点" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "添加文本节点" }));

  expect(await screen.findByPlaceholderText("输入文本…")).toBeInTheDocument();
  await waitFor(() => expect(putVisualCanvas).toHaveBeenCalledTimes(1));
  const savedNodes = vi.mocked(putVisualCanvas).mock.calls[0]?.[1];
  expect(savedNodes?.[0]).toMatchObject({
    kind: "text",
    title: "文本1",
    position: { x: 260, y: 220 },
  });

  fireEvent.contextMenu(surface, { clientX: 420, clientY: 280 });
  await user.click(screen.getByRole("menuitem", { name: "添加图片节点" }));
  expect(
    await screen.findByRole("complementary", { name: "节点检查器" }),
  ).toBeVisible();
  expect(createGenerationTask).not.toHaveBeenCalled();
  expect(screen.getByRole("tab", { name: "AI 生成" })).toBeInTheDocument();
});

test("keeps the local draft visible when canvas CAS conflicts", async () => {
  vi.mocked(putVisualCanvas).mockRejectedValueOnce(
    new ApiError(
      "内容已被其他操作更新",
      {
        code: "revision_conflict",
        current: {
          project_id: "project-1",
          nodes: [],
          revision: 3,
          updated_at: "2026-08-03T08:10:00Z",
        },
      },
      409,
    ),
  );
  const user = userEvent.setup();
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();
  fireEvent.contextMenu(container.querySelector(".visual-canvas-surface")!, {
    clientX: 100,
    clientY: 120,
  });
  await user.click(screen.getByRole("menuitem", { name: "添加文本节点" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "画布存在更新冲突",
  );
  expect(screen.getByDisplayValue("文本1")).toBeInTheDocument();
});

test("zooms, opens project assets, renames, and falls back to immersive mode", async () => {
  const user = userEvent.setup();
  const { container } = renderCanvas();
  expect(await screen.findByText("未命名项目")).toBeInTheDocument();

  const surface = container.querySelector(".visual-canvas-surface")!;
  expect(surface).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "放大" }));
  expect(screen.getByRole("button", { name: "110%" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "素材库" }));
  expect(screen.getByText("项目素材内容")).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "文件管理" }));
  expect(screen.getByText("文件管理内容")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /未命名项目/ }));
  const title = screen.getByDisplayValue("未命名项目");
  await user.clear(title);
  await user.type(title, "秋季主视觉");
  fireEvent.blur(title);
  await waitFor(() =>
    expect(patchVisualWorkshopProject).toHaveBeenCalledWith(project, {
      title: "秋季主视觉",
    }),
  );

  await user.click(screen.getByRole("button", { name: "进入全屏" }));
  await waitFor(() =>
    expect(container.querySelector(".visual-canvas")).toHaveClass(
      "is-immersive",
    ),
  );
  fireEvent.keyDown(window, { key: "Escape" });
  expect(container.querySelector(".visual-canvas")).not.toHaveClass(
    "is-immersive",
  );
});
