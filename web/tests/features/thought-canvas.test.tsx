import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Editor } from "@tiptap/core";
import { editorExtensions } from "@features/thought-workshop/editorExtensions";
import { CanvasSvg } from "@features/thought-workshop/diagrams/CanvasSvg";
import {
  parseCanvasScene,
  mapCanvasAssets,
  canvasAssetIds,
  canvasText,
} from "@features/thought-workshop/diagrams/model";
import {
  canvasTemplate,
  newElement,
} from "@features/thought-workshop/diagrams/templates";
import {
  alignElements,
  duplicateElements,
  groupElements,
  removeElements,
} from "@features/thought-workshop/diagrams/sceneOperations";
import { parseMarkdown, toMarkdown } from "@features/thought-workshop/markdown";
import { historyDiff } from "@features/thought-workshop/historyDiff";
import { runInsertCommand } from "@features/thought-workshop/blockCommands";

describe("canvas persistence and operations", () => {
  it("rejects executable/unknown data, dangling relationships and unsupported versions", () => {
    const valid = canvasTemplate(1);
    expect(parseCanvasScene(valid)).toEqual(valid);
    const candidates = [
      { ...valid, sceneVersion: 3 },
      { ...valid, html: "<script>" },
      { ...valid, elements: [{ ...valid.elements[0], width: NaN }] },
      { ...valid, elements: [{ ...valid.elements[0], parentId: "" }] },
      { ...valid, edges: [{ ...valid.edges[0], source: "missing" }] },
      { ...valid, edges: [{ ...valid.edges[0], id: valid.elements[0].id }] },
      {
        ...valid,
        edges: [{ ...valid.edges[0], source: [valid.elements[0].id] }],
      },
      { ...valid, edges: [{ ...valid.edges[0], style: ["step"] }] },
    ];
    for (const candidate of candidates)
      expect(() => parseCanvasScene(candidate)).toThrow();
  });
  it("preserves geometry when grouping, cloning and removing a frame", () => {
    const original = canvasTemplate(1),
      ids = new Set(original.elements.map((e) => e.id));
    const grouped = groupElements(original, ids),
      frame = grouped.elements[0];
    expect(frame.kind).toBe("frame");
    expect(grouped.elements.slice(1).map((e) => e.x)).toEqual(
      original.elements.map((e) => e.x),
    );
    expect(parseCanvasScene(grouped)).toBe(grouped);
    const cloned = duplicateElements(grouped, new Set([frame.id]));
    expect(cloned.elements).toHaveLength(8);
    expect(cloned.edges).toHaveLength(4);
    expect(parseCanvasScene(cloned)).toBe(cloned);
    const removed = removeElements(grouped, new Set([frame.id]));
    expect(removed).toEqual(original);
    expect(original.elements.every((e) => !e.parentId)).toBe(true);
    const aligned = alignElements(original, ids, "left");
    expect(new Set(aligned.elements.map((e) => e.x)).size).toBe(1);
  });
  it("round-trips image references through portable Markdown and exposes searchable labels", () => {
    const scene = canvasTemplate(1);
    scene.elements.push({
      ...newElement("image"),
      assetId: "asset-a",
      text: "参考截图",
    });
    const document = {
      type: "doc",
      content: [{ type: "canvas", attrs: { scene } }],
    };
    const markdown = toMarkdown(document, { "asset-a": "assets/example.png" });
    expect(markdown).toContain("```fpl-canvas");
    const parsed = parseMarkdown(markdown, true);
    const restored = mapCanvasAssets(
      parseCanvasScene(parsed.content?.[0].attrs?.scene),
      (id) => (id === "assets/example.png" ? "asset-new" : id),
    );
    expect(canvasAssetIds(restored)).toEqual(["asset-new"]);
    expect(canvasText(restored)).toContain("参考截图");
    expect(scene.elements.at(-1)?.assetId).toBe("asset-a");
  });
  it("retains canvas nodes through editor HTML and keeps history atomic node positions", () => {
    const scene = canvasTemplate(1),
      doc = {
        type: "doc",
        content: [
          { type: "canvas", attrs: { scene } },
          { type: "paragraph", content: [{ type: "text", text: "说明" }] },
        ],
      };
    const editor = new Editor({
      extensions: editorExtensions(undefined, true),
      content: doc,
    });
    const html = editor.getHTML();
    expect(html).toContain("data-fpl-canvas");
    const copy = new Editor({
      extensions: editorExtensions(undefined, true),
      content: html,
    });
    expect(copy.getJSON()).toEqual(editor.getJSON());
    const next = {
      ...doc,
      content: [
        { type: "canvas", attrs: { scene: { ...scene, title: "修改标题" } } },
        doc.content[1],
      ],
    };
    expect(historyDiff(next, doc).marks).toEqual([
      { from: 0, to: 1, kind: "deleted", block: true },
      { from: 1, to: 2, kind: "added", block: true },
    ]);
    editor.destroy();
    copy.destroy();
  });
  it("replaces a slash command with a canvas in one document update", () => {
    const updates: unknown[] = [];
    const editor = new Editor({
      extensions: editorExtensions(undefined, true),
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "/canvas" }] },
        ],
      },
      onUpdate: ({ editor: current }) => updates.push(current.getJSON()),
    });
    runInsertCommand(
      editor,
      "canvas",
      { image: () => {}, attachment: () => {}, math: () => {} },
      1,
      { from: 1, to: 8 },
    );
    expect(updates).toHaveLength(1);
    expect(
      editor.getJSON().content?.some((node) => node.type === "canvas"),
    ).toBe(true);
    expect(editor.getText()).not.toContain("/canvas");
    editor.destroy();
  });
  it("escapes text as inert SVG and renders an offline image with a supplied data URL", () => {
    const scene = canvasTemplate(1);
    scene.elements[0].text = '<script>alert("x")</script>';
    scene.elements.push({
      ...newElement("image"),
      assetId: "image",
      text: "图",
    });
    const svg = renderToStaticMarkup(
      <CanvasSvg
        scene={scene}
        images={{ image: "data:image/png;base64,AAAA" }}
      />,
    );
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain("foreignObject");
    expect(svg).toContain("data:image/png;base64,AAAA");
  });
});
