import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { HomeFiles } from "@features/home/HomeFiles";
import {
  getFiles,
  getFolders,
  uploadManagedFile,
  type ManagedFile,
} from "@features/files/api";
import { fileQueryKeys } from "@features/files/queryKeys";
import { ReadOnlyFiles } from "@features/files/ReadOnlyFiles";
import { parseRoute } from "@app/routes";

vi.mock("@features/files/api", () => ({
  getFiles: vi.fn(),
  getFolders: vi.fn().mockResolvedValue({ items: [] }),
  uploadManagedFile: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(getFiles).mockReset().mockResolvedValue({ items: [] });
  vi.mocked(uploadManagedFile).mockReset();
});
function mount(canWrite = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const navigate = vi.fn();
  const result = render(
    <QueryClientProvider client={client}>
      <HomeFiles onNavigate={navigate} canWrite={canWrite} />
    </QueryClientProvider>,
  );
  return { ...result, client, navigate };
}

test("empty categories retain real file type navigation and readonly omits upload", async () => {
  const user = userEvent.setup();
  const { navigate } = mount(false);
  await screen.findByText("灵感、参考与画面");
  expect(
    screen.queryByRole("button", { name: "上传文件" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /文档资料/ }));
  expect(navigate).toHaveBeenCalledWith("/files?kind=document");
});

test("homepage upload invalidates the owner cache and retries only failed files", async () => {
  const user = userEvent.setup();
  const stored = {
    id: "doc",
    display_name: "说明.txt",
    media_kind: "document",
  } as ManagedFile;
  vi.mocked(uploadManagedFile)
    .mockResolvedValueOnce(stored)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(stored);
  const { client } = mount();
  await screen.findByText("笔记、文稿与附件");
  const invalidation = vi.spyOn(client, "invalidateQueries");
  await user.upload(screen.getByLabelText("选择上传文件"), [
    new File(["a"], "说明.txt", { type: "text/plain" }),
    new File(["b"], "重试.txt", { type: "text/plain" }),
  ]);
  expect(
    await screen.findByText(/1 个文件已上传，1 个失败/),
  ).toBeInTheDocument();
  expect(invalidation).toHaveBeenCalledWith({
    queryKey: fileQueryKeys.files(),
  });
  vi.mocked(getFiles).mockResolvedValue({ items: [stored] });
  await user.click(screen.getByRole("button", { name: "重试失败文件" }));
  await screen.findByText("1 个文件已上传到文件库。");
  expect(uploadManagedFile).toHaveBeenCalledTimes(3);
  expect(vi.mocked(uploadManagedFile).mock.calls[2][0].name).toBe("重试.txt");
  await waitFor(() => expect(screen.getByText("说明.txt")).toBeInTheDocument());
});

test("file loading failure offers retry without losing category entrances", async () => {
  vi.mocked(getFiles).mockRejectedValueOnce(new Error("offline"));
  const user = userEvent.setup();
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "暂时无法加载文件",
  );
  expect(screen.getAllByRole("button", { name: /素材|文档资料/ })).toHaveLength(
    4,
  );
  await user.click(screen.getByRole("button", { name: "重新加载" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
});

test("query handoffs keep route identity on direct links and reload", () => {
  expect(parseRoute("/files?kind=image")).toEqual({
    page: "files",
    search: "?kind=image",
  });
  expect(parseRoute("/model-test?mode=video")).toEqual({
    page: "model-test",
    search: "?mode=video",
  });
  window.history.replaceState({}, "", "/files?kind=audio");
  expect(parseRoute()).toEqual({ page: "files", search: "?kind=audio" });
  window.history.replaceState({}, "", "/");
});

test("readonly file navigation applies the same type handoff without write controls", async () => {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <ReadOnlyFiles initialKind="audio" />
    </QueryClientProvider>,
  );
  await screen.findByRole("combobox", { name: "文件类型" });
  expect(getFolders).toHaveBeenCalledWith(undefined);
  expect(getFiles).toHaveBeenCalledWith(
    expect.objectContaining({ mediaKind: "audio" }),
  );
  expect(
    screen.queryByRole("button", { name: /上传/ }),
  ).not.toBeInTheDocument();
});
