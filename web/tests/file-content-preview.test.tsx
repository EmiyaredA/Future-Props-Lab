import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, vi } from "vitest";
import { FileThumbnail } from "@features/files/FileThumbnail";
import { FilePreviewDialog } from "@features/files/FilePreviewDialog";
import { HomeFiles } from "@features/home/HomeFiles";
import { ReadOnlyFiles } from "@features/files/ReadOnlyFiles";
import {
  getFilePreview,
  getFiles,
  getFolders,
  type ManagedFile,
} from "@features/files/api";
import { fetchApiBlob } from "@platform/api/client";

vi.mock("@features/files/api", async (original) => ({
  ...(await original<typeof import("@features/files/api")>()),
  getFilePreview: vi.fn(),
  getFiles: vi.fn(),
  getFolders: vi.fn(),
}));
vi.mock("@platform/api/client", async (original) => ({
  ...(await original<typeof import("@platform/api/client")>()),
  fetchApiBlob: vi.fn(),
}));

const file = (
  kind: ManagedFile["media_kind"],
  extension: string,
): ManagedFile => ({
  id: kind,
  media_kind: kind,
  mime_type: extension === "pdf" ? "application/pdf" : `${kind}/${extension}`,
  original_filename: `sample.${extension}`,
  display_name: "预览样本",
  revision: 3,
  byte_size: 1024,
  project_id: null,
  folder_id: null,
  source: "library",
  is_reference: false,
  created_at: "2026-11-02T00:00:00Z",
  updated_at: "2026-11-02T00:00:00Z",
});
function mount(children: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchApiBlob).mockResolvedValue(
    new Blob(["pixels"], { type: "image/webp" }),
  );
  vi.mocked(getFilePreview).mockResolvedValue({
    kind: "text",
    text: "实际文档正文",
    truncated: false,
  });
  vi.mocked(getFiles).mockResolvedValue({ items: [] });
  vi.mocked(getFolders).mockResolvedValue({ items: [] });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:preview"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("media cards defer derivatives and never load original media before opening", async () => {
  const observers: (() => void)[] = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(() =>
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          ),
        );
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.mocked(getFilePreview).mockResolvedValue({
    kind: "audio",
    duration_seconds: 125,
    waveform_seconds: 60,
    truncated: false,
  });
  mount(<FileThumbnail file={file("audio", "wav")} />);
  expect(fetchApiBlob).not.toHaveBeenCalled();
  expect(getFilePreview).not.toHaveBeenCalled();
  await act(async () => observers.forEach((visible) => visible()));
  expect(
    await screen.findByText("前 60 秒波形 · 全长 2:05"),
  ).toBeInTheDocument();
  expect(fetchApiBlob).toHaveBeenCalledWith(
    expect.stringContaining("/thumbnail?size=320"),
    expect.anything(),
  );
  expect(
    vi
      .mocked(fetchApiBlob)
      .mock.calls.every(([path]) => !path.includes("/content")),
  ).toBe(true);
});

test("homepage separates category navigation from preview and restores keyboard focus", async () => {
  const user = userEvent.setup();
  const navigate = vi.fn();
  vi.mocked(getFiles).mockResolvedValue({ items: [file("document", "md")] });
  mount(<HomeFiles canWrite={false} onNavigate={navigate} />);
  const trigger = await screen.findByRole("button", { name: "预览 预览样本" });
  await user.click(screen.getByRole("button", { name: "文档资料" }));
  expect(navigate).toHaveBeenCalledWith("/files?kind=document");
  navigate.mockClear();
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "预览样本" });
  expect(await within(dialog).findByText("实际文档正文")).toBeInTheDocument();
  expect(navigate).not.toHaveBeenCalled();
  for (let i = 0; i < 5; i++) {
    await user.tab();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  }
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
});

