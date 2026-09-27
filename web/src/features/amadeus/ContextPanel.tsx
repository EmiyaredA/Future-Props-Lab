import { ChevronDown, ChevronUp, Layers3 } from "lucide-react";
import { useId, useState } from "react";
import type { Context } from "./protocol";

type Density = "empty" | "short" | "long";

function application(item: Context) {
  return item.application?.trim() || "研究所";
}

function title(item: Context) {
  const path = item.path?.trim();
  return (
    item.title?.trim() ||
    (path && path !== "/" ? path : "") ||
    item.application?.trim() ||
    "首页"
  );
}

function selection(item: Context) {
  const name = item.selection?.name.trim() || "";
  const value = item.selection?.value.trim() || "";
  if (!name && !value) return "暂无选中控件";
  return name && value && name !== value ? `${name} · ${value}` : name || value;
}

function ContextCard({
  item,
  compact = false,
}: {
  item: Context;
  compact?: boolean;
}) {
  return (
    <article className={`amadeus-context-card${compact ? " is-compact" : ""}`}>
      <div className="amadeus-context-card-head">
        <div className="amadeus-context-identity">
          <span className="amadeus-context-app-mark" aria-hidden="true">
            {application(item).slice(0, 1)}
          </span>
          <div className="amadeus-context-identity-text">
            <span className="amadeus-context-app-name">
              {application(item)}
            </span>
            <strong className="amadeus-context-title">{title(item)}</strong>
          </div>
        </div>
        <div className="amadeus-context-tags">
          {item.focused && (
            <span className="amadeus-context-tag is-active">活动窗口</span>
          )}
          {item.unsaved && (
            <span className="amadeus-context-tag is-unsaved">未保存</span>
          )}
        </div>
      </div>
      {compact ? (
        <div className="amadeus-context-selection-preview">
          <span>当前选中</span>
          <span>{selection(item)}</span>
        </div>
      ) : (
        <div className="amadeus-context-card-details">
          <div>
            <small>页面路径</small>
            <span>{item.path?.trim() || "当前页面"}</span>
          </div>
          <div>
            <small>当前选中</small>
            <span>{selection(item)}</span>
          </div>
        </div>
      )}
    </article>
  );
}

function ContextPanelState({
  items,
  density,
}: {
  items: Context[];
  density: Density;
}) {
  const [open, setOpen] = useState(density === "short");
  const detailsId = useId();
  const featured = items.find((item) => item.focused) || items[0];
  const appCount = new Set(items.map(application)).size;
  const remaining = items.filter(
    (item) => item.windowId !== featured?.windowId,
  );
  const remainingApps = new Map<string, number>();
  for (const item of remaining) {
    const name = application(item);
    remainingApps.set(name, (remainingApps.get(name) || 0) + 1);
  }
  const otherApps = [...remainingApps];
  const ordered = featured ? [featured, ...remaining] : [];
  const groups = new Map<string, Context[]>();
  for (const item of ordered) {
    const name = application(item);
    groups.set(name, [...(groups.get(name) || []), item]);
  }

  return (
    <section className="amadeus-context-panel" aria-label="当前上下文">
      <div className="amadeus-context-heading-row">
        <div className="amadeus-context-heading">
          <span className="amadeus-context-icon" aria-hidden="true">
            <Layers3 size={15} />
          </span>
          <strong>当前上下文</strong>
          <span className="amadeus-context-count">
            {items.length} 个窗口 · {appCount} 个应用
          </span>
        </div>
        {density !== "empty" && (
          <button
            type="button"
            className="amadeus-context-toggle"
            aria-expanded={open}
            aria-controls={open ? detailsId : undefined}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "收起详情" : "展开全部"}
            {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        )}
      </div>
      {density === "empty" ? (
        <p className="amadeus-context-empty">暂未连接研究所窗口</p>
      ) : open ? (
        <div
          id={detailsId}
          className="amadeus-context-details"
          role="region"
          aria-label="窗口上下文详情"
        >
          {density === "long"
            ? [...groups].map(([name, members]) => (
                <div className="amadeus-context-group" key={name}>
                  <div className="amadeus-context-group-heading">
                    {name} <span>{members.length}</span>
                  </div>
                  {members.map((item) => (
                    <ContextCard key={item.windowId} item={item} />
                  ))}
                </div>
              ))
            : ordered.map((item) => (
                <ContextCard key={item.windowId} item={item} />
              ))}
        </div>
      ) : (
        <div className="amadeus-context-summary-card">
          <ContextCard item={featured} compact />
          {remaining.length > 0 && (
            <div className="amadeus-context-summary-footer">
              <div className="amadeus-context-app-pills">
                {otherApps.slice(0, 3).map(([name, count]) => (
                  <span className="amadeus-context-app-pill" key={name}>
                    {name} {count}
                  </span>
                ))}
                {otherApps.length > 3 && (
                  <span className="amadeus-context-app-pill">
                    +{otherApps.length - 3} 个应用
                  </span>
                )}
              </div>
              <span className="amadeus-context-remaining">
                还有 {remaining.length} 个窗口
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function ContextPanel({ items }: { items: Context[] }) {
  const density: Density =
    items.length === 0 ? "empty" : items.length <= 2 ? "short" : "long";
  return <ContextPanelState key={density} density={density} items={items} />;
}
