import { MessageSquareText, Plus, Search } from "lucide-react";
import type { ModelTestConversationSummary } from "@features/models/api";

function formatConversationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function ModelTestConversationPanel({
  open,
  items,
  activeId,
  search,
  creating,
  disabled,
  onSearch,
  onCreate,
  onSelect,
  onClose,
}: {
  open: boolean;
  items: ModelTestConversationSummary[];
  activeId: string | null;
  search: string;
  creating: boolean;
  disabled: boolean;
  onSearch: (value: string) => void;
  onCreate: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const normalized = search.trim().toLowerCase();
  const filtered = normalized
    ? items.filter((item) =>
        `${item.title} ${item.model_slug || ""}`
          .toLowerCase()
          .includes(normalized),
      )
    : items;
  return (
    <aside className={`conversation-panel${open ? " mobile-open" : ""}`}>
      <div className="panel-heading">
        <strong>历史对话</strong>
      </div>
      <div className="conversation-tools">
        <button
          type="button"
          className="new-conversation-button"
          disabled={creating || disabled}
          onClick={onCreate}
        >
          <Plus aria-hidden /> 新建对话
        </button>
        <label className="conversation-search">
          <Search aria-hidden />
          <input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="搜索对话"
            aria-label="搜索对话"
          />
        </label>
      </div>
      <div className="conversation-list">
        {filtered.map((item) => (
          <button
            className={item.id === activeId ? "active" : ""}
            key={item.id}
            onClick={() => onSelect(item.id)}
          >
            <span className="conversation-item-icon">
              <MessageSquareText aria-hidden />
            </span>
            <span>
              <strong>{item.title}</strong>
              <small>
                <span>{item.model_slug || "未选择模型"}</span>
                <time>{formatConversationTime(item.updated_at)}</time>
              </small>
            </span>
          </button>
        ))}
        {!filtered.length && normalized ? (
          <p className="conversation-empty">没有匹配的对话</p>
        ) : null}
      </div>
      <div className="conversation-count">共 {items.length} 个对话</div>
      <button className="mobile-panel-close" onClick={onClose}>
        收起
      </button>
    </aside>
  );
}
