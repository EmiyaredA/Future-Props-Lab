import { useState } from "react";
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
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { PresentationLibrary } from "@features/presentation-workshop/PresentationLibrary";
import { PresentationMenu } from "@features/presentation-workshop/PresentationMenu";
import { PresentationNotes } from "@features/presentation-workshop/PresentationNotes";
import { PresentationStatusbar } from "@features/presentation-workshop/PresentationStatusbar";
import { PresentationInspector } from "@features/presentation-workshop/PresentationInspector";
import { SlideCanvas } from "@features/presentation-workshop/SlideCanvas";
import { newDeck, newSlide } from "@features/presentation-workshop/templates";
import * as api from "@features/presentation-workshop/api";

vi.mock("@features/presentation-workshop/api", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  getProject: vi.fn(),
  saveProject: vi.fn(),
  deleteProject: vi.fn(),
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({ url: null, error: null }),
}));
const summary = () => ({
  id: "project",
  title: "测试文稿",
  slide_count: 1,
  first_slide: newSlide("cover"),
  updated_at: "2026-09-10T00:00:00Z",
  revision: 1,
  created_at: "2026-09-10T00:00:00Z",
});
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.clearAllMocks();
  vi.mocked(api.listProjects).mockResolvedValue({
    items: [summary()],
    total: 1,
  });
  vi.mocked(api.createProject).mockImplementation(async (draft) => ({
    ...summary(),
    ...draft,
  }));
});
afterEach(() => vi.unstubAllGlobals());
function library(readOnly = false) {
  const onOpen = vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PresentationLibrary
        readOnly={readOnly}
        onOpen={onOpen}
        onBack={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return onOpen;
}
it.each(["空白", "封面", "标题正文", "图文双栏"])(
  "从%s版式创建真实文稿",
  async (label) => {
    const onOpen = library();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: `从${label}新建文稿` }),
    );
    const dialog = screen.getByRole("dialog", { name: "新建演示文稿" });
    await user.click(within(dialog).getByRole("button", { name: "确认" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("project"));
    const document = vi.mocked(api.createProject).mock.calls[0][0].document;
    expect(document.width / document.height).toBeCloseTo(16 / 9);
    expect(document.slides).toHaveLength(1);
    expect(document.slides[0].elements).toHaveLength(
      label === "空白" ? 0 : label === "图文双栏" ? 5 : 3,
    );
    expect(document.slides[0].background).toBe(
      label === "封面" ? "#132338" : "#FFFFFF",
    );
  },
);
it("取消命名不创建，顶部新建默认封面", async () => {
  library();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "从空白新建文稿" }));
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(api.createProject).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "新建演示文稿" }));
  await user.click(screen.getByRole("button", { name: "确认" }));
  await waitFor(() => expect(api.createProject).toHaveBeenCalled());
  expect(
    vi.mocked(api.createProject).mock.calls[0][0].document.slides[0].background,
  ).toBe("#132338");
});
it("卡片菜单中的删除先确认，取消不会删除", async () => {
  library();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "文稿操作 测试文稿" }),
  );
  await user.click(screen.getByRole("menuitem", { name: "删除 测试文稿" }));
  expect(screen.getByRole("alertdialog")).toBeVisible();
  expect(api.deleteProject).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(api.deleteProject).not.toHaveBeenCalled();
});
it("只读首页只保留浏览入口", async () => {
  library(true);
  expect(
    await screen.findByRole("button", { name: "打开 测试文稿" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "新建演示文稿" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "文稿操作 测试文稿" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "基础版式" }),
  ).not.toBeInTheDocument();
});
it("菜单跳过禁用项，支持方向键、Enter、Escape与点击外部关闭", async () => {
  const chosen = vi.fn();
  render(
    <>
      <button>外部</button>
      <PresentationMenu
        label="操作"
        actions={[
          { label: "禁用", disabled: true, onSelect: vi.fn() },
          { label: "第一项", onSelect: chosen },
          { label: "第二项", onSelect: vi.fn() },
        ]}
      >
        菜单
      </PresentationMenu>
    </>,
  );
  const user = userEvent.setup(),
    trigger = screen.getByRole("button", { name: "操作" });
  trigger.focus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "第一项" })).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("menuitem", { name: "第二项" })).toHaveFocus();
  await user.keyboard("{Home}{Enter}");
  expect(chosen).toHaveBeenCalledOnce();
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.keyboard("{Escape}");
  expect(trigger).toHaveFocus();
  await user.click(trigger);
  await user.click(trigger);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  await user.click(trigger);
  await user.click(screen.getByRole("button", { name: "外部" }));
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
});
it("备注初始收起，折叠后保留内容，只读禁止编辑", async () => {
  function Notes() {
    const [notes, setNotes] = useState("");
    return (
      <PresentationNotes notes={notes} readOnly={false} onChange={setNotes} />
    );
  }
  const { rerender } = render(<Notes />);
  const user = userEvent.setup();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button"));
  await user.type(screen.getByRole("textbox"), "保存这段备注");
  await user.click(screen.getByRole("button"));
  await user.click(screen.getByRole("button"));
  expect(screen.getByRole("textbox")).toHaveValue("保存这段备注");
  rerender(<PresentationNotes notes="只读备注" readOnly onChange={vi.fn()} />);
  await user.click(screen.getByRole("button"));
  expect(screen.getByRole("textbox")).toHaveAttribute("readonly");
});
it("缩放使用实际比例，手动缩放限幅并能返回适应页面", async () => {
  const onZoom = vi.fn(),
    user = userEvent.setup();
  const { rerender } = render(
    <PresentationStatusbar
      page={2}
      total={3}
      scale={0.73}
      zoom={null}
      onZoom={onZoom}
    />,
  );
  expect(screen.getByLabelText("实际缩放比例")).toHaveTextContent("73%");
  await user.click(screen.getByRole("button", { name: "放大画布" }));
  expect(onZoom).toHaveBeenLastCalledWith(0.8);
  fireEvent.change(screen.getByRole("slider"), { target: { value: "150" } });
  expect(onZoom).toHaveBeenLastCalledWith(1.5);
  await user.click(screen.getByRole("button", { name: "适应页面" }));
  expect(onZoom).toHaveBeenLastCalledWith(null);
  rerender(
    <PresentationStatusbar
      page={2}
      total={3}
      scale={2}
      zoom={2}
      onZoom={onZoom}
    />,
  );
  expect(screen.getByRole("button", { name: "放大画布" })).toBeDisabled();
});
it("设置标签跟随选择变化，手动查看页面后重新选择仍进入元素设置", async () => {
  const slide = newSlide("cover"),
    user = userEvent.setup();
  const props = {
    slide,
    selected: [] as string[],
    patch: vi.fn(),
    background: vi.fn(),
    editor: null,
    arrange: vi.fn(),
    order: vi.fn(),
    editText: vi.fn(),
    readOnly: false,
  };
  const { rerender } = render(<PresentationInspector {...props} />);
  expect(screen.getByRole("tab", { name: "页面" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  rerender(
    <PresentationInspector {...props} selected={[slide.elements[0].id]} />,
  );
  expect(screen.getByRole("tab", { name: "元素" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await user.click(screen.getByRole("tab", { name: "页面" }));
  rerender(<PresentationInspector {...props} />);
  rerender(
    <PresentationInspector {...props} selected={[slide.elements[0].id]} />,
  );
  expect(screen.getByRole("tab", { name: "元素" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});
it("画布尺寸变化报告适应比例，手动缩放保持坐标比例", () => {
  let resize = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const onScaleChange = vi.fn();
  const props = {
    slide: newDeck().slides[0],
    selected: [],
    select: vi.fn(),
    editing: null,
    setEditing: vi.fn(),
    replace: vi.fn(),
    onText: vi.fn(),
    readOnly: false,
    zoom: null as number | null,
    onScaleChange,
    onReady: vi.fn(),
    onComposition: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  };
  const { container, rerender } = render(<SlideCanvas {...props} />);
  const host = container.querySelector(".presentation-canvas-area")!;
  vi.spyOn(host, "getBoundingClientRect").mockReturnValue({
    width: 688,
    height: 408,
  } as DOMRect);
  act(() => resize());
  expect(onScaleChange).toHaveBeenLastCalledWith(0.5);
  rerender(<SlideCanvas {...props} zoom={1.5} />);
  expect(onScaleChange).toHaveBeenLastCalledWith(1.5);
  expect(container.querySelector(".presentation-canvas")).toHaveStyle({
    transform: "scale(1.5)",
  });
  rerender(<SlideCanvas {...props} />);
  expect(onScaleChange).toHaveBeenLastCalledWith(0.5);
});
