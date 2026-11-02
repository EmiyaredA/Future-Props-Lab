import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { fetchApiBlob } from "@platform/api/client";
import { AssetBrowser } from "@features/files/AssetBrowser";
import {
  createFolder,
  deleteFolder,
  deleteManagedFile,
  getFiles,
  getFilePreview,
  getFolders,
  importFile,
  importLibraryAssets,
  patchFolder,
  patchManagedFile,
  uploadManagedFile,
} from "@features/files/api";

vi.mock("@features/files/api", async () => {
  const actual = await vi.importActual<typeof import("@features/files/api")>(
    "@features/files/api",
  );
  return {
    ...actual,
    createFolder: vi.fn(),
    deleteFolder: vi.fn(),
    deleteManagedFile: vi.fn(),
    getFiles: vi.fn(),
    getFilePreview: vi.fn(),
    getFolders: vi.fn(),
    importFile: vi.fn(),
    importLibraryAssets: vi.fn(),
    patchFolder: vi.fn(),
    patchManagedFile: vi.fn(),
    uploadManagedFile: vi.fn(),
  };
});

vi.mock("@platform/api/client", () => ({
  fetchApiBlob: vi.fn(),
}));

const libraryFile = {
  id: "file-1",
  project_id: null,
  folder_id: null,
  original_filename: "story.md",
  display_name: "故事说明.md",
  media_kind: "document" as const,
  mime_type: "text/markdown",
  byte_size: 128,
  revision: 0,
  created_at: "2026-08-03T08:00:00Z",
  updated_at: "2026-08-03T08:00:00Z",
  source: "library" as const,
  is_reference: false,
  reference_id: null,
};

const folderA = {
  id: "folder-a",
  project_id: null,
  parent_id: null,
  name: "A 文件夹",
  revision: 0,
  created_at: "2026-08-01T08:00:00Z",
  updated_at: "2026-08-01T08:00:00Z",
};

const folderB = {
  ...folderA,
  id: "folder-b",
  name: "B 文件夹",
  created_at: "2026-08-03T08:00:00Z",
  updated_at: "2026-08-03T08:00:00Z",
};

function renderBrowser() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AssetBrowser projectId="project-1" importSource="library" />
    </QueryClientProvider>,
  );
}

function renderLibraryBrowser() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AssetBrowser />
    </QueryClientProvider>,
  );
}

function renderProjectBrowser(compact = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AssetBrowser projectId="project-1" compact={compact} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:file-download"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLAnchorElement.prototype, "click", {
    configurable: true,
    value: vi.fn(),
  });
  window.localStorage.clear();
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
  vi.mocked(getFiles).mockResolvedValue({ items: [libraryFile] });
  vi.mocked(getFilePreview).mockResolvedValue({
    kind: "text",
    text: "故事说明正文",
    truncated: false,
  });
  vi.mocked(fetchApiBlob).mockResolvedValue(
    new Blob(["story"], { type: "text/markdown" }),
  );
  vi.mocked(createFolder).mockResolvedValue(folderA);
  vi.mocked(patchFolder).mockImplementation(async (folder, changes) => ({
    ...folder,
    name: changes.name ?? folder.name,
    parent_id:
      changes.move_to_root === true
        ? null
        : changes.parent_id === undefined
          ? folder.parent_id
          : changes.parent_id,
    revision: folder.revision + 1,
  }));
  vi.mocked(deleteFolder).mockResolvedValue({ deleted: true });
  vi.mocked(patchManagedFile).mockImplementation(async (file, changes) => ({
    ...file,
    display_name: changes.display_name ?? file.display_name,
    folder_id:
      changes.move_to_root === true
        ? null
        : changes.folder_id === undefined
          ? file.folder_id
          : changes.folder_id,
    revision: file.revision + 1,
  }));
  vi.mocked(deleteManagedFile).mockResolvedValue({ deleted: true });
  vi.mocked(importFile).mockResolvedValue({
    ...libraryFile,
    project_id: "project-1",
    is_reference: true,
    reference_id: "reference-1",
  });
  vi.mocked(uploadManagedFile).mockResolvedValue(libraryFile);
});

