import { describe, expect, it } from "vitest";
import type { JSONContent } from "@tiptap/core";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { historyDiff } from "../../src/features/thought-workshop/historyDiff";

const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const doc = (...content: JSONContent[]): JSONContent => ({
  type: "doc",
  content,
});
describe("document history preview", () => {
  it("uses real editor node boundaries for empty and nested blocks", () => {
    const current = doc({ type: "paragraph" }, paragraph("新增"), {
      type: "bulletList",
      content: [{ type: "listItem", content: [paragraph("条目")] }],
    });
    const result = historyDiff(current, doc());
    const node = getSchema([StarterKit]).nodeFromJSON(result.document);
    for (const mark of result.marks) {
      expect(mark.to - mark.from).toBe(node.nodeAt(mark.from)?.nodeSize);
    }
  });
  it("anchors unchanged paragraphs and marks inline replacement without changing source", () => {
    const previous = doc(
      paragraph("开头"),
      paragraph("一个旧想法"),
      paragraph("结尾"),
    );
    const current = doc(
      paragraph("开头"),
      paragraph("一个新想法"),
      paragraph("结尾"),
    );
    const original = JSON.stringify(current);
    const result = historyDiff(current, previous);
    expect(result.marks.map((m) => m.kind)).toEqual(["deleted", "added"]);
    expect(
      result.document.content?.[1].content?.map((n) => n.text).join(""),
    ).toBe("一个旧新想法");
    expect(JSON.stringify(current)).toBe(original);
    expect(historyDiff(current, current).marks).toEqual([]);
    expect(historyDiff(current).document).toBe(current);
  });
  it("preserves bold text and marks pure formatting changes", () => {
    const old = paragraph("原来的段落");
    const changed = {
      ...old,
      content: [
        { type: "text", text: "原来的段落", marks: [{ type: "bold" }] },
      ],
    };
    const result = historyDiff(doc(changed), doc(old));
    expect(result.marks.map((m) => m.kind)).toEqual(["deleted", "format"]);
    expect(result.document.content?.[1]).toEqual(changed);
  });
  it("retains image attributes, table structure and deleted blocks", () => {
    const image = { type: "image", attrs: { assetId: "original", width: 320 } };
    const table = {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [{ type: "tableCell", content: [paragraph("数据")] }],
        },
      ],
    };
    const result = historyDiff(
      doc({ ...image, attrs: { ...image.attrs, width: 640 } }, table),
      doc(image, paragraph("删除")),
    );
    expect(result.document.content).toContainEqual(table);
    expect(result.document.content).toContainEqual(image);
    expect(result.marks.every((mark) => mark.block)).toBe(true);
  });
  it("does not hide formatting changes made alongside a text edit", () => {
    const old = paragraph("先理解需求");
    const changed = {
      ...old,
      content: [
        { type: "text", text: "先理解需求，再修改", marks: [{ type: "bold" }] },
      ],
    };
    const result = historyDiff(doc(changed), doc(old));
    expect(result.marks.map((mark) => mark.kind)).toEqual([
      "deleted",
      "format",
    ]);
    expect(result.document.content).toEqual([old, changed]);
  });
  it("marks insertions and removals including empty paragraphs and emoji", () => {
    const result = historyDiff(
      doc(paragraph("👩好"), { type: "paragraph" }),
      doc(paragraph("👨好")),
    );
    expect(
      result.document.content?.[0].content?.map((n) => n.text).join(""),
    ).toBe("👨👩好");
    expect(result.marks.length).toBe(3);
  });
});
