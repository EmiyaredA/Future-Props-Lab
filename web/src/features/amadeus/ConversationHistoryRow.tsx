import {
  Bot,
  Check,
  Code2,
  MoreHorizontal,
  Sparkles,
  Terminal,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useId, type RefObject } from "react";
import { relativeTime } from "@shared/lib/date";
import type { Conversation } from "./protocol";

const historyAgentIcons = {
  codex: Terminal,
  "claude-code": Sparkles,
  opencode: Code2,
  dsh: Zap,
  pi: Bot,
};

const historyRunLabels: Record<string, string> = {
  running: "运行中",
  waiting_approval: "待审批",
  waiting_question: "待回答",
  cancelling: "正在取消",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
};

type Rename = {
  input: RefObject<HTMLInputElement | null>;
  title: string;
  error: string;
  setTitle: (value: string) => void;
  save: () => void;
  cancel: () => void;
};

export function ConversationHistoryRow({
  item,
  current,
  status,
  busy,
  saving,
  onOpen,
  onRename,
  onDelete,
  rename,
}: {
  item: Conversation;
  current: boolean;
  status?: string | null;
  busy: boolean;
  saving: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
  rename?: Rename;
}) {
  const id = useId();
  const Icon =
    historyAgentIcons[item.agent_id as keyof typeof historyAgentIcons] ?? Bot;
  const state = status && historyRunLabels[status];
  const updated = new Date(item.updated_at);
  const validDate = Number.isFinite(updated.getTime());
  return (
    <div
      className={`amadeus-history-row${current ? " active" : ""}`}
      data-conversation-id={item.id}
    >
      {rename ? (
        <form
          className="amadeus-history-rename"
          aria-label={`重命名对话「${item.title}」`}
          onSubmit={(event) => {
            event.preventDefault();
            rename.save();
          }}
        >
          <input
            ref={rename.input}
            aria-label="对话名称"
            aria-describedby={rename.error ? `${id}-error` : undefined}
            value={rename.title}
            maxLength={120}
            disabled={saving}
            onChange={(event) => rename.setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) {
                if (event.key === "Enter") event.preventDefault();
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                rename.cancel();
              }
            }}
          />
          <button
            type="submit"
            aria-label="保存对话名称"
            title={saving ? "正在保存" : "保存"}
            disabled={saving || !rename.title.trim()}
          >
            <Check size={15} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="取消重命名"
            title="取消"
            disabled={saving}
            onClick={rename.cancel}
          >
            <X size={15} aria-hidden />
          </button>
          {rename.error && (
            <small id={`${id}-error`} role="alert">
              {rename.error}
            </small>
          )}
        </form>
      ) : (
        <>
          <button
            type="button"
            className="amadeus-history-title"
            aria-labelledby={`${id}-title`}
            aria-describedby={`${id}-meta`}
            aria-current={current ? "true" : undefined}
            onClick={onOpen}
          >
            <Icon size={15} aria-hidden />
            <span
              id={`${id}-title`}
              className="amadeus-history-name"
              title={item.title}
            >
              {item.title}
            </span>
            <span id={`${id}-meta`} className="amadeus-history-meta">
              {state && (
                <span
                  className="amadeus-history-status"
                  data-status={status}
                  title={state}
                  role="img"
                  aria-label={state}
                />
              )}
              {validDate && (
                <time
                  dateTime={item.updated_at}
                  title={updated.toLocaleString()}
                >
                  {relativeTime(item.updated_at, "")}
                </time>
              )}
            </span>
          </button>
          <div className="amadeus-history-actions">
            <button
              type="button"
              title="重命名"
              aria-label={`重命名对话「${item.title}」`}
              disabled={saving}
              onClick={onRename}
            >
              <MoreHorizontal size={15} aria-hidden />
            </button>
            <button
              type="button"
              title={busy ? "请先停止当前任务" : "删除"}
              aria-label={`删除对话「${item.title}」`}
              disabled={busy || saving}
              onClick={onDelete}
            >
              <Trash2 size={14} aria-hidden />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
