import { WorkspaceSidebar } from "@features/visual-workshop/WorkspaceSidebar";
import { useWorkspaceSidebarState } from "@features/visual-workshop/useWorkspaceSidebarState";
import { FileText } from "lucide-react";
import { useState } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { VisualProjectHeader } from "@features/visual-workshop/canvas/VisualProjectHeader";
import {
  MaterialViews,
  type MaterialView,
} from "@features/visual-workshop/board/MaterialViews";
import { WorkbenchViewToggle } from "@features/visual-workshop/WorkbenchViewToggle";
import { cardsKey } from "@features/visual-workshop/creative/api";

afterEach(() => {
  window.innerWidth = 1024;
  vi.restoreAllMocks();
});

function header(workspace: "workbench" | "script" | "previs" = "workbench") {
  const onWorkbench = vi.fn(),
    onScript = vi.fn(),
    onPrevis = vi.fn();
  const result = render(
    <VisualProjectHeader
      workspace={workspace}
      onWorkbench={onWorkbench}
      onScript={onScript}
      onPrevis={onPrevis}
      projectTitle="我的项目"
      title="我的项目"
      editingTitle={false}
      saveState="saved"
      onBack={vi.fn()}
      onStartTitleEditing={vi.fn()}
      onTitleChange={vi.fn()}
      onSubmitTitle={vi.fn()}
      onBlurTitle={vi.fn()}
    />,
  );
  return { ...result, onWorkbench, onScript, onPrevis };
}

test("all workspaces use the same three global tabs without canvas, board or storyboard controls", async () => {
  const user = userEvent.setup();
  const h = header("script");
  const tabs = screen.getByRole("tablist", { name: "项目工作区" });
  expect(
    within(tabs)
      .getAllByRole("tab")
      .map((el) => el.textContent),
  ).toEqual(["工作台", "剧本", "白模预演"]);
  expect(screen.getByRole("tab", { name: "剧本" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.queryByRole("button", { name: "画布" })).toBeNull();
  expect(screen.queryByRole("button", { name: "看板" })).toBeNull();
  expect(screen.queryByRole("tab", { name: "分镜" })).toBeNull();
  const script = screen.getByRole("tab", { name: "剧本" });
  await user.click(script);
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "白模预演" })).toHaveFocus();
  expect(h.onPrevis).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  expect(h.onPrevis).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("tab", { name: "工作台" }));
  expect(h.onWorkbench).toHaveBeenCalledOnce();
});

test("desktop menu only contains actions absent from the visible header", async () => {
  const user = userEvent.setup();
  header("previs");
  await user.click(screen.getByRole("button", { name: "项目更多操作" }));
  expect(screen.getByRole("menuitem", { name: "新建窗口" })).toBeEnabled();
  expect(screen.queryByRole("menuitem", { name: "重命名项目" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "深色" })).toBeNull();
  expect(screen.queryByRole("menuitem", { name: "浅色" })).toBeNull();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("button", { name: "我的项目" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "切换深色" })).toBeEnabled();
});

test("compact header retains rename and theme fallbacks in its menu", async () => {
  const media = window.matchMedia("(max-width: 700px)");
  vi.spyOn(window, "matchMedia").mockReturnValue({ ...media, matches: true });
  const user = userEvent.setup();
  header("previs");
  await user.click(screen.getByRole("button", { name: "项目更多操作" }));
  expect(screen.getByRole("menuitem", { name: "重命名项目" })).toBeEnabled();
  await user.click(screen.getByRole("menuitem", { name: "深色" }));
  expect(document.documentElement).toHaveAttribute("data-theme", "dark");
});

