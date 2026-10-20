import { ArrowUp, ArrowDown, Copy, Trash2, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { SlidePreview } from "./SlideSurface";
import type { Deck } from "./types";

export function PresentationFilmstrip({
  deck,
  active,
  onSelect,
  onMove,
  onCopy,
  onAdd,
  onDelete,
  readOnly,
  onBatchDelete,
  onBatchCopy,
  onBatchMove,
}: {
  deck: Deck;
  active: string;
  onSelect: (id: string) => void;
  onMove: (id: string, index: number) => void;
  onCopy: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  readOnly: boolean;
  onBatchDelete?: (ids: string[]) => void;
  onBatchCopy?: (ids: string[]) => void;
  onBatchMove?: (ids: string[], index: number) => void;
}) {
  const dragged = useRef<string | null>(null);
  const [pageSelection, setPageSelection] = useState<string[]>([]);
  const anchor = useRef(active);
  const chosen = pageSelection.filter((id) =>
    deck.slides.some((s) => s.id === id),
  );
  const choose = (id: string, event: React.MouseEvent) => {
    if (event.shiftKey) {
      const from = deck.slides.findIndex((s) => s.id === anchor.current),
        to = deck.slides.findIndex((s) => s.id === id);
      setPageSelection(
        deck.slides
          .slice(Math.min(from, to), Math.max(from, to) + 1)
          .map((s) => s.id),
      );
    } else if (event.metaKey || event.ctrlKey)
      setPageSelection(
        chosen.includes(id)
          ? chosen.filter((item) => item !== id)
          : [...chosen, id],
      );
    else {
      setPageSelection([id]);
      anchor.current = id;
    }
    onSelect(id);
  };
  return (
    <aside
      className="presentation-filmstrip"
      aria-label="幻灯片列表"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "a"
        ) {
          event.preventDefault();
          event.stopPropagation();
          setPageSelection(deck.slides.map((s) => s.id));
        }
        if (
          !readOnly &&
          ["Delete", "Backspace"].includes(event.key) &&
          onBatchDelete
        ) {
          event.preventDefault();
          event.stopPropagation();
          onBatchDelete(chosen.length ? chosen : [active]);
        }
      }}
    >
      <div className="presentation-filmstrip-heading">
        <span>
          幻灯片 <small>{deck.slides.length}</small>
        </span>
        {!readOnly && (
          <button
            className="icon-btn"
            aria-label="在当前页后新建幻灯片"
            disabled={deck.slides.length >= 100}
            onClick={onAdd}
          >
            <Plus size={16} />
          </button>
        )}
      </div>
      {!readOnly && chosen.length > 1 && (
        <div className="presentation-filmstrip-batch">
          <span>已选 {chosen.length} 页</span>
          <button
            className="btn"
            aria-label="复制所选幻灯片"
            disabled={deck.slides.length + chosen.length > 100}
            onClick={() => onBatchCopy?.(chosen)}
          >
            复制
          </button>
          <button
            className="btn"
            aria-label="删除所选幻灯片"
            disabled={chosen.length >= deck.slides.length}
            onClick={() => onBatchDelete?.(chosen)}
          >
            删除
          </button>
        </div>
      )}
      {deck.slides.map((slide, index) => (
        <div
          key={slide.id}
          className={`presentation-filmstrip-item${slide.id === active ? " active" : ""}`}
          data-page-selected={chosen.includes(slide.id)}
          draggable={!readOnly}
          onDragStart={(e) => {
            dragged.current = slide.id;
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => {
            dragged.current = null;
          }}
          onDragOver={(e) => {
            if (!readOnly) e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            if (dragged.current && !readOnly) {
              if (onBatchMove && chosen.includes(dragged.current))
                onBatchMove(chosen, index);
              else onMove(dragged.current, index);
            }
            dragged.current = null;
          }}
        >
          {!!slide.section &&
            (index === 0 ||
              deck.slides[index - 1].section !== slide.section) && (
              <div className="presentation-section-heading">
                {slide.section}
              </div>
            )}
          <span className="presentation-slide-number">{index + 1}</span>
          <button
            className="presentation-slide-select"
            aria-label={`幻灯片 ${index + 1}`}
            aria-current={slide.id === active ? "true" : undefined}
            onClick={(event) => choose(slide.id, event)}
          >
            <SlidePreview slide={slide} size={deck} />
          </button>
          {!readOnly && slide.id === active ? (
            <div className="presentation-slide-actions">
              <button
                aria-label="上移幻灯片"
                disabled={index === 0}
                onClick={() => onMove(slide.id, index - 1)}
              >
                <ArrowUp size={14} />
              </button>
              <button
                aria-label="下移幻灯片"
                disabled={index === deck.slides.length - 1}
                onClick={() => onMove(slide.id, index + 1)}
              >
                <ArrowDown size={14} />
              </button>
              <button
                aria-label="复制幻灯片"
                disabled={deck.slides.length >= 100}
                onClick={() => onCopy(slide.id)}
              >
                <Copy size={14} />
              </button>
              <button
                aria-label="删除幻灯片"
                disabled={deck.slides.length <= 1}
                onClick={() => onDelete(slide.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ) : null}
        </div>
      ))}
      {!readOnly && (
        <button
          className="presentation-filmstrip-add"
          aria-label="从列表新建幻灯片"
          disabled={deck.slides.length >= 100}
          onClick={onAdd}
        >
          <Plus size={16} />
          新建幻灯片
        </button>
      )}
    </aside>
  );
}
