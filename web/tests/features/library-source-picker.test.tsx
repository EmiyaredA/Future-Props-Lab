import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { LibrarySourcePickerDialog } from "@features/files/LibraryUploadDialogs";
import {
  getFiles,
  getFolders,
  type ManagedFile,
  type ManagedFolder,
} from "@features/files/api";

vi.mock("@features/files/api", () => ({
  getFiles: vi.fn(),
  getFolders: vi.fn(),
}));
vi.mock("@features/files/AssetBrowserParts", () => ({
  AssetPreview: () => null,
  FileKindIcon: () => null,
  fileDisplayName: (file: ManagedFile) => file.display_name,
  kindLabel: () => "文档",
}));
const file = (id: string, folderId: string | null = null): ManagedFile => ({
  id,
  project_id: "p1",
  folder_id: folderId,
  original_filename: id + ".txt",
  display_name: id,
  media_kind: "document",
  mime_type: "text/plain",
  byte_size: 10,
  revision: 0,
  created_at: "now",
  updated_at: "now",
  source: "project",
  is_reference: false,
});
const folder = (id: string, parentId: string | null): ManagedFolder => ({
  id,
  name: id,
  parent_id: parentId,
  project_id: "p1",
  revision: 0,
  created_at: "now",
  updated_at: "now",
});
const confirm = vi.fn();
function picker(mode: "project" | "cross" = "project") {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <LibrarySourcePickerDialog
        mode={mode}
        currentProjectId="p1"
        sourceProjects={[
          { id: "p1", title: "项目一" },
          { id: "p2", title: "项目二" },
        ]}
        sourceProjectsLoading={false}
        onClose={vi.fn()}
        onConfirm={confirm}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getFolders).mockResolvedValue({
    items: [folder("一级", null), folder("二级", "一级")],
  });
  vi.mocked(getFiles).mockImplementation(async ({ folderId, query }) => ({
    items: query ? [] : [file(folderId ?? "根文件", folderId ?? null)],
  }));
});
it("browses nested folders and retains selections across navigation and search", async () => {
  const user = userEvent.setup();
  picker();
  await user.click(await screen.findByRole("option", { name: /根文件/ }));
  await user.click(screen.getByRole("button", { name: "一级" }));
  await user.click(await screen.findByRole("option", { name: /一级/ }));
  await user.click(screen.getByRole("button", { name: "二级" }));
  await user.click(await screen.findByRole("option", { name: /二级/ }));
  await user.type(screen.getByLabelText("搜索素材"), "missing");
  expect(await screen.findByText("没有找到匹配的文件")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "下一步（3）" }));
  expect(confirm.mock.calls[0][0].map((item: ManagedFile) => item.id)).toEqual([
    "根文件",
    "一级",
    "二级",
  ]);
  await user.click(screen.getByRole("button", { name: "返回上级" }));
  await waitFor(() =>
    expect(getFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ folderId: "一级", query: "" }),
    ),
  );
});
it("resets selections and folder when the source project changes", async () => {
  const user = userEvent.setup();
  picker("cross");
  await user.click(await screen.findByRole("option", { name: /根文件/ }));
  await user.click(screen.getByRole("combobox", { name: "来源项目" }));
  await user.click(screen.getByRole("option", { name: "项目二" }));
  await waitFor(() =>
    expect(getFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ projectId: "p2", folderId: undefined }),
    ),
  );
  expect(screen.getByRole("button", { name: "下一步（0）" })).toBeDisabled();
});
it("offers retry after a file listing failure", async () => {
  vi.mocked(getFiles).mockRejectedValueOnce(new Error("offline"));
  const user = userEvent.setup();
  picker();
  await user.click(await screen.findByRole("button", { name: "重试文件" }));
  expect(
    await screen.findByRole("option", { name: /根文件/ }),
  ).toBeInTheDocument();
});

it("supports arrow navigation and keyboard selection", async () => {
  vi.mocked(getFiles).mockResolvedValue({
    items: [file("first"), file("second")],
  });
  const user = userEvent.setup();
  picker();
  await user.click(await screen.findByRole("option", { name: /first/ }));
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("option", { name: /second/ })).toHaveFocus();
  await user.keyboard(" ");
  expect(screen.getByRole("button", { name: "下一步（2）" })).toBeEnabled();
});
