import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { GridView } from "@features/thought-workshop/multitable/GridView";
import { newTable } from "@features/thought-workshop/multitable/model";
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 44,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 44,
        size: 44,
      })),
    scrollToIndex: vi.fn(),
  }),
}));
const table = newTable(0),
  row = {
    id: "row",
    position: 0,
    values: { [table.fields[0].id]: "已有任务" },
  };
function grid(readOnly = false, editField = vi.fn()) {
  const change = vi.fn(),
    error = vi.fn();
  const props = {
    table,
    view: table.views[0],
    rows: [row],
    readOnly,
    change,
    error,
    open: vi.fn(),
    scope: {},
    noteId: "note",
    positionKey: "test",
    loadMore: vi.fn(),
    hasMore: false,
    editField,
    configure: vi.fn(),
  };
  const result = render(
    <QueryClientProvider client={new QueryClient()}>
      <GridView {...props} />
    </QueryClientProvider>,
  );
  return { ...result, change, error, props };
}
it("opens an existing cell after range selection and retains its dialog across a parent render", async () => {
  const user = userEvent.setup(),
    { rerender, props, change } = grid();
  await user.click(screen.getByRole("button", { name: "编辑 名称" }));
  const dialog = await screen.findByRole("dialog", { name: "编辑 名称" });
  await user.type(
    within(dialog).getByRole("textbox", { name: "名称" }),
    "追加",
  );
  rerender(
    <QueryClientProvider client={new QueryClient()}>
      <GridView {...props} scope={{}} change={(rows) => change(rows)} />
    </QueryClientProvider>,
  );
  expect(screen.getByRole("textbox", { name: "名称" })).toHaveValue(
    "已有任务追加",
  );
  await user.click(within(dialog).getByRole("button", { name: "完成" }));
  expect(change).toHaveBeenCalledWith([
    { ...row, values: { [table.fields[0].id]: "已有任务追加" } },
  ]);
});
it("opens header configuration by keyboard, keeps resizing independent and hides it in readonly mode", async () => {
  const user = userEvent.setup(),
    { props, unmount } = grid();
  const header = screen.getByRole("button", { name: "配置字段 名称" });
  header.focus();
  await user.keyboard("{Enter} ");
  expect(props.editField).toHaveBeenCalledTimes(2);
  expect(props.editField).toHaveBeenLastCalledWith(table.fields[0], header);
  screen.getByRole("separator", { name: "调整名称列宽" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(props.configure).toHaveBeenCalledOnce();
  expect(props.editField).toHaveBeenCalledTimes(2);
  unmount();
  grid(true, props.editField);
  expect(screen.queryByRole("button", { name: /配置字段/ })).toBeNull();
});
it("validates every pasted cell before submitting one batch and prevents readonly writes", () => {
  const { change, error, unmount } = grid();
  const region = screen.getByRole("region", { name: "表格记录" });
  fireEvent.mouseDown(screen.getAllByRole("gridcell")[0]);
  fireEvent.paste(region, {
    clipboardData: { getData: () => "新名称\t不存在的状态" },
  });
  expect(change).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledWith(expect.stringContaining("没有选项"));
  fireEvent.paste(region, {
    clipboardData: { getData: () => "新名称\t进行中" },
  });
  expect(change).toHaveBeenCalledTimes(1);
  unmount();
  const readonly = grid(true);
  fireEvent.mouseDown(screen.getAllByRole("gridcell")[0]);
  fireEvent.paste(screen.getByRole("region", { name: "表格记录" }), {
    clipboardData: { getData: () => "越权" },
  });
  expect(readonly.change).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: "编辑 名称" }),
  ).not.toBeInTheDocument();
});
it("copies formatted dates and numbers as canonical TSV and pastes without losing precision", () => {
  const { props, unmount } = grid();
  unmount();
  const formatted = structuredClone(table);
  formatted.fields[2].config = { date_format: "YYYY年M月D日" };
  formatted.fields[3] = {
    ...formatted.fields[3],
    type: "number",
    config: { decimal_places: 2, use_grouping: true },
  };
  const values = {
    ...row.values,
    [formatted.fields[2].id]: "2026-10-04",
    [formatted.fields[3].id]: 12345.6789,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GridView {...props} table={formatted} rows={[{ ...row, values }]} />
    </QueryClientProvider>,
  );
  expect(
    screen.getByRole("button", { name: "编辑 截止日期" }),
  ).toHaveTextContent("2026年10月4日");
  expect(screen.getByRole("button", { name: "编辑 备注" })).toHaveTextContent(
    "12,345.68",
  );
  const cells = screen.getAllByRole("gridcell");
  fireEvent.mouseDown(cells[2]);
  fireEvent.mouseDown(cells[3], { shiftKey: true });
  const copy = vi.fn(),
    region = screen.getByRole("region", { name: "表格记录" });
  fireEvent.copy(region, { clipboardData: { setData: copy } });
  expect(copy).toHaveBeenCalledWith("text/plain", "2026-10-04\t12345.6789");
  fireEvent.paste(region, {
    clipboardData: { getData: () => "2026-10-04\t12345.6789" },
  });
  expect(props.change).toHaveBeenCalledWith([{ ...row, values }]);
});
