import { useState } from "react";
import type { RunInstruction } from "./protocol";

const labels = {
  pending: "发送中",
  sending: "发送中",
  accepted: "已送达",
  rejected: "未送达",
  unknown: "结果待核实",
};

export function InstructionStatus({
  item,
  restore,
}: {
  item: RunInstruction;
  restore?: (item: RunInstruction) => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="amadeus-instruction-status" data-status={item.status}>
      <span role="status">补充消息 · {labels[item.status]}</span>
      {item.status === "rejected" && restore && (
        <button type="button" onClick={() => restore(item)}>
          恢复到输入框
        </button>
      )}
      {item.status === "unknown" && (
        <>
          <span>请先核对回复，避免重复发送。</span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(item.text)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
          >
            {copied ? "已复制" : "复制补充"}
          </button>
        </>
      )}
    </div>
  );
}
