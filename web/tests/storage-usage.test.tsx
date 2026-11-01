import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { StorageUsagePage } from "@features/tools/StorageUsagePage";
import {
  getStorageUsage,
  openStorageDirectory,
  type StorageUsageState,
} from "@features/tools/storageUsageApi";

vi.mock("@features/tools/storageUsageApi", () => ({
  getStorageUsage: vi.fn(),
  openStorageDirectory: vi.fn(),
}));
const state: StorageUsageState = {
  analyzer: { installed: true, version: "3.8.1" },
  directory: "/Users/example",
  capacity: { total_bytes: 100e9, used_bytes: 60e9, free_bytes: 40e9 },
  shortcuts: [
    {
      id: "home",
      label: "主目录",
      directory: "/Users/example",
      available: true,
    },
    {
      id: "downloads",
      label: "下载",
      directory: "/Users/example/Downloads",
      available: true,
    },
  ],
};
beforeEach(() => {
  vi.mocked(getStorageUsage)
    .mockReset()
    .mockImplementation(async (path) => ({
      ...state,
      directory: path ?? state.directory,
    }));
  vi.mocked(openStorageDirectory)
    .mockReset()
    .mockImplementation(async (directory) => ({ directory, submitted: true }));
});
function show(allowed = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <StorageUsagePage allowed={allowed} onBack={vi.fn()} />
    </QueryClientProvider>,
  );
}

test("reads capacity, switches directories, and hands analysis and Finder actions to native apps", async () => {
  const user = userEvent.setup();
  show();
  expect(await screen.findByText("已安装 · 3.8.1")).toBeInTheDocument();
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    "60",
  );
  await user.click(screen.getByRole("button", { name: "下载" }));
  await screen.findByText("/Users/example/Downloads");
  await user.click(screen.getByRole("button", { name: /可视化分析/ }));
  await waitFor(() =>
    expect(openStorageDirectory).toHaveBeenCalledWith(
      "/Users/example/Downloads",
      true,
    ),
  );
  expect(
    await screen.findByText(/已发送 GrandPerspective 打开请求/),
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "在 Finder 中打开" }));
  await waitFor(() =>
    expect(openStorageDirectory).toHaveBeenCalledWith(
      "/Users/example/Downloads",
      false,
    ),
  );
  await user.click(screen.getByRole("button", { name: /刷新容量/ }));
  await waitFor(() => expect(getStorageUsage).toHaveBeenCalledTimes(3));
});

test("explicit Mac paths change the capacity query", async () => {
  const user = userEvent.setup();
  show();
  await screen.findByText("已安装 · 3.8.1");
  await user.type(
    screen.getByRole("textbox", { name: "Mac 目录绝对路径" }),
    "/Volumes/外接盘/素材",
  );
  await user.click(screen.getByRole("button", { name: "查看目录" }));
  expect(await screen.findByText("/Volumes/外接盘/素材")).toBeInTheDocument();
  expect(getStorageUsage).toHaveBeenLastCalledWith("/Volumes/外接盘/素材");
});

test("missing installation offers download and re-detection while Finder remains usable", async () => {
  vi.mocked(getStorageUsage).mockResolvedValue({
    ...state,
    analyzer: { installed: false, version: null },
  });
  show();
  expect(
    await screen.findByRole("link", { name: /前往官网下载/ }),
  ).toHaveAttribute("href", "https://grandperspectiv.sourceforge.net/");
  expect(screen.getByRole("button", { name: /可视化分析/ })).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "在 Finder 中打开" }),
  ).toBeEnabled();
});

test("denied environment never requests local paths", () => {
  show(false);
  expect(screen.getByText(/此工具仅供 macOS/)).toBeInTheDocument();
  expect(getStorageUsage).not.toHaveBeenCalled();
});

test("open failures do not retry and pending actions prevent duplicate submission", async () => {
  const user = userEvent.setup();
  let fail!: (error: Error) => void;
  vi.mocked(openStorageDirectory).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  show();
  await screen.findByText("已安装 · 3.8.1");
  const button = screen.getByRole("button", { name: /可视化分析/ });
  await user.click(button);
  expect(button).toBeDisabled();
  expect(screen.getByRole("button", { name: "查看目录" })).toBeDisabled();
  fail(new Error("打开请求超时"));
  expect(await screen.findByRole("alert")).toHaveTextContent("打开请求超时");
  expect(openStorageDirectory).toHaveBeenCalledTimes(1);
  expect(button).toBeEnabled();
});

test("read errors offer explicit retry and picker remains available", async () => {
  const user = userEvent.setup();
  vi.mocked(getStorageUsage).mockRejectedValueOnce(new Error("目录已不可用"));
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent("目录已不可用");
  await user.click(screen.getByRole("button", { name: /刷新容量/ }));
  expect(await screen.findByText("已安装 · 3.8.1")).toBeInTheDocument();
});