test("uses styled filters and keeps successful upload feedback concise", async () => {
  const user = userEvent.setup();
  const { container } = renderLibraryBrowser();
  expect(await screen.findByText("故事说明")).toBeInTheDocument();
  expect(container.querySelector(".file-upload-card")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "上传文件" })).toBeInTheDocument();
  expect(screen.getByLabelText("选择要上传的文件")).toHaveAttribute(
    "accept",
    expect.stringContaining(".json"),
  );

  await user.click(screen.getByRole("combobox", { name: "文件类型" }));
  await user.click(screen.getByRole("option", { name: "图片" }));
  await waitFor(() =>
    expect(getFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ mediaKind: "image" }),
    ),
  );

  const image = new File(["image"], "poster.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("选择要上传的文件"), image);
  await waitFor(() =>
    expect(uploadManagedFile).toHaveBeenCalledWith(
      image,
      undefined,
      undefined,
      undefined,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    ),
  );
  expect(await screen.findByText("已成功上传 1 个文件")).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "上传状态" })).toBeNull();
});

test("uploads JSON documents from file management", async () => {
  const user = userEvent.setup();
  renderLibraryBrowser();
  expect(await screen.findByText("故事说明")).toBeInTheDocument();

  const transcript = new File(
    ['{"text":"广播剧转写","segments":[]}'],
    "广播剧音频转写.json",
    { type: "application/json" },
  );
  await user.upload(screen.getByLabelText("选择要上传的文件"), transcript);

  await waitFor(() =>
    expect(uploadManagedFile).toHaveBeenCalledWith(
      transcript,
      undefined,
      undefined,
      undefined,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    ),
  );
});

test("filters and sorts folders alongside files", async () => {
  const user = userEvent.setup();
  vi.mocked(getFolders).mockResolvedValue({ items: [folderA, folderB] });
  vi.mocked(getFiles).mockResolvedValue({ items: [] });
  const { container } = renderLibraryBrowser();

  expect(await screen.findByText("A 文件夹")).toBeInTheDocument();
  const folderNames = () =>
    Array.from(
      container.querySelectorAll(".file-folder-item .file-item-copy > strong"),
    ).map((item) => item.textContent);
  expect(folderNames()).toEqual(["B 文件夹", "A 文件夹"]);

  await user.click(screen.getByRole("combobox", { name: "文件排序" }));
  await user.click(screen.getByRole("option", { name: "按名称" }));
  await waitFor(() => expect(folderNames()).toEqual(["A 文件夹", "B 文件夹"]));

  await user.type(screen.getByLabelText("搜索文件或文件夹"), "A");
  expect(screen.getByText("A 文件夹")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("B 文件夹")).toBeNull());
});

test("keeps uploading remaining files and explains a failed video upload", async () => {
  const user = userEvent.setup();
  vi.mocked(uploadManagedFile)
    .mockResolvedValueOnce(libraryFile)
    .mockRejectedValueOnce(new Error("文件内容与声明的类型不匹配"));
  renderLibraryBrowser();
  expect(await screen.findByText("故事说明")).toBeInTheDocument();

  const image = new File(["image"], "poster.png", { type: "image/png" });
  const video = new File(["video"], "trailer.mp4", { type: "video/mp4" });
  await user.upload(screen.getByLabelText("选择要上传的文件"), [image, video]);

  expect(
    await screen.findByText("已上传 1 个文件，1 个失败"),
  ).toBeInTheDocument();
  expect(screen.getByText("失败详情")).toBeInTheDocument();
  expect(screen.getByText("文件内容与声明的类型不匹配")).toBeInTheDocument();
  expect(screen.queryByText("上传成功")).toBeNull();
  expect(uploadManagedFile).toHaveBeenCalledTimes(2);
});

