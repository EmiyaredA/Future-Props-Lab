import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { ApiError } from "@platform/api/client";
import { editorExtensions } from "@features/thought-workshop/editorExtensions";
import {
  parseMarkdown,
  toMarkdown,
  markdownWarnings,
} from "@features/thought-workshop/markdown";
import { useNoteDraft } from "@features/thought-workshop/useNoteDraft";
import * as api from "@features/thought-workshop/api";

const note: api.Note = {
  id: "note-a",
  title: "草稿",
  document: { type: "doc", content: [{ type: "paragraph" }] },
  schema_version: 2,
  tags: [],
  favorite: false,
  pinned: false,
  knowledge_base_id: "kb",
  folder_id: null,
  position: 0,
  is_home: false,
  deleted_at: null,
  revision: 0,
  created_at: "2026-09-08T00:00:00Z",
  updated_at: "2026-09-08T00:00:00Z",
  excerpt: "",
};

describe("思绪工坊富文本", () => {
  it("round-trips rich structures through editor JSON without losing marks", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "彩色文字",
              marks: [
                {
                  type: "textStyle",
                  attrs: { color: "#e57b59", fontSize: "24px" },
                },
                { type: "bold" },
              ],
            },
          ],
        },
        {
          type: "image",
          attrs: { assetId: "image-id", width: 320, alt: "图片" },
        },
        { type: "blockMath", attrs: { latex: "x^2" } },
        { type: "mermaid", attrs: { source: "graph TD; A-->B" } },
      ],
    };
    const first = new Editor({ extensions: editorExtensions(), content: doc });
    const second = new Editor({
      extensions: editorExtensions(),
      content: first.getJSON(),
    });
    expect(second.getJSON()).toEqual(first.getJSON());
    expect(JSON.stringify(second.getJSON())).not.toContain("blob:");
    expect(markdownWarnings(second.getJSON())).toHaveLength(2);
    first.destroy();
    second.destroy();
  });
  it("converts Markdown lists, tables, formulas and editable diagrams", () => {
    const doc = parseMarkdown(
      "# 标题\n\n- [ ] 待办\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n$x^2$\n\n$$\na+b\n$$\n\n```mermaid\ngraph TD; A-->B\n```",
    );
    const json = JSON.stringify(doc);
    expect(json).toContain("taskItem");
    expect(json).toContain("table");
    expect(json).toContain("inlineMath");
    expect(json).toContain("blockMath");
    expect(json).toContain('"type":"mermaid"');
    const output = toMarkdown(doc, {});
    expect(output).toContain("$x^2$");
    expect(output).toContain("```mermaid");
  });
});

describe("笔记保存队列", () => {
  it("serializes overlapping saves and preserves edits made while a request is in flight", async () => {
    let resolve!: (value: api.Note) => void;
    const save = vi
      .spyOn(api, "saveNote")
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValueOnce({ ...note, title: "第二版", revision: 2 });
    const { result, unmount } = renderHook(() => useNoteDraft(note, () => {}));
    act(() => result.current.change({ title: "第一版" }));
    let first!: Promise<api.Note>;
    act(() => {
      first = result.current.flush();
    });
    act(() => result.current.change({ title: "第二版" }));
    let next!: Promise<api.Note>;
    act(() => {
      next = result.current.flush();
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ ...note, title: "第一版", revision: 1 });
      await first;
      await next;
    });
    expect(save).toHaveBeenNthCalledWith(
      2,
      "note-a",
      expect.objectContaining({ title: "第二版" }),
      1,
    );
    expect(result.current.draft.title).toBe("第二版");
    expect(result.current.isDirty()).toBe(false);
    unmount();
    save.mockRestore();
  });
  it("stops on conflicts, keeps local text and explicitly adopts server content", async () => {
    const server = { ...note, title: "服务器版本", revision: 2 };
    const save = vi
      .spyOn(api, "saveNote")
      .mockRejectedValue(new ApiError("冲突", { current: server }, 409));
    const { result, unmount } = renderHook(() => useNoteDraft(note, () => {}));
    act(() => result.current.change({ title: "本地版本" }));
    await act(async () => {
      await result.current.flush().catch(() => {});
    });
    await waitFor(() => expect(result.current.state).toBe("conflict"));
    expect(result.current.draft.title).toBe("本地版本");
    await expect(result.current.flush()).rejects.toThrow("请先处理保存冲突");
    expect(save).toHaveBeenCalledTimes(1);
    act(() => result.current.adopt(server));
    expect(result.current.draft.title).toBe("服务器版本");
    unmount();
    save.mockRestore();
  });
});
