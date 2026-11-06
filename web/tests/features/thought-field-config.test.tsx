import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  newTable,
  display,
  parseCell,
} from "@features/thought-workshop/multitable/model";
import {
  dateFormats,
  formatFieldValue,
} from "@features/thought-workshop/multitable/formatting";
import {
  mergeFieldChanges,
  needsFieldPreview,
} from "@features/thought-workshop/multitable/fieldChanges";
import { FieldForm } from "@features/thought-workshop/multitable/FieldForm";
import { FieldEditor } from "@features/thought-workshop/multitable/FieldEditor";
import type { Field } from "@features/thought-workshop/multitable/api";
import * as api from "@features/thought-workshop/multitable/api";
import type { Note } from "@features/thought-workshop/api";
import { staticTableContent } from "@features/thought-workshop/multitable/staticContent";

vi.mock("@features/thought-workshop/multitable/api", async (original) => ({
  ...(await original<
    typeof import("@features/thought-workshop/multitable/api")
  >()),
  tableStructure: vi.fn(),
  tableRecords: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each(dateFormats)(
  "formats date %s without changing canonical input",
  (format) => {
    const field = { ...newTable(0).fields[2], config: { date_format: format } };
    expect(formatFieldValue(field, "2026-10-04")).not.toBe("");
    expect(display(field, "2026-10-04")).toBe("2026-10-04");
    expect(parseCell(field, "2026-10-04")).toBe("2026-10-04");
  },
);
it("rounds only displayed numbers and preserves full precision for editing and copy", () => {
  const field: Field = {
    id: "number",
    name: "预算",
    position: 1,
    type: "number",
    config: { decimal_places: 2, use_grouping: true },
  };
  expect(formatFieldValue(field, 12345.6789)).toBe("12,345.68");
  expect(formatFieldValue(field, -1.235)).toBe("-1.24");
  expect(display(field, 12345.6789)).toBe("12345.6789");
  expect(parseCell(field, display(field, 12345.6789))).toBe(12345.6789);
});
it("applies display formats to static content without exposing canonical values", async () => {
  const table = newTable(0);
  table.fields[2].config = { date_format: "YYYY年M月D日" };
  table.fields[3] = {
    ...table.fields[3],
    type: "number",
    config: { decimal_places: 2, use_grouping: true },
  };
  vi.mocked(api.tableStructure).mockResolvedValue({
    note_id: "note",
    revision: 1,
    tables: [table],
    can_edit: false,
    can_manage: false,
    role: "read",
  });
  vi.mocked(api.tableRecords).mockResolvedValue({
    items: [
      {
        id: "r",
        position: 0,
        values: {
          [table.fields[2].id]: "2026-10-04",
          [table.fields[3].id]: 12345.6789,
        },
      },
    ],
    total: 1,
    revision: 1,
    groups: {},
  });
  const result = await staticTableContent({
    id: "note",
    kind: "multitable",
  } as Note);
  expect(JSON.stringify(result)).toContain("2026年10月4日");
  expect(JSON.stringify(result)).toContain("12,345.68");
});
it("merges a field draft with unrelated fresh changes and rejects stale edits", () => {
  const base = newTable(0),
    draft = structuredClone(base),
    latest = structuredClone(base);
  draft.fields[2].config = { date_format: "YYYY年M月D日" };
  latest.fields[1].name = "维护状态";
  latest.views[0].name = "最新视图";
  const result = mergeFieldChanges(base, draft, latest);
  expect(result.fields[1].name).toBe("维护状态");
  expect(result.views[0].name).toBe("最新视图");
  expect(result.fields[2].config?.date_format).toBe("YYYY年M月D日");
  expect(needsFieldPreview(base, draft)).toBe(false);
  latest.fields[2].name = "发布日期";
  expect(() => mergeFieldChanges(base, draft, latest)).toThrow(
    "已被其他操作修改",
  );
  draft.fields[1].type = "multi";
  expect(needsFieldPreview(base, draft)).toBe(true);
});
it("edits and reorders option labels and colors without replacing their IDs", async () => {
  const user = userEvent.setup(),
    table = newTable(0),
    change = vi.fn();
  function Form() {
    const [field, setField] = useState(table.fields[1]);
    return (
      <FieldForm
        field={field}
        primary={false}
        change={(f) => {
          change(f);
          setField(f);
        }}
      />
    );
  }
  render(<Form />);
  const first = table.fields[1].options![0];
  await user.clear(screen.getAllByRole("textbox", { name: "状态选项名称" })[0]);
  await user.type(
    screen.getAllByRole("textbox", { name: "状态选项名称" })[0],
    "待核验",
  );
  await user.click(screen.getByRole("button", { name: "下移选项 待核验" }));
  await user.click(screen.getByRole("button", { name: "状态 待核验颜色" }));
  await user.click(screen.getByRole("button", { name: "选择颜色 #46B978" }));
  const saved = change.mock.calls.at(-1)![0] as Field;
  expect(saved.options![1]).toEqual({
    ...first,
    label: "待核验",
    color: "#46B978",
  });
});
it("keeps the anchored draft across rerenders and failed saves, then restores focus", async () => {
  const user = userEvent.setup(),
    table = newTable(0),
    save = vi.fn().mockRejectedValue(new Error("需要核对最新配置"));
  const preview = vi.fn();
  let anchor: HTMLElement;
  function Editor() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          onClick={(e) => {
            anchor = e.currentTarget;
            setOpen(true);
          }}
        >
          日期表头
        </button>
        {open && (
          <FieldEditor
            field={table.fields[2]}
            table={table}
            anchor={anchor}
            close={() => setOpen(false)}
            preview={preview}
            save={save}
          />
        )}
      </>
    );
  }
  const result = render(<Editor />);
  await user.click(screen.getByRole("button", { name: "日期表头" }));
  await user.type(screen.getByRole("textbox", { name: "字段名称" }), "计划");
  result.rerender(<Editor />);
  expect(screen.getByRole("textbox", { name: "字段名称" })).toHaveValue(
    "截止日期计划",
  );
  await user.click(screen.getByRole("button", { name: "保存字段" }));
  expect(preview).not.toHaveBeenCalled();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "需要核对最新配置",
  );
  await user.click(screen.getByRole("button", { name: "取消" }));
  expect(screen.getByRole("button", { name: "日期表头" })).toHaveFocus();
});
it("requires a valid conversion preview before applying a type change", async () => {
  const user = userEvent.setup(),
    table = newTable(0),
    preview = vi.fn().mockResolvedValue({
      valid: true,
      affected_records: 1,
      errors: [],
      samples: [],
    }),
    save = vi.fn().mockResolvedValue(undefined);
  const anchor = document.createElement("button");
  document.body.append(anchor);
  const result = render(
    <FieldEditor
      field={table.fields[3]}
      table={table}
      anchor={anchor}
      close={vi.fn()}
      preview={preview}
      save={save}
    />,
  );
  await user.click(screen.getByRole("combobox", { name: "备注类型" }));
  await user.click(screen.getByRole("option", { name: "数字" }));
  await user.click(screen.getByRole("button", { name: "预览字段变更" }));
  expect(save).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "保存字段" }));
  expect(save).toHaveBeenCalledOnce();
  act(() => {
    vi.stubGlobal("innerWidth", 390);
    fireEvent(window, new Event("resize"));
  });
  expect(
    within(screen.getByRole("dialog")).getByRole("button", { name: "关闭" }),
  ).toBeVisible();
  expect(screen.getByRole("dialog")).toHaveStyle({
    width: "358px",
    left: "16px",
    top: "16px",
  });
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
    left: 950,
    bottom: 740,
  } as DOMRect);
  act(() => {
    vi.stubGlobal("innerWidth", 1024);
    vi.stubGlobal("innerHeight", 768);
    fireEvent(window, new Event("resize"));
  });
  expect(screen.getByRole("dialog")).toHaveStyle({
    width: "420px",
    left: "588px",
    top: "16px",
    maxHeight: "736px",
  });
  result.unmount();
  anchor.remove();
});
