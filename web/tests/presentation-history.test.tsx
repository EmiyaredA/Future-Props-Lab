import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PresentationEditor } from "@features/presentation-workshop/PresentationEditor";
import { newDeck } from "@features/presentation-workshop/templates";
import { saveProject } from "@features/presentation-workshop/api";
import { newConnection } from "@features/presentation-workshop/scene/connectionEditing";
import type { Project } from "@features/presentation-workshop/types";

vi.mock("@features/presentation-workshop/api", () => ({
  saveProject: vi.fn(),
  createProject: vi.fn(),
  imageBlob: vi.fn(),
}));
vi.mock("@platform/api/useApiBlobUrl", () => ({
  useApiBlobUrl: () => ({ url: null, error: null }),
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.mocked(saveProject).mockImplementation(async (id, body, revision) => ({
    ...project(),
    ...body,
    id,
    revision: revision + 1,
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function project(): Project {
  return {
    id: "history-project",
    title: "原始名称",
    document: newDeck(),
    revision: 0,
    created_at: "2026-10-19",
    updated_at: "2026-10-19",
  };
}
function mount(readOnly = false, initial = project()) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <PresentationEditor
        initial={initial}
        readOnly={readOnly}
        onOpen={vi.fn()}
        onBack={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
const undo = () => screen.getByRole("button", { name: "撤销" });
const redo = () => screen.getByRole("button", { name: "重做" });
const key = (target: Element, shiftKey = false, metaKey = false, value = "z") =>
  fireEvent.keyDown(target, {
    key: value,
    ctrlKey: !metaKey,
    metaKey,
    shiftKey,
  });

it("原生编辑菜单的beforeinput复用文稿历史", () => {
  mount();
  const title = screen.getByLabelText("文稿名称");
  fireEvent.focus(title);
  fireEvent.change(title, { target: { value: "菜单操作" } });
  const undoEvent = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "historyUndo",
  });
  fireEvent(title, undoEvent);
  expect(undoEvent.defaultPrevented).toBe(true);
  expect(title).toHaveValue("原始名称");
  expect(undo()).toBeDisabled();
  fireEvent(
    title,
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "historyRedo",
    }),
  );
  expect(title).toHaveValue("菜单操作");
});

it("名称和备注输入使用统一顺序，Ctrl、Cmd及Y每次只恢复一步", async () => {
  mount();
  const user = userEvent.setup();
  const title = screen.getByLabelText("文稿名称");
  await user.click(title);
  fireEvent.change(title, { target: { value: "新名称" } });
  await user.click(screen.getByRole("button", { name: /演示者备注/ }));
  const notes = screen.getByLabelText("演示者备注");
  await user.click(notes);
  fireEvent.change(notes, { target: { value: "新备注" } });
  key(notes);
  expect(notes).toHaveValue("");
  expect(title).toHaveValue("新名称");
  key(notes, false, true);
  expect(title).toHaveValue("原始名称");
  expect(undo()).toBeDisabled();
  key(notes, true, true);
  expect(title).toHaveValue("新名称");
  key(notes, false, false, "y");
  expect(notes).toHaveValue("新备注");
  // Undo from the focused name field must also discard its display draft.
  await user.click(title);
  fireEvent.change(title, { target: { value: "再次改名" } });
  key(title);
  expect(title).toHaveValue("新名称");
  expect(undo()).toHaveAttribute("aria-keyshortcuts", "Control+z Meta+z");
});

it("属性字段连续输入合并，切字段分开；字段聚焦时撤销同步数值", async () => {
  const { container } = mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "插入图形" }));
  await user.click(screen.getByRole("button", { name: "矩形" }));
  const x = screen.getByLabelText("X", { exact: true });
  const before = (x as HTMLInputElement).value;
  await user.click(x);
  fireEvent.change(x, { target: { value: "300" } });
  fireEvent.change(x, { target: { value: "350" } });
  key(x);
  expect(x).toHaveValue(Number(before));
  expect(
    container.querySelectorAll(".presentation-canvas [data-element-id]"),
  ).toHaveLength(4);
  key(x, true);
  expect(x).toHaveValue(350);
  const y = screen.getByLabelText("Y", { exact: true });
  const oldY = (y as HTMLInputElement).value;
  await user.click(y);
  fireEvent.change(y, { target: { value: "400" } });
  key(y);
  expect(y).toHaveValue(Number(oldY));
  expect(x).toHaveValue(350);
});