test("switches file layouts, remembers the choice, and imports a library file", async () => {
  const user = userEvent.setup();
  const { container } = renderBrowser();
  expect(await screen.findByText("故事说明")).toBeInTheDocument();
  expect(container.querySelector(".file-items")).toHaveClass("grid");
  await user.click(screen.getByRole("button", { name: "列表视图" }));
  expect(container.querySelector(".file-items")).toHaveClass("list");
  expect(window.localStorage.getItem("fpl_file_browser_view")).toBe("list");

  expect(
    screen.getByRole("button", { name: "新建文件夹" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "导入" }));
  await waitFor(() =>
    expect(importFile).toHaveBeenCalledWith("project-1", "file-1"),
  );
  expect(await screen.findByText("已导入当前项目")).toBeInTheDocument();
});

test("manages the shared library while importing from the library tab", async () => {
  const user = userEvent.setup();
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
  vi.mocked(getFiles).mockResolvedValue({ items: [] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AssetBrowser projectId="project-1" importSource="library" compact />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("文件管理中还没有文件")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "上传第一个文件" }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "添加素材" }));
  expect(
    screen.getByRole("menuitem", { name: "上传本地文件" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("menuitem", { name: "从本项目选取" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("menuitem", { name: "从跨项目选取" }),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));
  expect(
    screen.getByRole("dialog", { name: "新建文件夹" }),
  ).toBeInTheDocument();
  await user.type(
    screen.getByRole("textbox", { name: "文件夹名称" }),
    "公共灵感",
  );
  await user.click(screen.getByRole("button", { name: "创建文件夹" }));
  await waitFor(() =>
    expect(createFolder).toHaveBeenCalledWith("公共灵感", undefined, undefined),
  );
});

test("stages local library uploads so the display name can be edited", async () => {
  const user = userEvent.setup();
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
  vi.mocked(getFiles).mockResolvedValue({ items: [] });
  vi.mocked(uploadManagedFile).mockResolvedValue(libraryFile);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AssetBrowser
        projectId="project-1"
        importSource="library"
        compact
        sourceProjects={[{ id: "project-2", title: "其他项目" }]}
      />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("文件管理中还没有文件")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "添加素材" }));
  await user.click(screen.getByRole("menuitem", { name: "上传本地文件" }));
  const image = new File(["png"], "poster.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("选择要上传的文件"), image);

  expect(
    await screen.findByRole("dialog", { name: "确认上传并改名" }),
  ).toBeInTheDocument();
  const nameInput = screen.getByRole("textbox", { name: /显示名称/ });
  expect(nameInput).toHaveValue("poster");
  await user.clear(nameInput);
  await user.type(nameInput, "库内海报");
  await user.click(screen.getByRole("button", { name: "确认添加（1）" }));
  await waitFor(() =>
    expect(uploadManagedFile).toHaveBeenCalledWith(
      image,
      undefined,
      undefined,
      "库内海报",
      expect.objectContaining({ onProgress: expect.any(Function) }),
    ),
  );
  expect(importLibraryAssets).not.toHaveBeenCalled();
});

test("uses the compact asset controls without losing upload and folder actions", async () => {
  const user = userEvent.setup();
  renderProjectBrowser(true);
  expect(await screen.findByText("故事说明")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("搜索素材")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "筛选素材" }));
  expect(screen.getByRole("dialog", { name: "素材筛选" })).toBeInTheDocument();
  await user.click(screen.getByRole("combobox", { name: "文件类型" }));
  await user.click(screen.getByRole("option", { name: "图片" }));
  await waitFor(() =>
    expect(getFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ mediaKind: "image" }),
    ),
  );

  await user.click(screen.getByRole("button", { name: "添加素材" }));
  await user.click(screen.getByRole("menuitem", { name: "新建文件夹" }));
  expect(
    screen.getByRole("dialog", { name: "新建文件夹" }),
  ).toBeInTheDocument();
});

