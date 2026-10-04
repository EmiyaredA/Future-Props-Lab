import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { editorExtensions } from "@features/thought-workshop/editorExtensions";
import {
  FindDecorations,
  findMatches,
  replaceMatches,
} from "@features/thought-workshop/knowledge-tools/Find";
import { parseMarkdown, toMarkdown } from "@features/thought-workshop/markdown";
import { buildHtmlDocument } from "@features/thought-workshop/portability";
import { CanvasSvg } from "@features/thought-workshop/diagrams/CanvasSvg";
import {
  anchorPoint,
  edgePath,
  parseCanvasScene,
  sceneBounds,
  type CanvasScene,
} from "@features/thought-workshop/diagrams/model";
import {
  alignElements,
  insertCanvasTemplate,
} from "@features/thought-workshop/diagrams/sceneOperations";
import type { Note } from "@features/thought-workshop/api";

const options = { query: "测试", wholeWord: false, caseSensitive: false };
const content = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "测", marks: [{ type: "bold" }] },
        { type: "text", text: "试 Test testing TEST 测试 " },
        { type: "inlineMath", attrs: { latex: "测试" } },
        {
          type: "documentReference",
          attrs: { kind: "note", noteId: "note-b", label: "测试" },
        },
      ],
    },
    { type: "mermaid", attrs: { source: "graph TD; 测试-->B" } },
    { type: "paragraph" },
  ],
};
describe("knowledge content workflows", () => {
  it("finds across marks, excludes atom attributes, replaces all in one undo and respects IME/read-only", () => {
    const editor = new Editor({
      extensions: [...editorExtensions(undefined, true), FindDecorations],
      content,
    });
    try {
      expect(findMatches(editor.state.doc, options)).toHaveLength(2);
      expect(
        findMatches(editor.state.doc, {
          ...options,
          query: "Test",
          wholeWord: true,
        }),
      ).toHaveLength(2);
      expect(
        findMatches(editor.state.doc, {
          ...options,
          query: "Test",
          caseSensitive: true,
        }),
      ).toHaveLength(1);
      const original = editor.getJSON();
      expect(replaceMatches(editor, options, "新文", true)).toBe(true);
      expect(findMatches(editor.state.doc, options)).toHaveLength(0);
      expect(JSON.stringify(editor.getJSON())).toContain('"latex":"测试"');
      expect(JSON.stringify(editor.getJSON())).toContain('"label":"测试"');
      expect(JSON.stringify(editor.getJSON())).toContain("测试-->B");
      expect(editor.commands.undo()).toBe(true);
      expect(editor.getJSON()).toEqual(original);
      const composition = vi
        .spyOn(editor.view, "composing", "get")
        .mockReturnValue(true);
      expect(replaceMatches(editor, options, "禁止", true)).toBe(false);
      composition.mockRestore();
      editor.setEditable(false);
      expect(replaceMatches(editor, options, "禁止", true)).toBe(false);
    } finally {
      editor.destroy();
    }
  });
  it("round-trips callouts and stable references through Markdown and controlled HTML", () => {
    const source = {
      type: "doc",
      content: [
        {
          type: "callout",
          attrs: { variant: "warning" },
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "注意 " },
                {
                  type: "documentReference",
                  attrs: {
                    kind: "note",
                    noteId: "note-b",
                    label: "自定义",
                    customLabel: "自定义",
                  },
                },
                {
                  type: "documentReference",
                  attrs: {
                    kind: "official",
                    libraryId: "technical",
                    documentId: "system",
                    label: "系统架构",
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const markdown = toMarkdown(source, {});
    expect(markdown).toContain("[!WARNING]");
    const parsed = parseMarkdown(markdown);
    expect(parsed.content?.[0].type).toBe("callout");
    expect(
      parsed.content?.[0].content?.[0].content?.map((n) => n.type),
    ).toContain("documentReference");
    expect(JSON.stringify(parsed)).toContain('"customLabel":"自定义"');
    const editor = new Editor({
      extensions: editorExtensions(undefined, true),
      content: source,
    });
    const copy = new Editor({
      extensions: editorExtensions(undefined, true),
      content: editor.getHTML(),
    });
    expect(copy.getJSON()).toEqual(editor.getJSON());
    editor.destroy();
    copy.destroy();
  });
  it("exports included references as relative links and marks missing targets", async () => {
    const editor = new Editor({
      extensions: editorExtensions(undefined, true),
      content,
      editable: false,
    });
    const note: Note = {
      title: "导出",
      document: content,
      id: "export-note",
      knowledge_base_id: "kb",
      parent_id: null,
      position: 0,
      is_home: false,
      schema_version: 3,
      tags: [],
      favorite: false,
      pinned: false,
      revision: 0,
      created_at: "2026-10-03T00:00:00Z",
      updated_at: "2026-10-03T00:00:00Z",
      deleted_at: null,
      excerpt: "",
    };
    try {
      // No Mermaid parsing is needed for this reference-only fixture.
      editor.commands.setContent({
        type: "doc",
        content: [content.content[0]],
      });
      const exported = await buildHtmlDocument(note, editor, {
        referencePaths: { "note-b": "note-b.html" },
        directoryEntries: [
          {
            id: "note-b",
            title: "最新标题",
            excerpt: "",
            parent_id: null,
            position: 0,
            is_home: false,
            knowledge_base_id: "kb",
          },
        ],
      });
      expect(exported.html).toContain('href="note-b.html"');
      expect(exported.html).toContain("最新标题");
      const missing = await buildHtmlDocument(note, editor, {
        referencePaths: {},
        directoryEntries: [],
      });
      expect(missing.html).toContain("文档不可访问");
      expect(missing.html).not.toContain("data-ref-noteid");
    } finally {
      editor.destroy();
    }
  });
});

const scene: CanvasScene = {
  sceneVersion: 2,
  title: "几何一致性",
  elements: [
    {
      id: "a",
      kind: "rounded",
      x: 10000,
      y: -4000,
      width: 160,
      height: 80,
      text: "入口",
      fill: "#ffffff",
      stroke: "#365f62",
      fontSize: 20,
      textAlign: "left",
    },
    {
      id: "b",
      kind: "rounded",
      x: 10240,
      y: -3800,
      width: 80,
      height: 120,
      text: "目标",
      fill: "#ffffff",
      stroke: "#365f62",
    },
  ],
  edges: [
    {
      id: "e",
      source: "a",
      target: "b",
      label: "连线",
      arrow: true,
      style: "step",
      sourceAnchor: "bottom",
      targetAnchor: "top",
    },
  ],
};
describe("version two canvas geometry", () => {
  it("shares bounded coordinates and four-sided paths for editor and export", () => {
    expect(parseCanvasScene(scene)).toEqual(scene);
    expect(sceneBounds(scene)).toEqual({
      x: 9976,
      y: -4024,
      width: 368,
      height: 368,
    });
    const from = anchorPoint(scene.elements[0], "bottom"),
      to = anchorPoint(scene.elements[1], "top");
    const path = edgePath(from.x, from.y, to.x, to.y, true, true);
    expect(path).toBe("M10080,-3920 V-3860 H10280 V-3800");
    expect(renderToStaticMarkup(createElement(CanvasSvg, { scene }))).toContain(
      path,
    );
    for (const invalid of [
      { ...scene, sceneVersion: "2" },
      { ...scene, elements: [{ ...scene.elements[0], textAlign: ["left"] }] },
      { ...scene, edges: [{ ...scene.edges[0], sourceAnchor: ["bottom"] }] },
    ])
      expect(() => parseCanvasScene(invalid)).toThrow();
  });
  it("distributes unequal widths by boundaries and inserts templates without replacing the scene", () => {
    const value: CanvasScene = {
      ...scene,
      edges: [],
      elements: [
        { ...scene.elements[0], id: "a", x: 0, width: 100 },
        { ...scene.elements[0], id: "b", x: 130, width: 200 },
        { ...scene.elements[0], id: "c", x: 600, width: 50 },
      ],
    };
    const aligned = alignElements(
      value,
      new Set(["a", "b", "c"]),
      "horizontal",
    );
    expect(aligned.elements.map((e) => e.x)).toEqual([0, 250, 600]);
    expect(
      alignElements(value, new Set(["a", "b", "c"]), "right").elements.map(
        (e) => e.x + e.width,
      ),
    ).toEqual([650, 650, 650]);
    const inserted = insertCanvasTemplate(scene, value);
    expect(inserted.elements.slice(0, scene.elements.length)).toEqual(
      scene.elements,
    );
    expect(inserted.elements.filter((e) => e.kind === "frame")).toHaveLength(1);
    expect(parseCanvasScene(inserted)).toEqual(inserted);
  });
});
