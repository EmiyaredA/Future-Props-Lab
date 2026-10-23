import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { VisualCanvasNode } from "../api";
import { ReferenceMaterialRow } from "./ReferenceMaterialRow";

export function AcceptanceNodePicker({
  nodes,
  value,
  onChange,
}: {
  nodes: VisualCanvasNode[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const selected = nodes.find((node) => node.id === value);
  useEffect(() => {
    if (open) picker.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="acceptance-node-picker">
      <button
        ref={trigger}
        type="button"
        className="acceptance-node-picker-trigger"
        aria-label="验收节点"
        aria-expanded={open}
        aria-controls={id}
        disabled={!nodes.length}
        onClick={() => setOpen(!open)}
      >
        <span title={selected?.title}>{selected?.title || "选择验收节点"}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={picker}
          id={id}
          className="acceptance-reference-picker"
          role="region"
          aria-label="选择验收节点"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
        >
          <div className="acceptance-list-heading">
            <strong>选择验收节点</strong>
            <button type="button" onClick={close}>
              取消
            </button>
          </div>
          <ul
            className="acceptance-reference-options"
            aria-label="项目验收节点"
          >
            {nodes.map((node) => (
              <ReferenceMaterialRow
                key={node.id}
                assetId={node.kind === "text" ? undefined : node.asset_id}
                kind={node.kind}
                title={node.title}
                description={
                  node.final_version
                    ? `最终输出 v${node.final_version}`
                    : "暂无最终输出"
                }
                selection={{
                  label: `选择 ${node.title}`,
                  selected: node.id === value,
                  onSelect: () => {
                    onChange(node.id);
                    close();
                  },
                }}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
