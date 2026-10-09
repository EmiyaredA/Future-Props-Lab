import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { GridView } from "@features/thought-workshop/multitable/GridView";
import {
  deleteFieldDraft,
  insertTextField,
  sortFieldFirst,
} from "@features/thought-workshop/multitable/fieldHeaderActions";
import {
  fittedColumnWidths,
  newTable,
} from "@features/thought-workshop/multitable/model";
import type { Field } from "@features/thought-workshop/multitable/api";
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
    insertField: vi.fn(),
    deleteField: vi.fn(),
    openFilters: vi.fn(),
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
it("opens the field menu from the header, then edits, and keeps resizing independent", async () => {
  const user = userEvent.setup(),
    { props, unmount } = grid();
  const header = screen.getByRole("button", { name: "字段操作 名称" });
  header.focus();
  await user.keyboard("{Enter}");
  const menu = screen.getByRole("menu", { name: "字段操作 名称" });
  expect(props.editField).not.toHaveBeenCalled();
  expect(
    within(menu).getByRole("menuitem", { name: "删除字段" }),
  ).toBeDisabled();
  expect(
    within(menu).getByRole("menuitem", { name: "向左插入字段" }),
  ).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("menu", { name: "字段操作 名称" })).toBeNull();
  await user.keyboard(" ");
  await user.click(screen.getByRole("menuitem", { name: "修改字段" }));
  expect(props.editField).toHaveBeenCalledOnce();
  expect(props.editField).toHaveBeenLastCalledWith(table.fields[0], header);
  screen.getByRole("separator", { name: "调整名称列宽" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(props.configure).toHaveBeenCalledOnce();
  expect(props.editField).toHaveBeenCalledOnce();
  unmount();
  grid(true, props.editField);
  expect(screen.queryByRole("button", { name: /字段操作/ })).toBeNull();
});
it("hides, sorts, and filters the current field from the header menu", async () => {
  const user = userEvent.setup(),
    { props } = grid();
  const status = table.fields[1];
  await user.click(screen.getByRole("button", { name: "字段操作 状态" }));
  expect(screen.getByRole("menuitem", { name: "删除字段" })).toBeEnabled();
  await user.click(screen.getByRole("menuitem", { name: "隐藏字段" }));
  expect(props.configure).toHaveBeenCalledWith(
    expect.objectContaining({
      config: expect.objectContaining({ hidden_fields: [status.id] }),
    }),
  );
  await user.click(screen.getByRole("button", { name: "字段操作 状态" }));
  await user.click(screen.getByRole("menuitem", { name: "升序" }));
  expect(props.configure).toHaveBeenLastCalledWith(
    expect.objectContaining({
      config: expect.objectContaining({
        sorts: [{ field_id: status.id, direction: "asc" }],
      }),
    }),
  );
  await user.click(screen.getByRole("button", { name: "字段操作 状态" }));
  await user.click(screen.getByRole("menuitem", { name: "按此字段筛选" }));
  expect(props.openFilters).toHaveBeenCalledOnce();
});
it("keeps earlier sorts, inserts beside the anchor, and blocks a field used by a board", () => {
  const dated = table.fields[2];
  const status = table.fields[1];
  expect(
    sortFieldFirst(
      {
        ...table.views[0],
        config: {
          filter_mode: "all",
          sorts: [{ field_id: dated.id, direction: "desc" }],
        },
      },
      status.id,
      "asc",
    ).config?.sorts,
  ).toEqual([
    { field_id: status.id, direction: "asc" },
    { field_id: dated.id, direction: "desc" },
  ]);
  expect(() => insertTextField(table, table.fields[0], "before")).toThrow(
    /名称/,
  );
  const inserted = insertTextField(table, status, "after");
  const created = inserted.fields.find((field) => field.name === "新字段");
  expect(created).toMatchObject({
    type: "text",
    position: status.position + 1,
  });
  expect(
    inserted.fields.find((field) => field.id === status.id)?.position,
  ).toBe(status.position);
  const ordered = structuredClone(table);
  ordered.views[0].config = {
    filter_mode: "all",
    column_order: ordered.fields.map((field) => field.id),
  };
  const beside = insertTextField(ordered, ordered.fields[1], "after");
  const added = beside.fields.find((field) => field.name === "新字段");
  expect(beside.views[0].config?.column_order).toEqual([
    ordered.fields[0].id,
    ordered.fields[1].id,
    added?.id,
    ordered.fields[2].id,
    ordered.fields[3].id,
  ]);
  const full = structuredClone(table);
  full.fields = Array.from({ length: 50 }, (_, index) => ({
    id: `field-${index}`,
    name: index === 0 ? "名称" : `字段${index}`,
    type: "text" as const,
    position: index,
    options: [],
  }));
  expect(() => insertTextField(full, full.fields[1], "after")).toThrow(/50/);
  expect(() => deleteFieldDraft(table, table.fields[0])).toThrow(/名称/);
  const blocked = structuredClone(table);
  blocked.views[0].config = {
    filter_mode: "all",
    stack_field_id: status.id,
  };
  expect(() => deleteFieldDraft(blocked, status)).toThrow(/看板或日历/);
  const removed = deleteFieldDraft(table, dated);
  expect(removed.fields.map((field) => field.id)).not.toContain(dated.id);
  expect(removed.fields.map((field) => field.position)).toEqual([0, 1, 2]);
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
it("fits an embedded comparison into the note and resizes without field controls", async () => {
  const user = userEvent.setup();
  const fields: Field[] = [
    { id: "name", name: "方案", type: "text", position: 0, options: [] },
    { id: "dim", name: "比较维度", type: "text", position: 1, options: [] },
    { id: "result", name: "比较结果", type: "text", position: 2, options: [] },
    { id: "proof", name: "验证证据", type: "note", position: 3, options: [] },
  ];
  const fitted = fittedColumnWidths(fields, undefined, 700);
  expect(fitted).toMatchObject({ name: 136, proof: 128 });
  expect(fitted.dim).toBe(fitted.result);
  expect(fitted.result).toBeGreaterThan(fitted.name);
  expect(fitted.name + fitted.dim + fitted.result + fitted.proof).toBe(
    700 - 48,
  );
  expect(fittedColumnWidths(fields, { result: 400 }, 700).result).toBe(400);
  const onColumnWidth = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GridView
        table={{ ...table, fields }}
        view={table.views[0]}
        rows={[]}
        readOnly={false}
        change={vi.fn()}
        error={vi.fn()}
        open={vi.fn()}
        scope={{}}
        noteId="note"
        positionKey="embed"
        loadMore={vi.fn()}
        hasMore={false}
        embedded
        onColumnWidth={onColumnWidth}
      />
    </QueryClientProvider>,
  );
  expect(screen.queryByRole("button", { name: /字段操作/ })).toBeNull();
  const handle = screen.getByRole("separator", { name: "调整比较结果列宽" });
  const before = Number(handle.getAttribute("aria-valuenow"));
  handle.focus();
  await user.keyboard("{ArrowRight}");
  expect(onColumnWidth).toHaveBeenCalledOnce();
  expect(onColumnWidth).toHaveBeenCalledWith("result", before + 20);
});
