import { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { editorExtensions } from "@features/thought-workshop/editorExtensions";
import {
  applyTableColumnWidths,
  fillMissingColumnWidths,
  resizeTableColumns,
  TABLE_COLUMN_MIN_WIDTH,
} from "@features/thought-workshop/tableColumnResize";

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors.length = 0;
});

function cell(text: string, header: boolean, width: number | null) {
  return {
    type: header ? "tableHeader" : "tableCell",
    attrs: width == null ? {} : { colwidth: [width] },
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  };
}

function mount(widths: Array<number | null>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const row = (header: boolean) => ({
    type: "tableRow",
    content: widths.map((width, index) =>
      cell(`${header ? "h" : "b"}${index}`, header, width),
    ),
  });
  const editor = new Editor({
    element: host,
    extensions: editorExtensions(),
    content: {
      type: "doc",
      content: [{ type: "table", content: [row(true), row(false)] }],
    },
  });
  editors.push(editor);
  return { host, editor };
}

function columnWidths(host: HTMLElement) {
  return Array.from(host.querySelectorAll("col")).map(
    (column) => (column as HTMLElement).style.width,
  );
}

describe("文档表格列宽", () => {
  it("只改变被拖动的列，其余列保持原来的宽度", () => {
    expect(resizeTableColumns([100, 140, 80], 0, 180)).toEqual([180, 140, 80]);
    expect(resizeTableColumns([100, 140, 80], 1, 30)).toEqual([
      100,
      TABLE_COLUMN_MIN_WIDTH,
      80,
    ]);
    expect(resizeTableColumns([100, 140, 80], 4, 200)).toEqual([100, 140, 80]);
    expect(fillMissingColumnWidths([200, null, 80])).toEqual([200, 200, 80]);
    expect(fillMissingColumnWidths([null, null, null])).toBeNull();
    expect(fillMissingColumnWidths([120, 90, 160])).toBeNull();
  });

  it("未单独设置过的表格仍铺满正文，已有列宽的空列沿用相邻宽度", () => {
    const fluid = mount([null, null, null]);
    const fluidTable = fluid.host.querySelector("table") as HTMLTableElement;
    expect(fluidTable.dataset.fixedColumns).toBeUndefined();
    expect(fluidTable.style.width).toBe("");
    expect(
      Array.from(fluid.host.querySelectorAll("col")).map(
        (column) => (column as HTMLElement).style.minWidth,
      ),
    ).toEqual(["60px", "60px", "60px"]);

    const sized = mount([200, null, 80]);
    const table = sized.host.querySelector("table") as HTMLTableElement;
    expect(table.dataset.fixedColumns).toBe("true");
    expect(columnWidths(sized.host)).toEqual(["200px", "200px", "80px"]);
    expect(table.style.width).toBe("480px");
  });

  it("写回列宽时不改动未拖动的列", () => {
    const { host, editor } = mount([100, 140, 80]);
    const tr = editor.state.tr;
    expect(applyTableColumnWidths(tr, 0, [220, 140, 80])).toBe(true);
    editor.view.dispatch(tr);
    const row = editor.state.doc.firstChild?.firstChild;
    expect(
      Array.from({ length: row?.childCount ?? 0 }, (_, index) => {
        return row?.child(index).attrs.colwidth;
      }),
    ).toEqual([[220], [140], [80]]);
    expect(columnWidths(host)).toEqual(["220px", "140px", "80px"]);
    expect((host.querySelector("table") as HTMLTableElement).style.width).toBe(
      "440px",
    );
  });

  it("在已定宽的表格中插入列时，原有列宽保持不变", () => {
    const { host, editor } = mount([100, 160, 80]);
    let textPos = 1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "h0") {
        textPos = pos + 1;
        return false;
      }
    });
    editor.commands.setTextSelection(textPos);
    expect(editor.commands.addColumnAfter()).toBe(true);
    expect(columnWidths(host)).toEqual(["100px", "100px", "160px", "80px"]);
    expect((host.querySelector("table") as HTMLTableElement).style.width).toBe(
      "440px",
    );
  });
});
