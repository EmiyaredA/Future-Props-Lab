import { Send, Square } from "lucide-react";
import type { useAmadeusController } from "./useAmadeusController";

export function ComposerActions({
  controls,
}: {
  controls: Pick<
    ReturnType<typeof useAmadeusController>,
    | "busy"
    | "activeRun"
    | "canInsert"
    | "inserting"
    | "stopping"
    | "submitting"
    | "importing"
    | "draft"
    | "references"
    | "detail"
    | "send"
    | "stop"
  >;
}) {
  const {
    busy,
    activeRun,
    canInsert,
    inserting,
    stopping,
    submitting,
    importing,
    draft,
    references,
    detail,
    send,
    stop,
  } = controls;
  const label = activeRun ? "插入" : "发送";
  const sameConversation =
    activeRun?.conversation_id === detail?.conversation.id;
  const disabled =
    importing ||
    submitting ||
    inserting ||
    stopping ||
    (!draft.trim() && !references.length) ||
    (busy && (!canInsert || !sameConversation)) ||
    detail?.conversation.executor_kind === "legacy-pi";
  return (
    <div className="amadeus-composer-actions">
      {activeRun && (
        <button
          type="button"
          className="amadeus-stop"
          aria-label="停止"
          title="停止当前任务"
          disabled={stopping}
          onClick={stop}
        >
          <Square size={16} aria-hidden />
        </button>
      )}
      <button
        type="button"
        className="amadeus-send"
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => void send()}
      >
        <Send size={16} aria-hidden />
        <span>{label}</span>
      </button>
    </div>
  );
}
