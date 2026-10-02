import { Node, Extension, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Plugin } from "@tiptap/pm/state";
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWorkspaceId } from "@platform/auth/WorkspacePermissions";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { thoughtKeys } from "../queryKeys";
import { officialPath, findOfficialLibrary } from "../official/catalog";
import { resolveReferences } from "./api";
import "./knowledge-tools.css";

const variants = [
  { value: "info", label: "信息" },
  { value: "note", label: "备注" },
  { value: "success", label: "成功" },
  { value: "warning", label: "警告" },
  { value: "danger", label: "危险" },
];
function CalloutView({ node, editor, updateAttributes }: NodeViewProps) {
  return (
    <NodeViewWrapper
      className={`thought-callout is-${node.attrs.variant}`}
      data-callout={node.attrs.variant}
    >
      {editor.isEditable && (
        <div contentEditable={false}>
          <CustomSelect
            ariaLabel="提示块类型"
            value={node.attrs.variant}
            options={variants}
            onChange={(variant) => updateAttributes({ variant })}
          />
        </div>
      )}
      <NodeViewContent />
    </NodeViewWrapper>
  );
}
export const CalloutNode = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: "info",
        parseHTML: (e) => e.getAttribute("data-callout"),
        renderHTML: (a) => ({ "data-callout": a.variant }),
      },
    };
  },
  parseHTML() {
    return [{ tag: "aside[data-callout]" }, { tag: "div[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "aside",
      mergeAttributes(HTMLAttributes, { class: "thought-callout" }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});
export type DocumentReference = {
  kind: "note" | "official";
  noteId?: string;
  libraryId?: string;
  documentId?: string;
  label: string;
  customLabel?: string | null;
};
function ReferenceView({ node }: NodeViewProps) {
  const [preview, setPreview] = useState(false);
  const previewId = useId();
  const attrs = node.attrs as DocumentReference,
    workspace = useWorkspaceId();
  const target = useQuery({
    queryKey: thoughtKeys.references(workspace ?? "", [attrs.noteId ?? ""]),
    queryFn: ({ signal }) => resolveReferences([attrs.noteId!], signal),
    enabled: attrs.kind === "note" && !!attrs.noteId,
    retry: false,
  });
  const resolved = target.data?.[0],
    official = findOfficialLibrary(attrs.libraryId)?.documents.find(
      (doc) => doc.id === attrs.documentId,
    );
  const title =
    attrs.customLabel ||
    (attrs.kind === "official" ? official?.title : resolved?.title) ||
    attrs.label;
  const href =
    attrs.kind === "official" && official
      ? officialPath(attrs.libraryId!, attrs.documentId!)
      : resolved?.available
        ? `/apps/thought-workshop/knowledge-bases/${encodeURIComponent(resolved.knowledge_base_id!)}/documents/${encodeURIComponent(attrs.noteId!)}`
        : undefined;
  return (
    <NodeViewWrapper
      as="span"
      className="thought-reference"
      contentEditable={false}
    >
      <a
        href={href}
        aria-disabled={!href}
        onMouseEnter={() => setPreview(true)}
        onMouseLeave={() => setPreview(false)}
        onFocus={() => setPreview(true)}
        onBlur={() => setPreview(false)}
        aria-describedby={preview ? previewId : undefined}
      >
        {title}
        {!href && (attrs.kind === "official" || !target.isPending)
          ? "（不可用）"
          : ""}
      </a>
      {preview && (
        <span
          className="thought-reference-preview"
          role="tooltip"
          id={previewId}
        >
          <strong>{title}</strong>
          <span>
            {resolved?.excerpt ||
              (href ? "官方只读文章" : "文档不存在或不可访问")}
          </span>
        </span>
      )}
    </NodeViewWrapper>
  );
}
export const DocumentReferenceNode = Node.create({
  name: "documentReference",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return Object.fromEntries(
      ["kind", "noteId", "libraryId", "documentId", "label", "customLabel"].map(
        (key) => [
          key,
          {
            default: key === "kind" ? "note" : key === "label" ? "文档" : null,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute(`data-ref-${key.toLowerCase()}`),
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs[key] === null
                ? {}
                : { [`data-ref-${key.toLowerCase()}`]: attrs[key] },
          },
        ],
      ),
    );
  },
  parseHTML() {
    return [{ tag: "span[data-document-reference]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-document-reference": "",
        class: "thought-reference",
      }),
      node.attrs.customLabel || node.attrs.label,
    ];
  },
  renderText({ node }) {
    return node.attrs.customLabel || node.attrs.label;
  },
  addNodeView() {
    return ReactNodeViewRenderer(ReferenceView);
  },
});
// Tiptap extension factories and React node views form one content-node contract.
// eslint-disable-next-line react-refresh/only-export-components
export function referenceTrigger(
  open: (range: { from: number; to: number }) => void,
) {
  return Extension.create({
    name: "referenceTrigger",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleTextInput(view, from, _to, text) {
              const before = view.state.doc.textBetween(
                Math.max(0, from - 1),
                from,
                " ",
              );
              if (
                text === "@" &&
                !view.composing &&
                (!before || /\s/.test(before))
              ) {
                queueMicrotask(() => open({ from, to: from + 1 }));
              }
              return false;
            },
          },
        }),
      ];
    },
  });
}
