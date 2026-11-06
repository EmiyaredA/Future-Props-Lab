import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { ToolNavigationPage } from "@features/tools/ToolNavigationPage";
import {
  getToolNavigationState,
  recordToolUse,
  setToolFavorite,
} from "@features/tools/api";

vi.mock("@features/tools/api", async () => {
  const actual = await vi.importActual<typeof import("@features/tools/api")>(
    "@features/tools/api",
  );
  return {
    ...actual,
    getToolNavigationState: vi.fn(),
    recordToolUse: vi.fn(),
    setToolFavorite: vi.fn(),
  };
});

const emptyState = { items: [] };

function item(toolId: string, changes: Record<string, unknown> = {}) {
  return {
    tool_id: toolId,
    is_favorite: false,
    favorite_updated_at: null,
    last_used_at: null,
    use_count: 0,
    ...changes,
  };
}

function renderPage(onOpenInternal = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ToolNavigationPage onOpenInternal={onOpenInternal} />
    </QueryClientProvider>,
  );
  return { onOpenInternal };
}

beforeEach(() => {
  vi.mocked(getToolNavigationState).mockResolvedValue(emptyState);
  vi.mocked(recordToolUse).mockImplementation(async (toolId) =>
    item(toolId, {
      last_used_at: "2026-08-03T08:00:00Z",
      use_count: 1,
    }),
  );
  vi.mocked(setToolFavorite).mockImplementation(async (toolId, favorite) =>
    item(toolId, {
      is_favorite: favorite,
      favorite_updated_at: favorite ? "2026-08-03T08:00:00Z" : null,
    }),
  );
});

test("filters the catalog with category, tag, and search together", async () => {
  const user = userEvent.setup();
  renderPage();
  expect(await screen.findByText("还没有收藏工具")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "打开JSON 格式化" }),
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "数据处理" }));
  await user.click(screen.getByRole("button", { name: "JSON" }));
  expect(
    screen.getByRole("button", { name: "打开JSON 格式化" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "打开Base64 编解码" }),
  ).toBeNull();

  await user.type(screen.getByRole("textbox", { name: "搜索工具" }), "时间");
  expect(screen.getByText("没有找到匹配的工具")).toBeInTheDocument();
});

test("persists favorites and renders them in the side panel", async () => {
  const user = userEvent.setup();
  renderPage();
  await screen.findByText("还没有收藏工具");
  await user.click(screen.getByRole("button", { name: "收藏JSON 格式化" }));

  await waitFor(() =>
    expect(setToolFavorite).toHaveBeenCalledWith("json-formatter", true),
  );
  expect(
    screen.getByRole("button", { name: "取消收藏JSON 格式化" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(screen.getAllByText("JSON 格式化")).toHaveLength(2);
});

test("opens external tools without waiting for usage persistence", async () => {
  const user = userEvent.setup();
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  renderPage();
  await screen.findByText("还没有收藏工具");

  await user.click(screen.getByRole("button", { name: "打开接口调试" }));
  expect(open).toHaveBeenCalledWith(
    "https://hoppscotch.io/",
    "_blank",
    "noopener,noreferrer",
  );
  expect(recordToolUse).toHaveBeenCalledWith("api-debugger");
});

test("opens the internal video frame exporter and records usage", async () => {
  const user = userEvent.setup();
  const { onOpenInternal } = renderPage();
  await screen.findByText("还没有收藏工具");

  await user.click(screen.getByRole("button", { name: "打开视频帧导出" }));
  expect(onOpenInternal).toHaveBeenCalledWith("/tools/video-frame-exporter");
  expect(recordToolUse).toHaveBeenCalledWith("video-frame-exporter");
});

test("opens the internal video downloader and records usage", async () => {
  const user = userEvent.setup();
  const { onOpenInternal } = renderPage();
  await screen.findByText("还没有收藏工具");

  await user.click(screen.getByRole("button", { name: "打开视频下载" }));
  expect(onOpenInternal).toHaveBeenCalledWith("/tools/video-downloader");
  expect(recordToolUse).toHaveBeenCalledWith("video-downloader");
});

test("omits retired host tools from cards, favorites and recent entries", async () => {
  vi.mocked(getToolNavigationState).mockResolvedValue({
    items: [
      item("codex-model-source", {
        is_favorite: true,
        last_used_at: "2026-10-20T08:00:00Z",
      }),
      item("storage-usage", {
        is_favorite: true,
        last_used_at: "2026-10-20T08:00:00Z",
      }),
    ],
  });
  renderPage();
  await screen.findByText("还没有收藏工具");
  expect(screen.queryByText("空间占用")).toBeNull();
  expect(screen.queryByText("Codex 模型源")).toBeNull();
});

test("does not present first-party applications or features as tool cards", async () => {
  renderPage();
  await screen.findByText("还没有收藏工具");

  expect(screen.queryByRole("button", { name: "打开录音分段标注" })).toBeNull();
  expect(screen.queryByRole("button", { name: "打开录音标注工坊" })).toBeNull();
  expect(screen.queryByRole("button", { name: "打开模型测试" })).toBeNull();
  expect(screen.queryByRole("button", { name: "打开模型服务" })).toBeNull();
  expect(screen.queryByRole("button", { name: "打开模型调用日志" })).toBeNull();
});

test("keeps external navigation available when usage persistence fails", async () => {
  const user = userEvent.setup();
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  vi.mocked(recordToolUse).mockRejectedValueOnce(new Error("offline"));
  renderPage();
  await screen.findByText("还没有收藏工具");

  await user.click(screen.getByRole("button", { name: "打开文本对比" }));
  expect(open).toHaveBeenCalled();
  expect(
    await screen.findByText("最近使用记录保存失败，但工具仍可正常使用。"),
  ).toBeInTheDocument();
});
