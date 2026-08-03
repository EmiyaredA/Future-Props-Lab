import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { AssetBrowser } from "@features/files/AssetBrowser";
import {
  getFiles,
  getFolders,
  importFile,
  uploadManagedFile,
} from "@features/files/api";

vi.mock("@features/files/api", async () => {
  const actual = await vi.importActual<typeof import("@features/files/api")>(
    "@features/files/api",
  );
  return {
    ...actual,
    getFiles: vi.fn(),
    getFolders: vi.fn(),
    importFile: vi.fn(),
    uploadManagedFile: vi.fn(),
  };
});

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

function renderBrowser() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AssetBrowser projectId="project-1" importMode />
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

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
  vi.mocked(getFiles).mockResolvedValue({ items: [libraryFile] });
  vi.mocked(importFile).mockResolvedValue({
    ...libraryFile,
    project_id: "project-1",
    is_reference: true,
    reference_id: "reference-1",
  });
  vi.mocked(uploadManagedFile).mockResolvedValue(libraryFile);
});

test("uses styled filters and shows file upload success feedback", async () => {
  const user = userEvent.setup();
  renderLibraryBrowser();
  expect(await screen.findByText("故事说明.md")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "文件类型" }));
  await user.click(screen.getByRole("option", { name: "图片" }));
  await waitFor(() =>
    expect(getFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ mediaKind: "image" }),
    ),
  );

  const image = new File(["image"], "poster.png", { type: "image/png" });
  await user.upload(screen.getByLabelText("选择要上传的文件"), image);
  await waitFor(() =>
    expect(uploadManagedFile).toHaveBeenCalledWith(image, undefined, undefined),
  );
  expect(await screen.findByText("已成功上传 1 个文件")).toBeInTheDocument();
  expect(screen.getByText("上传成功")).toBeInTheDocument();
});

test("keeps uploading remaining files and explains a failed video upload", async () => {
  const user = userEvent.setup();
  vi.mocked(uploadManagedFile)
    .mockResolvedValueOnce(libraryFile)
    .mockRejectedValueOnce(new Error("文件内容与声明的类型不匹配"));
  renderLibraryBrowser();
  expect(await screen.findByText("故事说明.md")).toBeInTheDocument();

  const image = new File(["image"], "poster.png", { type: "image/png" });
  const video = new File(["video"], "trailer.mp4", { type: "video/mp4" });
  await user.upload(screen.getByLabelText("选择要上传的文件"), [image, video]);

  expect(
    await screen.findByText("已上传 1 个文件，1 个失败"),
  ).toBeInTheDocument();
  expect(screen.getByText("文件内容与声明的类型不匹配")).toBeInTheDocument();
  expect(uploadManagedFile).toHaveBeenCalledTimes(2);
});

test("switches file layouts, remembers the choice, and imports a library file", async () => {
  const user = userEvent.setup();
  const { container } = renderBrowser();
  expect(await screen.findByText("故事说明.md")).toBeInTheDocument();
  expect(container.querySelector(".file-items")).toHaveClass("grid");
  await user.click(screen.getByRole("button", { name: "列表视图" }));
  expect(container.querySelector(".file-items")).toHaveClass("list");
  expect(window.localStorage.getItem("fpl_file_browser_view")).toBe("list");

  await user.click(screen.getByRole("button", { name: "导入" }));
  await waitFor(() =>
    expect(importFile).toHaveBeenCalledWith("project-1", "file-1"),
  );
  expect(await screen.findByText("已导入当前项目")).toBeInTheDocument();
});
