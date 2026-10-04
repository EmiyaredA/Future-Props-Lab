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
function grid(readOnly = false) {
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
