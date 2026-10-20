import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { VideoDownloaderPage } from "@features/tools/VideoDownloaderPage";
import {
  createVideoDownloadJob,
  getVideoDownloadDeps,
  getVideoDownloadJob,
} from "@features/tools/api";

vi.mock("@features/tools/api", async () => {
  const actual = await vi.importActual<typeof import("@features/tools/api")>(
    "@features/tools/api",
  );
  return {
    ...actual,
    getVideoDownloadDeps: vi.fn(),
    createVideoDownloadJob: vi.fn(),
    getVideoDownloadJob: vi.fn(),
    downloadVideoDownloadFile: vi.fn(),
  };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <VideoDownloaderPage onBack={vi.fn()} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getVideoDownloadDeps).mockResolvedValue({
    ready: true,
    yt_dlp: {
      name: "yt-dlp",
      ok: true,
      path: "/opt/homebrew/bin/yt-dlp",
      version: "2026.08.19",
      hint: null,
    },
    ffmpeg: {
      name: "ffmpeg",
      ok: true,
      path: "/opt/homebrew/bin/ffmpeg",
      version: "ffmpeg version 7",
      hint: null,
    },
  });
  vi.mocked(createVideoDownloadJob).mockResolvedValue({
    id: "job-1",
    status: "queued",
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    quality: "best",
    use_browser_cookies: true,
    cookies_from_browser: "chrome",
    save_to_disk: true,
    save_to_library: true,
    title: null,
    filename: null,
    byte_size: null,
    error: null,
    asset: null,
    created_at: "2026-10-20T00:00:00Z",
    updated_at: "2026-10-20T00:00:00Z",
  });
  vi.mocked(getVideoDownloadJob).mockResolvedValue({
    id: "job-1",
    status: "succeeded",
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    quality: "best",
    use_browser_cookies: true,
    cookies_from_browser: "chrome",
    save_to_disk: true,
    save_to_library: true,
    title: "测试视频",
    filename: "测试视频.mp4",
    byte_size: 1024,
    error: null,
    asset: {
      id: "asset-1",
      display_name: "测试视频",
      original_filename: "测试视频.mp4",
      mime_type: "video/mp4",
      byte_size: 1024,
    },
    created_at: "2026-10-20T00:00:00Z",
    updated_at: "2026-10-20T00:00:01Z",
  });
});

test("requires a destination before starting", async () => {
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findByText("yt-dlp 与 ffmpeg 已就绪")).toBeInTheDocument();

  await user.click(screen.getByLabelText("本机下载（浏览器另存）"));
  await user.click(screen.getByLabelText("Workspace 文件库"));
  await user.type(
    screen.getByRole("textbox", { name: "视频链接" }),
    "https://www.bilibili.com/video/BV1xx411c7mD",
  );
  await user.click(screen.getByRole("button", { name: "开始下载" }));
  expect(screen.getByRole("alert")).toHaveTextContent("请至少选择一种保存方式");
  expect(createVideoDownloadJob).not.toHaveBeenCalled();
});

test("opens the link help dialog", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("yt-dlp 与 ffmpeg 已就绪");
  await user.click(screen.getByRole("button", { name: "如何获取链接" }));
  expect(
    screen.getByRole("heading", { name: "如何获取要下载的视频链接" }),
  ).toBeInTheDocument();
  expect(screen.getByText("抖音 App")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "知道了" }));
  expect(
    screen.queryByRole("heading", { name: "如何获取要下载的视频链接" }),
  ).toBeNull();
});

test("starts without cookies by default", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("yt-dlp 与 ffmpeg 已就绪");

  await user.type(
    screen.getByRole("textbox", { name: "视频链接" }),
    "https://www.bilibili.com/video/BV1xx411c7mD",
  );
  await user.click(screen.getByRole("button", { name: "开始下载" }));
  await waitFor(() => expect(createVideoDownloadJob).toHaveBeenCalled());
  expect(vi.mocked(createVideoDownloadJob).mock.calls[0][0]).toEqual({
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    quality: "best",
    use_browser_cookies: false,
    cookies_from_browser: "chrome",
    save_to_disk: true,
    save_to_library: true,
  });
});

test("confirms browser cookies when enabled", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("yt-dlp 与 ffmpeg 已就绪");

  await user.click(
    screen.getByLabelText("从本机浏览器读取 Cookie（登录可见 / B 站需要时）"),
  );
  await user.type(
    screen.getByRole("textbox", { name: "视频链接" }),
    "https://www.bilibili.com/video/BV1xx411c7mD",
  );
  await user.click(screen.getByRole("button", { name: "开始下载" }));
  expect(
    screen.getByRole("heading", { name: "读取浏览器 Cookie？" }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "允许并下载" }));
  await waitFor(() => expect(createVideoDownloadJob).toHaveBeenCalled());
  expect(vi.mocked(createVideoDownloadJob).mock.calls[0][0]).toEqual({
    url: "https://www.bilibili.com/video/BV1xx411c7mD",
    quality: "best",
    use_browser_cookies: true,
    cookies_from_browser: "chrome",
    save_to_disk: true,
    save_to_library: true,
  });
});