test("resource panel defaults to pinned and preserves category searches across close and reopen", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity } },
  });
  client.setQueryData(cardsKey, []);
  function Resources() {
    const [view, setView] = useState<MaterialView>("files");
    const { open, setOpen, pinned, setPinned } = useWorkspaceSidebarState();
    const [searches, setSearches] = useState<
      Partial<Record<MaterialView, string>>
    >({});
    return (
      <>
        <MaterialViews
          view={view}
          onView={setView}
          ids={[]}
          fileCount={3}
          storyboardCount={4}
          search={searches[view] ?? ""}
          onSearch={(value) => setSearches({ ...searches, [view]: value })}
          open={open}
          onOpenChange={setOpen}
          pinned={pinned}
          onPinnedChange={setPinned}
          footer={null}
        >
          <span>资源内容</span>
        </MaterialViews>
        <button>画布空白区域</button>
      </>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <Resources />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  expect(screen.getByRole("textbox", { name: "搜索文件" })).toBeVisible();
  expect(
    screen.getAllByRole("tab").map((el) => el.getAttribute("aria-label")),
  ).toEqual(["文件", "分镜", "人设", "场景", "道具"]);
  await user.click(screen.getByRole("tab", { name: "文件" }));
  await user.type(screen.getByRole("textbox", { name: "搜索文件" }), "镜头");
  await user.click(screen.getByRole("tab", { name: "场景" }));
  expect(screen.getByRole("textbox", { name: "搜索场景" })).toHaveValue("");
  await user.click(screen.getByRole("tab", { name: "文件" }));
  expect(screen.getByRole("textbox", { name: "搜索文件" })).toHaveValue("镜头");
  await user.click(screen.getByRole("button", { name: "画布空白区域" }));
  expect(screen.getByRole("textbox", { name: "搜索文件" })).toBeVisible();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("textbox", { name: "搜索文件" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "收起素材面板" }));
  expect(screen.queryByRole("textbox", { name: "搜索文件" })).toBeNull();
  expect(screen.getByRole("tab", { name: "文件" })).toHaveFocus();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("textbox", { name: "搜索文件" })).toHaveValue("镜头");
  await user.click(screen.getByRole("button", { name: "取消固定素材面板" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("textbox", { name: "搜索文件" })).toBeNull();
});

test("canvas and board are local view controls without a redundant location heading", async () => {
  const onView = vi.fn();
  render(<WorkbenchViewToggle view="canvas" onView={onView} />);
  expect(screen.queryByText("工作台 · 画布")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "看板" }));
  expect(onView).toHaveBeenCalledWith("board");
});

test("script and previs sidebars stay pinned until explicitly closed or unpinned", async () => {
  const user = userEvent.setup();
  render(
    <WorkspaceSidebar label="剧本" icon={FileText}>
      <button>第一场</button>
    </WorkspaceSidebar>,
  );
  expect(screen.getByRole("button", { name: "第一场" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: "取消固定剧本侧栏" }),
  ).toHaveAttribute("aria-pressed", "true");
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "展开剧本侧栏" }));
  expect(screen.getByRole("button", { name: "第一场" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "取消固定剧本侧栏" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("button", { name: "第一场" })).toBeNull();
  expect(screen.getByRole("button", { name: "展开剧本侧栏" })).toHaveFocus();
});

test("narrow drawers start closed and discard temporary opens while preserving desktop preferences", async () => {
  window.innerWidth = 768;
  const user = userEvent.setup();
  render(
    <WorkspaceSidebar label="场景" icon={FileText}>
      <button>会客室</button>
    </WorkspaceSidebar>,
  );
  expect(screen.queryByRole("button", { name: "会客室" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "展开场景侧栏" }));
  expect(screen.getByRole("button", { name: "会客室" })).toBeVisible();
  function resize(width: number) {
    act(() => {
      window.innerWidth = width;
      fireEvent.resize(window);
    });
  }
  resize(1440);
  expect(
    screen.getByRole("button", { name: "取消固定场景侧栏" }),
  ).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "收起场景侧栏" }));
  resize(768);
  expect(screen.queryByRole("button", { name: "会客室" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "展开场景侧栏" }));
  resize(1440);
  expect(screen.queryByRole("button", { name: "会客室" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "展开场景侧栏" }));
  expect(screen.getByRole("button", { name: "会客室" })).toBeVisible();
});
