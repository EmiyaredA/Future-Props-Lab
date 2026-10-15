import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PresentationPreviewCard } from "@features/presentation-workshop/PresentationPreviewCard";
import { newDeck, newSlide } from "@features/presentation-workshop/templates";
import * as api from "@features/presentation-workshop/api";

vi.mock("@features/presentation-workshop/api", () => ({ getProject: vi.fn() }));
const document = {
  ...newDeck(),
  slides: ["cover", "body", "columns", "ending"].map(newSlide),
};
const project = {
  id: "preview",
  title: "四页文稿",
  document,
  revision: 1,
  created_at: "2026-10-15",
  updated_at: "2026-10-15",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.mocked(api.getProject).mockResolvedValue(project);
});
afterEach(() => vi.unstubAllGlobals());
function card() {
  const use = vi.fn();
  const result = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PresentationPreviewCard
        title="四页文稿"
        firstSlide={document.slides[0]}
        projectId="preview"
        slideCount={4}
        actionLabel="打开文稿"
        onUse={use}
        className="presentation-project-open"
      />
    </QueryClientProvider>,
  );
  return { ...result, use };
}
it("悬停按需加载前三页，移出后关闭，不打开文稿", async () => {
  const { use } = card();
  const user = userEvent.setup();
  expect(api.getProject).not.toHaveBeenCalled();
  const trigger = screen.getByRole("button", { name: "预览 四页文稿" });
  await user.hover(trigger);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip).toHaveTextContent("共 4 页");
  await waitFor(() =>
    expect(
      globalThis.document.querySelectorAll(".presentation-hover-pages figure"),
    ).toHaveLength(3),
  );
  expect(api.getProject).toHaveBeenCalledOnce();
  expect(use).not.toHaveBeenCalled();
  await user.unhover(trigger);
  await waitFor(() =>
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument(),
  );
});
it("点击完整预览，按钮、方向键与缩略图均可翻页，Escape恢复焦点", async () => {
  const { use } = card();
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "预览 四页文稿" });
  await user.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "四页文稿" });
  await screen.findByLabelText("第 1 页完整预览");
  expect(within(dialog).getByRole("button", { name: "上一页" })).toBeDisabled();
  await user.click(within(dialog).getByRole("button", { name: "下一页" }));
  expect(screen.getByLabelText("第 2 页完整预览")).toBeVisible();
  await user.keyboard("{End}");
  expect(screen.getByLabelText("第 4 页完整预览")).toBeVisible();
  expect(within(dialog).getByRole("button", { name: "下一页" })).toBeDisabled();
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByLabelText("第 3 页完整预览")).toBeVisible();
  await user.click(within(dialog).getByRole("button", { name: "查看第 1 页" }));
  expect(screen.getByLabelText("第 1 页完整预览")).toBeVisible();
  expect(use).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(trigger).toHaveFocus());
});
it("加载失败可重试，只有明确点击打开才进入文稿", async () => {
  vi.mocked(api.getProject).mockRejectedValueOnce(new Error("offline"));
  const { use } = card();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "预览 四页文稿" }));
  const dialog = screen.getByRole("dialog", { name: "四页文稿" });
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(
    "预览加载失败",
  );
  await user.click(within(dialog).getByRole("button", { name: "重试" }));
  await screen.findByLabelText("第 1 页完整预览");
  expect(use).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "打开文稿" }));
  expect(use).toHaveBeenCalledOnce();
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
it("加载中关闭会取消请求，旧请求不会打开弹窗", async () => {
  let signal: AbortSignal | undefined;
  vi.mocked(api.getProject).mockImplementation((_id, nextSignal) => {
    signal = nextSignal;
    return new Promise(() => {});
  });
  card();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "预览 四页文稿" }));
  expect(await screen.findByText("正在加载预览…")).toBeVisible();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(signal?.aborted).toBe(true));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
