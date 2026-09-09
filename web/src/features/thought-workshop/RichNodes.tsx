import { renderDiagram } from "./diagram";
import { ManagedImageView } from "./ManagedImageView";
import { useEffect, useId, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";

function numberAttribute(element: Element, name: string) {
  const value = element.getAttribute(name);
  if (value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function imageAttributes(image: HTMLImageElement, figure?: Element) {
  const source = figure ?? image;
  const align = source.getAttribute("data-align");
  return {
    assetId: image.getAttribute("data-asset-id"),
    alt: image.getAttribute("alt") || "",
    caption:
      figure?.querySelector("figcaption")?.textContent ||
      image.getAttribute("data-caption") ||
      "",
    width: numberAttribute(image, "width"),
    align: align === "center" || align === "right" ? align : "left",
    cropLeft: numberAttribute(source, "data-crop-left"),
    cropTop: numberAttribute(source, "data-crop-top"),
    cropWidth: numberAttribute(source, "data-crop-width"),
    cropHeight: numberAttribute(source, "data-crop-height"),
  };
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
      caption: { default: "" },
      align: { default: "left" },
      cropLeft: { default: null },
      cropTop: { default: null },
      cropWidth: { default: null },
      cropHeight: { default: null },
    };
  },
  parseHTML() {
    return [
      {
        tag: "figure[data-thought-image]",
        getAttrs: (element) => {
          const img = element.querySelector("img[data-asset-id]");
          if (!(img instanceof HTMLImageElement)) return false;
          return imageAttributes(img, element);
        },
      },
      {
        tag: "img[data-asset-id]",
        getAttrs: (element) =>
          element instanceof HTMLImageElement
            ? imageAttributes(element)
            : false,
      },
    ];
  },
  renderHTML({ node }) {
    const crop = ["cropLeft", "cropTop", "cropWidth", "cropHeight"].every(
      (key) => typeof node.attrs[key] === "number",
    );
    const image = [
      "img",
      {
        "data-asset-id": node.attrs.assetId,
        alt: node.attrs.alt,
        ...(node.attrs.width ? { width: node.attrs.width } : {}),
        ...(node.attrs.caption ? { "data-caption": node.attrs.caption } : {}),
      },
    ] as const;
    const figureAttrs = {
      "data-thought-image": "true",
      "data-align": node.attrs.align || "left",
      ...(crop
        ? {
            "data-crop-left": node.attrs.cropLeft,
            "data-crop-top": node.attrs.cropTop,
            "data-crop-width": node.attrs.cropWidth,
            "data-crop-height": node.attrs.cropHeight,
          }
        : {}),
    };
    if (!node.attrs.caption) return ["figure", figureAttrs, image];
    return [
      "figure",
      figureAttrs,
      image,
      ["figcaption", {}, String(node.attrs.caption)],
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
