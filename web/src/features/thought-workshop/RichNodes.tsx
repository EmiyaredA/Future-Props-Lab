import { renderDiagram } from "./diagram";
import { useEffect, useId, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { useApiBlobUrl } from "@platform/api/useApiBlobUrl";

function ManagedImageView({
  node,
  selected,
  updateAttributes,
  editor,
}: NodeViewProps) {
  const { url, error } = useApiBlobUrl(
    `/v1/files/${encodeURIComponent(String(node.attrs.assetId))}/content`,
  );
  return (
    <NodeViewWrapper className={`thought-image ${selected ? "selected" : ""}`}>
      {url ? (
        <img
          src={url}
          alt={String(node.attrs.alt || "笔记图片")}
          style={{ width: node.attrs.width || "auto", maxWidth: "100%" }}
        />
      ) : (
        <span>{error ? "图片读取失败" : "图片加载中…"}</span>
      )}
      {selected && editor.isEditable && (
        <div className="thought-image-controls" contentEditable={false}>
          <label>
            宽度{" "}
            <input
              aria-label="图片宽度"
              type="number"
              min={40}
              max={2000}
              value={node.attrs.width || 480}
              onChange={(e) =>
                updateAttributes({
                  width: Math.max(40, Math.min(2000, Number(e.target.value))),
                })
              }
            />
          </label>
          <label>
            替代文字{" "}
            <input
              aria-label="图片替代文字"
              value={node.attrs.alt || ""}
              onChange={(e) => updateAttributes({ alt: e.target.value })}
            />
          </label>
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const ManagedImage = Node.create({
  name: "image",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      assetId: { default: null },
      alt: { default: "" },
      title: { default: null },
      width: { default: null },
      height: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: "img[data-asset-id]",
        getAttrs: (element) => ({
          assetId: element.getAttribute("data-asset-id"),
          alt: element.getAttribute("alt") || "",
        }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "img",
      {
        "data-asset-id": node.attrs.assetId,
        alt: node.attrs.alt,
        width: node.attrs.width,
      },
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ManagedImageView);
  },
});

function MermaidView({ node, updateAttributes, editor }: NodeViewProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void renderDiagram(
        String(node.attrs.source),
        `thought-${id}-${Date.now()}`,
      )
        .then((value) => {
          if (active) {
            setSvg(value);
            setError("");
          }
        })
        .catch(() => {
          if (active) {
            setSvg("");
            setError("图表语法有误，请编辑源码");
          }
        });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [node.attrs.source, id]);
  return (
    <NodeViewWrapper className="thought-diagram" contentEditable={false}>
      {editor.isEditable && (
        <button type="button" onClick={() => setEditing(!editing)}>
          {editing ? "收起源码" : "编辑图表"}
        </button>
      )}
      {editing && editor.isEditable && (
        <textarea
          aria-label="Mermaid 源码"
          value={node.attrs.source}
          onChange={(e) => updateAttributes({ source: e.target.value })}
          rows={6}
        />
      )}
      {error ? (
        <p role="status">{error}</p>
      ) : (
        <div
          className="thought-mermaid-preview"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}
    </NodeViewWrapper>
  );
}
export const MermaidNode = Node.create({
  name: "mermaid",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return { source: { default: "graph TD\n  想法 --> 行动" } };
  },
  parseHTML() {
    return [
      {
        tag: "pre[data-mermaid]",
        getAttrs: (element) => ({ source: element.textContent || "" }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "pre",
      mergeAttributes(HTMLAttributes, { "data-mermaid": "true" }),
      node.attrs.source,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
});