test("uses custom dialogs for creating, renaming, moving, and deleting folders", async () => {
  const user = userEvent.setup();
  const promptSpy = vi.spyOn(window, "prompt");
  const confirmSpy = vi.spyOn(window, "confirm");
  vi.mocked(getFolders).mockResolvedValue({ items: [folderA, folderB] });
  vi.mocked(getFiles).mockResolvedValue({ items: [] });
  renderLibraryBrowser();
  expect(await screen.findByText("A 文件夹")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "新建文件夹" }));
  expect(
    screen.getByRole("dialog", { name: "新建文件夹" }),
  ).toBeInTheDocument();
  await user.type(
    screen.getByRole("textbox", { name: "文件夹名称" }),
    "灵感素材",
  );
  await user.click(screen.getByRole("button", { name: "创建文件夹" }));
  await waitFor(() =>
    expect(createFolder).toHaveBeenCalledWith("灵感素材", undefined, undefined),
  );

  await user.click(screen.getByRole("button", { name: "更多操作 A 文件夹" }));
  await user.click(screen.getByRole("menuitem", { name: "重命名" }));
  const renameInput = screen.getByRole("textbox", { name: "新名称" });
  await user.clear(renameInput);
  await user.type(renameInput, "归档素材");
  await user.click(screen.getByRole("button", { name: "保存名称" }));
  await waitFor(() =>
    expect(patchFolder).toHaveBeenCalledWith(folderA, { name: "归档素材" }),
  );

  await user.click(screen.getByRole("button", { name: "更多操作 A 文件夹" }));
  await user.click(screen.getByRole("menuitem", { name: "移动到" }));
  await user.click(screen.getByRole("combobox", { name: "目标文件夹" }));
  await user.click(screen.getByRole("option", { name: "B 文件夹" }));
  await user.click(screen.getByRole("button", { name: "确认移动" }));
  await waitFor(() =>
    expect(patchFolder).toHaveBeenCalledWith(folderA, {
      parent_id: "folder-b",
    }),
  );

  await user.click(screen.getByRole("button", { name: "更多操作 A 文件夹" }));
  await user.click(screen.getByRole("menuitem", { name: "删除" }));
  expect(
    screen.getByText(/其中全部文件和子文件夹后将无法恢复/),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(deleteFolder).toHaveBeenCalledWith(folderA));

  expect(promptSpy).not.toHaveBeenCalled();
  expect(confirmSpy).not.toHaveBeenCalled();
  promptSpy.mockRestore();
  confirmSpy.mockRestore();
});

test("keeps file download visible and moves secondary actions into a dismissible menu", async () => {
  const user = userEvent.setup();
  renderLibraryBrowser();
  expect(await screen.findByText("故事说明")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下载" })).toBeInTheDocument();

  let downloadAnchor: HTMLAnchorElement | undefined;
  const originalCreateElement = document.createElement.bind(document);
  const createElementSpy = vi.spyOn(document, "createElement");
  createElementSpy.mockImplementation(((
    tagName: string,
    options?: ElementCreationOptions,
  ) => {
    const element = originalCreateElement(tagName, options);
    if (tagName.toLocaleLowerCase() === "a") {
      downloadAnchor = element as HTMLAnchorElement;
    }
    return element;
  }) as typeof document.createElement);

  await user.click(screen.getByRole("button", { name: "更多操作 故事说明" }));
  expect(screen.getByRole("menu")).toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "下载" }));
  await waitFor(() =>
    expect(fetchApiBlob).toHaveBeenCalledWith(
      "/v1/files/file-1/download",
      expect.objectContaining({ onProgress: expect.any(Function) }),
    ),
  );
  expect(downloadAnchor?.download).toBe("故事说明.md");
  createElementSpy.mockRestore();

  await user.click(screen.getByRole("button", { name: "更多操作 故事说明" }));
  expect(screen.getByRole("menu")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();

  await user.click(screen.getByRole("button", { name: "更多操作 故事说明" }));
  await user.click(screen.getByRole("menuitem", { name: "删除" }));
  expect(screen.getByText("删除“故事说明”后将无法恢复。")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() =>
    expect(deleteManagedFile).toHaveBeenCalledWith(libraryFile),
  );
});

