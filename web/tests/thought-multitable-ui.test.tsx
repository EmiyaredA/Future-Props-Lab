import {
  act,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  TableWorkspace,
  ViewTabs,
} from "@features/thought-workshop/multitable/Navigation";
import { TableToolbar } from "@features/thought-workshop/multitable/Toolbar";
import { ColumnResize } from "@features/thought-workshop/multitable/ColumnResize";
import { FieldValue } from "@features/thought-workshop/multitable/FieldValue";
import { ViewSettings } from "@features/thought-workshop/multitable/ViewSettings";
import { Modal } from "@features/thought-workshop/multitable/Modal";
import { newTable } from "@features/thought-workshop/multitable/model";
import { useState } from "react";

let resize: (width: number) => void;
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = (width) =>
          callback(
            [{ contentRect: { width } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
it("keeps personal collapse independent of responsive navigation and switches tables", async () => {
  const user = userEvent.setup(),
    table = newTable(0),
    other = newTable(1),
    choose = vi.fn();
  render(
    <TableWorkspace
      tables={[table, other]}
      table={table}
      preference="user/workspace/note"
      canEdit
      choose={choose}
      add={vi.fn()}
      configure={vi.fn()}
      remove={vi.fn()}
    >
      <p>记录</p>
    </TableWorkspace>,
  );
  await user.click(screen.getByRole("button", { name: other.name }));
  expect(choose).toHaveBeenCalledWith(other.id);
  await user.click(screen.getByRole("button", { name: "收起数据表侧栏" }));
  expect(localStorage.getItem("fpl-table-sidebar/user/workspace/note")).toBe(
    "collapsed",
  );
  act(() => resize(600));
  expect(screen.getByRole("combobox", { name: "当前数据表" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "展开数据表侧栏" }),
  ).not.toBeInTheDocument();
  act(() => resize(1000));
  await user.click(screen.getByRole("button", { name: "展开数据表侧栏" }));
  act(() => resize(600));
  expect(localStorage.getItem("fpl-table-sidebar/user/workspace/note")).toBe(
    "expanded",
  );
  act(() => resize(1000));
  expect(screen.getByRole("navigation", { name: "数据表" })).toBeVisible();
});
it("uses keyboard navigation for view tabs without changing document configuration", async () => {
  const table = newTable(0),
    second = {
      ...table.views[0],
      id: "board",
      name: "资料看板",
      type: "kanban" as const,
    },
    choose = vi.fn();
  render(
    <ViewTabs
      views={[table.views[0], second]}
      view={table.views[0]}
      choose={choose}
    />,
  );
  screen.getByRole("tab", { name: "表格" }).focus();
  fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
  expect(choose).toHaveBeenLastCalledWith("board");
  expect(screen.getByRole("tab", { name: "资料看板" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(choose).toHaveBeenLastCalledWith(table.views[0].id);
});
it("keeps menu permissions and embedded controls consistent", async () => {
  const user = userEvent.setup(),
    table = newTable(0),
    action = vi.fn();
  const props = {
    table,
    view: table.views[0],
    embedded: false,
    canEdit: false,
    workspace: true,
    canDeleteTable: false,
    search: "",
    setSearch: vi.fn(),
    add: vi.fn(),
    full: false,
    fields: vi.fn(),
    settings: vi.fn(),
    action,
  };
  const { rerender } = render(<TableToolbar {...props} />);
  expect(
    screen.queryByRole("button", { name: "新增记录" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "多维表格更多操作" }));
  expect(screen.getByRole("menuitem", { name: "表格历史" })).toBeVisible();
  expect(
    screen.queryByRole("menuitem", { name: "导入 CSV" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "删除数据表" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("menuitem", { name: "导出当前筛选结果" }));
  expect(action).toHaveBeenCalledWith("export-view");
  rerender(<TableToolbar {...props} embedded canEdit workspace={false} />);
  expect(screen.getByRole("button", { name: "新增记录" })).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "字段" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "多维表格更多操作" }),
  ).not.toBeInTheDocument();
});
it("previews column resize without writes, commits once, cancels safely and supports keyboard", () => {
  vi.stubGlobal("PointerEvent", MouseEvent);
  const commit = vi.fn(),
    preview = vi.fn();
  render(
    <ColumnResize name="名称" width={320} preview={preview} commit={commit} />,
  );
  const handle = screen.getByRole("separator", { name: "调整名称列宽" });
  Object.assign(handle, {
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  });
  fireEvent.pointerDown(handle, { button: 0, clientX: 100 });
  fireEvent.pointerMove(handle, { clientX: 160 });
  fireEvent.pointerMove(handle, { clientX: 180 });
  expect(commit).not.toHaveBeenCalled();
  expect(preview).toHaveBeenLastCalledWith(400);
  fireEvent.pointerUp(handle);
  expect(commit).toHaveBeenCalledExactlyOnceWith(400);
  fireEvent.pointerDown(handle, { button: 0, clientX: 100 });
  fireEvent.pointerMove(handle, { clientX: 1000 });
  fireEvent.keyDown(handle, { key: "Escape" });
  fireEvent.pointerUp(handle);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(preview).toHaveBeenLastCalledWith(null);
  fireEvent.keyDown(handle, { key: "End" });
  expect(commit).toHaveBeenLastCalledWith(800);
  fireEvent.keyDown(handle, { key: "ArrowLeft" });
  expect(commit).toHaveBeenLastCalledWith(300);
});
it("retains one view draft across configuration sections and blocks failed saves", async () => {
  const user = userEvent.setup(),
    table = newTable(0),
    save = vi.fn().mockRejectedValue(new Error("校验失败")),
    close = vi.fn();
  render(
    <ViewSettings
      table={table}
      view={table.views[0]}
      initialSection="filters"
      save={save}
      close={close}
    />,
  );
  await user.click(screen.getByRole("button", { name: "增加筛选" }));
  await user.type(screen.getByRole("textbox", { name: "筛选 1 值" }), "目标");
  await user.click(screen.getByRole("tab", { name: "基本" }));
  await user.clear(screen.getByRole("textbox", { name: "视图名称" }));
  await user.type(
    screen.getByRole("textbox", { name: "视图名称" }),
    "重点资料",
  );
  await user.click(screen.getByRole("tab", { name: "筛选" }));
  expect(screen.getByRole("textbox", { name: "筛选 1 值" })).toHaveValue(
    "目标",
  );
  await user.click(screen.getByRole("button", { name: "保存视图" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "重点资料",
      config: expect.objectContaining({
        filters: [expect.objectContaining({ value: "目标" })],
      }),
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("校验失败");
  expect(close).not.toHaveBeenCalled();
});
it("preserves option colors as data and restores focus after closing a detail drawer", async () => {
  const table = newTable(0),
    option = table.fields[1].options![0];
  render(<FieldValue field={table.fields[1]} value={option.id} />);
  expect(screen.getByText(option.label)).toHaveStyle({
    "--option-color": option.color,
  });
  const user = userEvent.setup();
  function Drawer() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>打开详情</button>
        {open && (
          <Modal title="记录详情" variant="drawer" close={() => setOpen(false)}>
            <p>字段内容</p>
          </Modal>
        )}
      </>
    );
  }
  render(<Drawer />);
  await user.click(screen.getByRole("button", { name: "打开详情" }));
  const drawer = screen.getByRole("dialog", { name: "记录详情" });
  expect(drawer).toHaveClass("is-drawer");
  await user.click(within(drawer).getByRole("button", { name: "关闭" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "打开详情" })).toHaveFocus(),
  );
});
