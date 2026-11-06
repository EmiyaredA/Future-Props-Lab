import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountAccessProvider } from "@platform/auth/AccountAccess";
import { ApiError } from "@platform/api/client";
import * as api from "@features/thought-workshop/multitable/api";
import * as storage from "@features/thought-workshop/multitable/drafts";
import { TableEditor } from "@features/thought-workshop/multitable/TableEditor";
import { useTableDocument } from "@features/thought-workshop/multitable/useTableDocument";
import {
  newTable,
  parseCell,
  readTsv,
  writeTsv,
} from "@features/thought-workshop/multitable/model";
import { serializeTableSave } from "@features/thought-workshop/multitable/saveLane";

vi.mock("@features/thought-workshop/multitable/api", async (original) => ({
  ...(await original<
    typeof import("@features/thought-workshop/multitable/api")
  >()),
  tableStructure: vi.fn(),
  tableOperations: vi.fn(),
  tableRecords: vi.fn(),
}));
vi.mock("@features/thought-workshop/multitable/drafts", () => ({
  drafts: vi.fn(),
  putDraft: vi.fn(),
  dropDraft: vi.fn(),
}));
const table = newTable(0);
const structure: api.Structure = {
  note_id: "note",
  revision: 3,
  tables: [table],
  role: "edit",
  can_edit: true,
  can_manage: false,
};
const operation = (name: string): api.Operation => ({
  op: "records.put",
  table_id: table.id,
  records: [
    { id: "record", position: 0, values: { [table.fields[0].id]: name } },
  ],
});
function wrapper({ children }: { children: ReactNode }) {
  return (
    <AccountAccessProvider userId="owner" permissions={["content.write"]}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        {children}
      </QueryClientProvider>
    </AccountAccessProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(storage.drafts).mockResolvedValue([]);
  vi.mocked(storage.putDraft).mockResolvedValue("draft");
  vi.mocked(storage.dropDraft).mockResolvedValue(undefined);
  vi.mocked(api.tableStructure).mockResolvedValue(structure);
  vi.mocked(api.tableOperations).mockResolvedValue({
    structure: { ...structure, revision: 4 },
  });
  vi.mocked(api.tableRecords).mockResolvedValue({
    items: [],
    total: 0,
    revision: structure.revision,
    people: {},
  });
});
describe("多维表格编辑与恢复", () => {
  it("retains edits added while the preceding batch is in flight", async () => {
    let finish!: (
      value: Awaited<ReturnType<typeof api.tableOperations>>,
    ) => void;
    vi.mocked(api.tableOperations).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useTableDocument("note", {}), {
      wrapper,
    });
    await waitFor(() => expect(result.current.structure.data).toBeDefined());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.enqueue(operation("第一版")));
    let saving!: Promise<void>;
    act(() => {
      saving = result.current.flush();
    });
    await waitFor(() => expect(api.tableOperations).toHaveBeenCalledTimes(1));
    act(() => result.current.enqueue(operation("第二版")));
    await act(async () => {
      finish({ structure: { ...structure, revision: 4 } });
      await saving;
    });
    expect(result.current.pending).toEqual([operation("第二版")]);
    await act(async () => {
      await result.current.flush();
    });
    expect(api.tableOperations).toHaveBeenLastCalledWith(
      "note",
      4,
      [operation("第二版")],
      {},
    );
  });
  it("preserves a conflicting batch and never retries until explicit resolution", async () => {
    vi.mocked(api.tableOperations).mockRejectedValue(
      new ApiError(
        "冲突",
        {
          current: {
            structure,
            records: {
              [table.id]: [
                {
                  id: "record",
                  position: 0,
                  values: { [table.fields[0].id]: "服务器内容" },
                },
              ],
            },
          },
        },
        409,
      ),
    );
    const { result } = renderHook(() => useTableDocument("note", {}), {
      wrapper,
    });
    await waitFor(() => expect(result.current.structure.data).toBeDefined());
    await waitFor(() => expect(result.current.ready).toBe(true));
    act(() => result.current.enqueue(operation("保留")));
    await act(async () => {
      await expect(result.current.flush()).rejects.toThrow("冲突");
    });
    expect(result.current.state).toBe("conflict");
    expect(
      result.current.conflict?.records[table.id][0].values[table.fields[0].id],
    ).toBe("服务器内容");
    expect(result.current.pending).toEqual([operation("保留")]);
    await expect(result.current.flush()).rejects.toThrow("保存已停止");
    expect(api.tableOperations).toHaveBeenCalledTimes(1);
    expect(storage.putDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        document: "owner/owner/note",
        revision: 3,
        operations: [operation("保留")],
      }),
    );
    expect(storage.dropDraft).not.toHaveBeenCalled();
  });
  it("keeps the recoverable original if copying it into this tab fails", async () => {
    const draft: storage.TableDraft = {
      key: "original",
      document: "owner/owner/note",
      tab: "old",
      revision: 2,
      time: 1,
      operations: [operation("恢复")],
    };
    vi.mocked(storage.drafts).mockResolvedValue([draft]);
    vi.mocked(storage.putDraft).mockRejectedValue(new Error("磁盘不可用"));
    const { result } = renderHook(() => useTableDocument("note", {}), {
      wrapper,
    });
    await waitFor(() => expect(result.current.recovery).toHaveLength(1));
    await act(async () => {
      await expect(result.current.recover(draft)).rejects.toThrow("磁盘不可用");
    });
    expect(storage.dropDraft).not.toHaveBeenCalled();
    expect(result.current.recovery).toHaveLength(1);
    expect(api.tableOperations).not.toHaveBeenCalled();
  });
  it("round trips quoted TSV and rejects invalid types before a paste can be submitted", () => {
    const cells = [
      ["多行\n备注", '带"引号', "两\t列"],
      ["中文", "", "结尾"],
    ];
    expect(readTsv(writeTsv(cells))).toEqual(cells);
    expect(() => readTsv('"未完成')).toThrow("引号");
    expect(() =>
      parseCell({ ...table.fields[0], type: "date" }, "2026-02-30"),
    ).toThrow();
    expect(() => parseCell(table.fields[1], "不存在的状态")).toThrow(
      "没有选项",
    );
    expect(parseCell(table.fields[1], "进行中")).toBe(
      table.fields[1].options![1].id,
    );
  });
  it("autosaves an embedded table without flashing a save button", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <TableEditor
        noteId="note"
        embedded={{ tableId: table.id, viewId: table.views[0].id }}
      />,
      { wrapper },
    );
    const editor = () =>
      screen.getByRole("region", { name: "多维表格", hidden: true });
    await user.click(await screen.findByRole("button", { name: "新增记录" }));
    expect(
      within(editor()).queryByRole("button", { name: "保存", hidden: true }),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(api.tableOperations).toHaveBeenCalled());
    expect(
      within(editor()).queryByRole("button", { name: "保存", hidden: true }),
    ).not.toBeInTheDocument();

    rerender(<TableEditor noteId="note" />);
    await user.click(
      within(editor()).getByRole("button", { name: "新增记录", hidden: true }),
    );
    expect(
      within(editor()).getByRole("button", { name: "保存", hidden: true }),
    ).toBeInTheDocument();
  });
  it("serializes a document's writes and allows later writes after rejection", async () => {
    const events: string[] = [];
    let finish!: () => void;
    const one = serializeTableSave("lane", async () => {
      events.push("first");
      await new Promise<void>((r) => {
        finish = r;
      });
      throw new Error("失败");
    });
    const two = serializeTableSave("lane", async () => {
      events.push("second");
      return 2;
    });
    await waitFor(() => expect(events).toEqual(["first"]));
    finish();
    await expect(one).rejects.toThrow("失败");
    await expect(two).resolves.toBe(2);
    expect(events).toEqual(["first", "second"]);
  });
});