it("跨页撤销定位到修改页，页面增删也能恢复且清理无效选择", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "新建幻灯片" }));
  await user.click(screen.getByRole("button", { name: /演示者备注/ }));
  const notes = screen.getByLabelText("演示者备注");
  fireEvent.change(notes, { target: { value: "第二页" } });
  await user.click(screen.getByRole("button", { name: "幻灯片 1" }));
  await user.click(undo());
  expect(screen.getByRole("button", { name: "幻灯片 2" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  expect(notes).toHaveValue("");
  await user.click(undo());
  expect(screen.queryByRole("button", { name: "幻灯片 2" })).toBeNull();
  await user.click(redo());
  expect(screen.getByRole("button", { name: "幻灯片 2" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await user.click(screen.getByRole("button", { name: "删除幻灯片" }));
  await user.click(undo());
  expect(screen.getByRole("button", { name: "幻灯片 2" })).toHaveAttribute(
    "aria-current",
    "true",
  );
});

it("组合输入期间按钮和快捷键均隔离，组合结束恢复一次操作", async () => {
  mount();
  const title = screen.getByLabelText("文稿名称");
  fireEvent.focus(title);
  fireEvent.compositionStart(title);
  fireEvent.change(title, { target: { value: "中" } });
  fireEvent.change(title, { target: { value: "中文" } });
  key(title);
  fireEvent.click(undo());
  expect(title).toHaveValue("中文");
  fireEvent.compositionEnd(title);
  key(title);
  expect(title).toHaveValue("原始名称");
  expect(undo()).toBeDisabled();
  await act(async () => {});
});

it("连接粗细的本地草稿随历史恢复，长滑杆手势只占一步", async () => {
  const initial = project();
  const slide = initial.document.slides[0];
  slide.connections = [{ ...newConnection(slide, []), label: "测试" }];
  mount(false, initial);
  fireEvent.pointerDown(screen.getByRole("button", { name: "编辑连接测试" }));
  const width = screen.getByLabelText("连接粗细");
  fireEvent.focus(width);
  fireEvent.change(width, { target: { value: "9" } });
  key(width);
  expect(width).toHaveValue(1.5);
  key(width, true);
  expect(width).toHaveValue(9);
  fireEvent.change(width, { target: { value: "" } });
  key(width);
  expect(width).toHaveValue(1.5);
  key(width, true);
  expect(width).toHaveValue(9);
  let now = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const slider = screen.getByLabelText("连接粗细滑杆");
  fireEvent.pointerDown(slider);
  fireEvent.change(slider, { target: { value: "3" } });
  now += 2000;
  fireEvent.change(slider, { target: { value: "4" } });
  fireEvent.pointerUp(window);
  key(slider);
  expect(width).toHaveValue(9);
});

it("弹窗的搜索与源码不穿透历史；只读时没有文稿撤销", async () => {
  const { unmount } = mount();
  const user = userEvent.setup();
  const title = screen.getByLabelText("文稿名称");
  fireEvent.change(title, { target: { value: "需要保留" } });
  await user.click(screen.getByRole("button", { name: "插入图形" }));
  const dialog = screen.getByRole("dialog", { name: "形状与图标" });
  await user.click(within(dialog).getByRole("tab", { name: "图标" }));
  const search = within(dialog).getByRole("textbox");
  fireEvent.change(search, { target: { value: "箭头" } });
  expect(key(search)).toBe(true);
  expect(title).toHaveValue("需要保留");
  unmount();
  mount(true);
  const readOnlyTitle = screen.getByLabelText("文稿名称");
  expect(key(readOnlyTitle)).toBe(true);
  expect(readOnlyTitle).toHaveValue("原始名称");
  expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
});
