import { Check, Download, Pencil, Tags, Trash2 } from "lucide-react";
import type { VisualCanvasNode } from "../api";
import { BoardMenu } from "./BoardMenu";

export type NodeManagementAction =
  "rename" | "organize" | "delete" | "download" | "approve";

export function NodeManagementMenu({
  node,
  onAction,
  downloading = false,
}: {
  node: VisualCanvasNode;
  onAction: (action: NodeManagementAction, node: VisualCanvasNode) => void;
  downloading?: boolean;
}) {
  return (
    <BoardMenu
      label={`管理节点 ${node.title}`}
      items={[
        {
          label: downloading ? "下载中…" : "下载",
          icon: <Download size={14} aria-hidden />,
          disabled:
            downloading ||
            (node.kind === "text" ? !node.text?.trim() : !node.asset_id),
          onSelect: () => onAction("download", node),
        },
        {
          label: node.approved ? "取消通过" : "标记通过",
          icon: <Check size={14} aria-hidden />,
          onSelect: () => onAction("approve", node),
        },
        {
          label: "重命名",
          icon: <Pencil size={14} aria-hidden />,
          onSelect: () => onAction("rename", node),
        },
        {
          label: "分类与标签",
          icon: <Tags size={14} aria-hidden />,
          onSelect: () => onAction("organize", node),
        },
        {
          label: "删除节点",
          icon: <Trash2 size={14} aria-hidden />,
          danger: true,
          onSelect: () => onAction("delete", node),
        },
      ]}
    />
  );
}