test("text preview renders untrusted markup as text and explains truncation", async () => {
  const text =
    '<script>window.previewInjected = true</script><img src="bad" onerror="evil()">';
  vi.mocked(getFilePreview).mockResolvedValue({
    kind: "text",
    text,
    truncated: true,
  });
  mount(<FilePreviewDialog file={file("document", "md")} onClose={vi.fn()} />);
  expect(await screen.findByText(text)).toBeInTheDocument();
  expect(document.querySelector(".file-document-text script")).toBeNull();
  expect(screen.getByText(/仅展示前 64 KiB/)).toBeInTheDocument();
  expect(fetchApiBlob).not.toHaveBeenCalled();
});

test("PDF page navigation and zoom load only the current rendered page", async () => {
  const user = userEvent.setup();
  vi.mocked(getFilePreview).mockResolvedValue({
    kind: "pdf",
    page_count: 2,
    truncated: false,
  });
  mount(<FilePreviewDialog file={file("document", "pdf")} onClose={vi.fn()} />);
  expect(await screen.findByAltText("第 1 页")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "放大" }));
  expect(screen.getByAltText("第 1 页")).toHaveStyle({ width: "125%" });
  await user.click(screen.getByRole("button", { name: "下一页" }));
  expect(await screen.findByAltText("第 2 页")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "下一页" })).toBeDisabled();
  expect(
    vi
      .mocked(fetchApiBlob)
      .mock.calls.some(([path]) => path.includes("page=2")),
  ).toBe(true);
  expect(
    vi
      .mocked(fetchApiBlob)
      .mock.calls.every(([path]) => !path.includes("/content")),
  ).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalled();
});

test("failed document preview retries without navigating or losing the download action", async () => {
  const user = userEvent.setup();
  vi.mocked(getFilePreview).mockRejectedValueOnce(new Error("offline"));
  mount(<FilePreviewDialog file={file("document", "txt")} onClose={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("预览失败");
  expect(screen.getAllByRole("button", { name: "下载文件" })).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "重新加载预览" }));
  expect(await screen.findByText("实际文档正文")).toBeInTheDocument();
});

test("video playback uses explicit custom controls for play, seeking, and volume", async () => {
  const user = userEvent.setup();
  const play = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockImplementation(function (this: HTMLMediaElement) {
      fireEvent.play(this);
      return Promise.resolve();
    });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    fireEvent.pause(this);
  });
  mount(<FilePreviewDialog file={file("video", "mp4")} onClose={vi.fn()} />);
  await screen.findByRole("button", { name: "播放" });
  const video = document.querySelector("video")!;
  expect(video).not.toHaveAttribute("controls");
  expect(video).not.toHaveAttribute("autoplay");
  Object.defineProperty(video, "duration", { value: 80, configurable: true });
  fireEvent.loadedMetadata(video);
  await user.click(screen.getByRole("button", { name: "播放" }));
  expect(play).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "暂停" })).toBeInTheDocument();
  fireEvent.change(screen.getByRole("slider", { name: "播放进度" }), {
    target: { value: "20" },
  });
  expect(video.currentTime).toBe(20);
  fireEvent.change(screen.getByRole("slider", { name: "音量" }), {
    target: { value: "0.3" },
  });
  expect(video.volume).toBe(0.3);
  expect(screen.getByRole("button", { name: "全屏" })).toBeInTheDocument();
});

test("readonly file browsing uses the same document reader without write controls", async () => {
  const user = userEvent.setup();
  vi.mocked(getFiles).mockResolvedValue({ items: [file("document", "csv")] });
  mount(<ReadOnlyFiles initialKind="document" />);
  await user.click(await screen.findByRole("button", { name: /预览样本/ }));
  expect(
    await screen.findByRole("dialog", { name: "预览样本" }),
  ).toBeInTheDocument();
  expect(
    await screen.findByText("实际文档正文", {
      selector: ".file-document-text",
    }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "上传文件" }),
  ).not.toBeInTheDocument();
});
