import { useEffect, useMemo, useRef, useState } from "react";
import { Boxes, Check, Search, Sparkles, Wrench, X } from "lucide-react";
import type { Capability } from "./protocol";

type CapabilityTab = "skill" | "toolapi" | "mcp";
type CapabilityGroup = {
  key: CapabilityTab;
  title: string;
  items: Capability[];
};

export function CapabilityDialog({
  selected,
  toolApis,
  mcpServers,
  skills,
  scriptAvailable,
  registeredOperations,
  onApply,
  onClose,
}: {
  selected: string[];
  toolApis: Capability[];
  mcpServers: Capability[];
  skills: Capability[];
  scriptAvailable: boolean;
  registeredOperations: number;
  onApply: (keys: string[]) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<CapabilityTab>("skill");
  const [draft, setDraft] = useState(selected);
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const dialogRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const groups: CapabilityGroup[] = [
    { key: "toolapi", title: "工具 API", items: toolApis },
    { key: "mcp", title: "MCP", items: mcpServers },
    { key: "skill", title: "Skill", items: skills },
  ];
  const activeGroup = groups.find((group) => group.key === tab)!;
  const tags = [
    ...new Set(activeGroup.items.flatMap((item) => item.tags ?? [])),
  ]
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "zh-CN"));
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return activeGroup.items.filter(
      (item) =>
        (!activeTags.length ||
          item.tags?.some((tag) => activeTags.includes(tag))) &&
        (!normalized ||
          [
            item.name,
            item.description,
            item.status_message,
            ...(item.tags ?? []),
          ]
            .filter(Boolean)
            .some((value) => value!.toLocaleLowerCase().includes(normalized))),
    );
  }, [activeGroup.items, activeTags, query]);

  useEffect(() => {
    searchRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), input:not(:disabled)",
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const selectedCount = groups.reduce(
    (total, group) =>
      total +
      group.items.filter((item) => draft.includes(`${group.key}:${item.id}`))
        .length,
    0,
  );
  const selectedInTab = activeGroup.items.filter((item) =>
    draft.includes(`${tab}:${item.id}`),
  ).length;
  const TabIcon = tab === "skill" ? Sparkles : tab === "mcp" ? Boxes : Wrench;

  const toggle = (key: string) =>
    setDraft((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );

  return (
    <div
      className="amadeus-capability-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="amadeus-capability-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="amadeus-capability-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="amadeus-capability-dialog-head">
          <div>
            <h2 id="amadeus-capability-title">配置能力</h2>
            <p>选择 Amadeus 在当前对话中可以使用的 Skill、API 和 MCP</p>
          </div>
          <button type="button" aria-label="关闭能力配置" onClick={onClose}>
            <X size={19} />
          </button>
        </header>

        <div
          className="amadeus-capability-tabs"
          role="tablist"
          aria-label="能力类型"
        >
          {groups.map((group) => {
            const Icon =
              group.key === "skill"
                ? Sparkles
                : group.key === "mcp"
                  ? Boxes
                  : Wrench;
            const count = group.items.filter((item) =>
              draft.includes(`${group.key}:${item.id}`),
            ).length;
            return (
              <button
                key={group.key}
                type="button"
                role="tab"
                aria-selected={tab === group.key}
                onClick={() => {
                  setTab(group.key);
                  setQuery("");
                  setActiveTags([]);
                }}
              >
                <Icon size={17} />
                <span>{group.title}</span>
                <small>{group.items.length}</small>
                {count > 0 && <em>{count} 已选</em>}
              </button>
            );
          })}
        </div>

        <div className="amadeus-capability-dialog-body">
          <div className="amadeus-capability-scope-note">
            <TabIcon size={16} />
            {tab === "skill"
              ? "只把勾选的 Skill 提供给 Amadeus；未选择的 Skill 不会进入当前对话。"
              : "选择要提供给 Amadeus 的资源；此范围仅作用于当前对话。"}
          </div>
          <label className="amadeus-capability-search">
            <Search size={17} />
            <input
              ref={searchRef}
              aria-label="搜索能力名称或描述"
              placeholder="搜索能力名称或描述"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => setQuery("")}
              >
                <X size={15} />
              </button>
            )}
          </label>

          {tags.length > 0 && (
            <div
              className="amadeus-capability-tag-filter"
              aria-label="按标签筛选，可多选，匹配任一所选标签"
            >
              <span className="amadeus-capability-tag-label">
                标签 <small>可多选</small>
              </span>
              <div className="amadeus-capability-tags">
                <button
                  type="button"
                  aria-pressed={activeTags.length === 0}
                  onClick={() => setActiveTags([])}
                >
                  全部
                </button>
                {tags.map((tag) => (
                  <button
                    type="button"
                    key={tag}
                    aria-pressed={activeTags.includes(tag)}
                    onClick={() =>
                      setActiveTags((current) =>
                        current.includes(tag)
                          ? current.filter((item) => item !== tag)
                          : [...current, tag],
                      )
                    }
                  >
                    {tag}
                    <small>
                      {
                        activeGroup.items.filter((item) =>
                          item.tags?.includes(tag),
                        ).length
                      }
                    </small>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="amadeus-capability-list" role="tabpanel">
            {!filteredItems.length ? (
              <div className="amadeus-capability-empty">
                {activeGroup.items.length
                  ? "没有匹配的能力"
                  : `还没有可用的${activeGroup.title}资源`}
              </div>
            ) : (
              filteredItems.map((item) => {
                const key = `${tab}:${item.id}`;
                const checked = draft.includes(key);
                const failed = item.status === "failed";
                const status = !item.enabled
                  ? "已停用"
                  : failed
                    ? item.status_message?.includes("依赖")
                      ? "依赖缺失"
                      : "连接异常"
                    : checked
                      ? "已加入范围"
                      : "可用";
                return (
                  <label
                    className={`amadeus-capability-option${checked ? " is-selected" : ""}`}
                    key={item.id}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!item.enabled}
                      onChange={() => toggle(key)}
                    />
                    <span
                      className="amadeus-capability-check"
                      aria-hidden="true"
                    >
                      {checked && <Check size={14} />}
                    </span>
                    <span className="amadeus-capability-option-icon">
                      <TabIcon size={18} />
                    </span>
                    <span className="amadeus-capability-option-copy">
                      <strong>{item.name}</strong>
                      <small>
                        {item.description ||
                          item.status_message ||
                          "来自集成中心"}
                      </small>
                      {!!item.tags?.length && (
                        <span
                          className="amadeus-capability-option-tags"
                          aria-label={`标签：${item.tags.join("、")}`}
                        >
                          {item.tags.map((tag) => (
                            <em key={tag}>{tag}</em>
                          ))}
                        </span>
                      )}
                    </span>
                    <em
                      className={`${failed ? "is-warning" : ""}${!item.enabled ? " is-muted" : ""}`}
                    >
                      {status}
                    </em>
                  </label>
                );
              })
            )}
          </div>

          <div className="amadeus-capability-runtime">
            <span>
              会话脚本{" "}
              <b>{scriptAvailable ? "沙箱可用 · 执行前确认" : "暂不可用"}</b>
            </span>
            <span>
              FPL 工具 <b>{registeredOperations} 项 · 按应用按需加载</b>
            </span>
          </div>
        </div>

        <footer className="amadeus-capability-dialog-foot">
          <span>
            当前分类 {selectedInTab} 项已选
            {tab === "skill" && <small> · 当前对话可使用范围</small>}
          </span>
          <div>
            <button type="button" className="is-secondary" onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className="is-primary"
              onClick={() => onApply(draft)}
            >
              应用更改
              <small>{selectedCount}</small>
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
