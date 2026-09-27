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
  if (!name && !value) return "";
  return name && value && name !== value ? `${name} · ${value}` : name || value;
}

function ContextCard({
  item,
  showFocus,
}: {
  item: Context;
  showFocus: boolean;
}) {
  const selected = selection(item);
  return (
    <article className="amadeus-context-card" title={item.path?.trim()}>
      <div className="amadeus-context-card-title">
        {showFocus && item.focused && (
          <span
            className="amadeus-context-focus-dot"
            aria-label="活动窗口"
            title="活动窗口"
          />
        )}
        <strong>{title(item)}</strong>
      </div>
      <div
        className={`amadeus-context-card-meta${selected ? " has-selection" : ""}`}
      >
        <span>{application(item)}</span>
        {selected && (
          <span className="amadeus-context-selected">{selected}</span>
        )}
        {item.unsaved && (
          <span className="amadeus-context-unsaved">未保存</span>
        )}
      </div>
    </article>
  );
}

function ContextPanelState({
  items,
  density,
  sectionOpen,
  setSectionOpen,
}: {
  items: Context[];
  density: Density;
  sectionOpen: boolean;
  setSectionOpen: (open: boolean) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const panelId = useId();
  const detailsId = useId();
  const featured = items.find((item) => item.focused) || items[0];
  const remaining = items.filter(
    (item) => item.windowId !== featured?.windowId,
  );
  const ordered = featured ? [featured, ...remaining] : [];
  const visible =
    density === "long" && !detailsOpen && featured ? [featured] : ordered;

  return (
    <section className="amadeus-context-panel" aria-label="当前上下文">
      <button
        type="button"
        className="amadeus-context-heading"
        aria-label={sectionOpen ? "收起当前上下文" : "展开当前上下文"}
        aria-expanded={sectionOpen}
        aria-controls={panelId}
        onClick={() => setSectionOpen(!sectionOpen)}
      >
        <span className="amadeus-context-icon" aria-hidden="true">
          <Layers3 size={15} />
        </span>
        <strong>当前上下文</strong>
        {items.length !== 1 && (
          <span className="amadeus-context-count">{items.length} 个窗口</span>
        )}
        {sectionOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      <div id={panelId} hidden={!sectionOpen} className="amadeus-context-body">
        {density === "empty" ? (
          <p className="amadeus-context-empty">暂未连接研究所窗口</p>
        ) : (
          <>
            <div
              id={detailsId}
              className="amadeus-context-details"
              role={detailsOpen && density === "long" ? "region" : undefined}
              aria-label={
                detailsOpen && density === "long" ? "窗口上下文详情" : undefined
              }
            >
              {visible.map((item) => (
                <ContextCard
                  key={item.windowId}
                  item={item}
                  showFocus={items.length > 1}
                />
              ))}
            </div>
            {density === "long" && (
              <div className="amadeus-context-summary-footer">
                {!detailsOpen && <span>其余 {remaining.length} 个窗口</span>}
                <button
                  type="button"
                  className="amadeus-context-toggle"
                  aria-expanded={detailsOpen}
                  aria-controls={detailsId}
                  onClick={() => setDetailsOpen((value) => !value)}
                >
                  {detailsOpen ? "收起详情" : "展开全部"}
                  {detailsOpen ? (
                    <ChevronUp size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function ContextPanel({ items }: { items: Context[] }) {
  const [sectionOpen, setSectionOpen] = useState(true);
  const density: Density =
    items.length === 0 ? "empty" : items.length <= 2 ? "short" : "long";
  return (
    <ContextPanelState
      key={density}
      density={density}
      items={items}
      sectionOpen={sectionOpen}
      setSectionOpen={setSectionOpen}
    />
  );
}
