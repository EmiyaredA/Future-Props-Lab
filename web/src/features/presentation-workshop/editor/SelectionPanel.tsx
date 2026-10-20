import {
  Eye,
  EyeOff,
  LockKeyhole,
  UnlockKeyhole,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { sceneOrder, type OrderMode } from "../scene/stacking";
import type { Slide, SlideElement } from "../types";

export function SelectionPanel({
  slide,
  selected,
  readOnly,
  select,
  patch,
  order,
  selectConnection,
}: {
  slide: Slide;
  selected: string[];
  readOnly: boolean;
  select: (ids: string[]) => void;
  patch: (id: string, values: Partial<SlideElement>) => void;
  order: (id: string, mode: OrderMode) => void;
  selectConnection?: (id: string) => void;
}) {
  const elements = new Map(slide.elements.map((e) => [e.id, e]));
  return (
    <section className="presentation-layers" aria-label="选择面板">
      <p className="muted">
        从上到下对应画面从前到后。隐藏元素及其连接不参与放映或导出。
      </p>
      <ol>
        {sceneOrder(slide)
          .reverse()
          .map((item) => {
            if (item.kind === "connection")
              return (
                <li key={item.id} className="presentation-layer-connection">
                  <button
                    className="btn"
                    onClick={() => selectConnection?.(item.id)}
                    disabled={!selectConnection}
                  >
                    ↳ {item.edge.label || "连接线"}
                  </button>
                </li>
              );
            const element = elements.get(item.id)!;
            const name =
              element.name ||
              element.paragraphs
                .flatMap((p) => p.runs.map((r) => r.text))
                .join("")
                .slice(0, 30) ||
              element.kind;
            return (
              <li
                key={item.id}
                className={selected.includes(item.id) ? "is-selected" : ""}
              >
                <button
                  className="presentation-layer-select"
                  aria-label={`选择 ${name}`}
                  aria-pressed={selected.includes(item.id)}
                  onClick={(event) =>
                    select(
                      event.shiftKey
                        ? selected.includes(item.id)
                          ? selected.filter((id) => id !== item.id)
                          : [...selected, item.id]
                        : [item.id],
                    )
                  }
                >
                  <span aria-hidden="true">
                    {element.kind === "text"
                      ? "T"
                      : element.kind === "image"
                        ? "▧"
                        : "◇"}
                  </span>
                </button>
                <input
                  aria-label={`元素名称 ${item.id}`}
                  placeholder={name}
                  value={element.name ?? ""}
                  maxLength={120}
                  readOnly={readOnly || element.locked}
                  onChange={(event) =>
                    patch(item.id, { name: event.target.value })
                  }
                />
                <button
                  className="icon-btn"
                  aria-label={`${element.hidden ? "显示" : "隐藏"} ${name}`}
                  aria-pressed={!!element.hidden}
                  disabled={readOnly || element.locked}
                  onClick={() => patch(item.id, { hidden: !element.hidden })}
                >
                  {element.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button
                  className="icon-btn"
                  aria-label={`${element.locked ? "解锁" : "锁定"} ${name}`}
                  aria-pressed={element.locked}
                  disabled={readOnly}
                  onClick={() => patch(item.id, { locked: !element.locked })}
                >
                  {element.locked ? (
                    <LockKeyhole size={14} />
                  ) : (
                    <UnlockKeyhole size={14} />
                  )}
                </button>
                <div className="presentation-layer-order">
                  <button
                    className="icon-btn"
                    aria-label={`上移 ${name}`}
                    disabled={readOnly || element.locked}
                    onClick={() => order(item.id, "forward")}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`下移 ${name}`}
                    disabled={readOnly || element.locked}
                    onClick={() => order(item.id, "backward")}
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>
              </li>
            );
          })}
      </ol>
      {!slide.elements.length && (
        <p className="muted">页面还没有元素，从上方工具栏插入。</p>
      )}
    </section>
  );
}