test("explains reference removal without implying the source file is deleted", async () => {
  const user = userEvent.setup();
  const referenceFile = {
    ...libraryFile,
    project_id: "project-1",
    source: "library" as const,
    is_reference: true,
    reference_id: "reference-1",
  };
  vi.mocked(getFiles).mockResolvedValue({ items: [referenceFile] });
  renderProjectBrowser();
  expect(await screen.findByText("故事说明")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "更多操作 故事说明" }));
  await user.click(screen.getByRole("menuitem", { name: "移除引用" }));
  expect(
    screen.getByText(
      "只会从当前项目移除引用，文件管理中的源文件不会受到影响。",
    ),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "移除引用" }));
  await waitFor(() =>
    expect(deleteManagedFile).toHaveBeenCalledWith(referenceFile),
  );
});

test("opens an inline preview when a file card is clicked", async () => {
  const user = userEvent.setup();
  const imageFile = {
    ...libraryFile,
    id: "image-1",
    original_filename: "persona.png",
    display_name: "人设图3.png",
    media_kind: "image" as const,
    mime_type: "image/png",
  };
  vi.mocked(getFiles).mockResolvedValue({ items: [imageFile] });
  vi.mocked(fetchApiBlob).mockResolvedValue(
    new Blob(["png"], { type: "image/png" }),
  );
  const { container } = renderProjectBrowser(true);

  expect(await screen.findByText("人设图3")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "预览 人设图3" }));

  const preview = screen.getByRole("dialog", { name: "人设图3" });
  expect(preview).toBeInTheDocument();
  expect(container).not.toContainElement(preview);
  expect(preview).toHaveClass("file-content-dialog");
  expect(preview.parentElement).toBe(document.body);
  await waitFor(() =>
    expect(fetchApiBlob).toHaveBeenCalledWith(
      expect.stringContaining("/v1/files/image-1/thumbnail?size=1280"),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ),
  );
  expect(await screen.findByRole("img", { name: "人设图3" })).toHaveAttribute(
    "src",
    "blob:file-download",
  );

  await user.click(screen.getByRole("button", { name: "关闭预览" }));
  expect(screen.queryByRole("dialog", { name: "人设图3" })).toBeNull();
});

test("keeps the compact drawer layout and its upload menu entry", async () => {
  const user = userEvent.setup();
  const { container } = renderProjectBrowser(true);
  expect(await screen.findByText("故事说明")).toBeInTheDocument();
  expect(container.querySelector(".file-upload-card")).toBeNull();
  await user.click(screen.getByRole("button", { name: "添加素材" }));
  expect(
    screen.getByRole("menuitem", { name: "上传文件" }),
  ).toBeInTheDocument();
});

test("only enables canvas drag for media when onAssetDragStart is provided", async () => {
  const onAssetDragStart = vi.fn();
  vi.mocked(getFiles).mockResolvedValue({
    items: [
      {
        ...libraryFile,
        id: "image-drag",
        display_name: "可拖图",
        original_filename: "drag.png",
        media_kind: "image",
        mime_type: "image/png",
        project_id: "project-1",
        source: "project",
      },
      {
        ...libraryFile,
        id: "font-drag",
        display_name: "字体",
        original_filename: "font.ttf",
        media_kind: "font",
        mime_type: "font/ttf",
        project_id: "project-1",
        source: "project",
      },
    ],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AssetBrowser
        projectId="project-1"
        compact
        onAssetDragStart={onAssetDragStart}
      />
    </QueryClientProvider>,
  );

  expect(await screen.findByText("可拖图")).toBeInTheDocument();
  const imageButton = screen.getByRole("button", {
    name: "预览或拖到画布：可拖图",
  });
  expect(imageButton).toHaveAttribute("draggable", "true");
  expect(imageButton.closest(".file-asset-item")).toHaveClass(
    "is-canvas-draggable",
  );

  const fontButton = screen.getByRole("button", { name: "预览 字体" });
  expect(fontButton).toHaveAttribute("draggable", "false");
  expect(fontButton.closest(".file-asset-item")).not.toHaveClass(
    "is-canvas-draggable",
  );
});
