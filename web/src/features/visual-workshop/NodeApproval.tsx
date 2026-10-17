import { Check } from "lucide-react";
import type { VisualCanvasNode } from "./api";
import "./node-approval.css";

export function NodeApproval({
  node,
  onChange,
  compact = false,
}: {
  node: VisualCanvasNode;
  onChange?: (approved: boolean) => void;
  compact?: boolean;
}) {
  const label = node.approved ? "取消通过" : "标记通过";
  const content = (
    <>
      <Check size={13} aria-hidden />
      {!compact && (node.approved ? "已通过" : "标记通过")}
    </>
  );
  const className = `visual-node-approval${node.approved ? " is-approved" : ""}${compact ? " is-compact" : ""}`;
  if (!onChange)
    return node.approved ? (
      <span
        className={className}
        aria-label={`${node.title}已通过`}
        title="已通过"
      >
        {content}
      </span>
    ) : null;
  if (!compact)
    return (
      <button
        type="button"
        role="switch"
        className={`${className} is-switch`}
        aria-label={`节点通过：${node.title}`}
        aria-checked={Boolean(node.approved)}
        title="认可当前节点结果"
        onClick={(event) => {
          event.stopPropagation();
          onChange(!node.approved);
        }}
      >
        <span>{node.approved ? "已通过" : "通过"}</span>
        <span className="visual-node-approval-track" aria-hidden>
          <span />
        </span>
      </button>
    );
  return (
    <button
      type="button"
      className={className}
      aria-label={`${label}：${node.title}`}
      aria-pressed={Boolean(node.approved)}
      title={node.approved ? "已通过，点击取消" : "确认认可此节点的当前结果"}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onChange(!node.approved);
      }}
    >
      {content}
    </button>
  );
}
