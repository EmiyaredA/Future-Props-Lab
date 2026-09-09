import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Download, FileText, GripVertical } from "lucide-react";
import { useState } from "react";
import { fetchApiBlob } from "@platform/api/client";
import { download } from "./download";

export const attachmentAccept =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,.csv,.json,.zip";
function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
function AttachmentCard({ node, selected }: NodeViewProps) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { assetId, filename, byteSize } = node.attrs;
  return (
    <NodeViewWrapper
      className={`thought-attachment${selected ? " is-selected" : ""}`}
      contentEditable={false}
    >
      <span
        data-drag-handle
        title="拖动附件"
        className="thought-attachment-grip"
      >
        <GripVertical size={16} />
      </span>
      <FileText size={26} aria-hidden="true" />
      <div className="thought-attachment-info">
        <strong>{filename}</strong>
        <small>
          {String(filename).split(".").pop()?.toUpperCase()} ·{" "}
          {fileSize(Number(byteSize))}
        </small>
        {error && <span role="alert">{error}</span>}
      </div>
      <button
        aria-label={`下载 ${filename}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            download(
              await fetchApiBlob(
                `/v1/files/${encodeURIComponent(assetId)}/download`,
              ),
              filename,
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : "下载失败，请重试");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Download size={16} />
        {busy ? "下载中…" : "下载"}
      </button>
    </NodeViewWrapper>
  );
}
export const AttachmentNode = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      assetId: {
        default: null,
        parseHTML: (e) => e.getAttribute("data-asset-id"),
      },
      filename: {
        default: "附件",
        parseHTML: (e) => e.getAttribute("data-filename"),
      },
      mimeType: {
        default: "application/octet-stream",
        parseHTML: (e) => e.getAttribute("data-mime-type"),
      },
      byteSize: {
        default: 0,
        parseHTML: (e) => Number(e.getAttribute("data-byte-size")),
      },
    };
  },
  parseHTML() {
    return [{ tag: "div[data-attachment]" }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-attachment": "",
        "data-asset-id": node.attrs.assetId,
        "data-filename": node.attrs.filename,
        "data-mime-type": node.attrs.mimeType,
        "data-byte-size": node.attrs.byteSize,
      }),
      [
        "a",
        {
          href: `/v1/files/${encodeURIComponent(node.attrs.assetId)}/download`,
          download: node.attrs.filename,
        },
        node.attrs.filename,
      ],
    ];
  },
  renderText({ node }) {
    return node.attrs.filename;
  },
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentCard);
  },
});
