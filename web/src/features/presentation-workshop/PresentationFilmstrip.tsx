import { ArrowUp, ArrowDown, Copy, Trash2, Plus } from "lucide-react";
import { useRef } from "react";
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
}: {
  deck: Deck;
  active: string;
  onSelect: (id: string) => void;
  onMove: (id: string, index: number) => void;
  onCopy: (id: string) => void;
  onAdd: () => void;
  onDelete: (id: string) => void;
  readOnly: boolean;
}) {
  const dragged = useRef<string | null>(null);
  return (
    <aside className="presentation-filmstrip" aria-label="幻灯片列表">
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
      {deck.slides.map((slide, index) => (
        <div
          key={slide.id}
          className={`presentation-filmstrip-item${slide.id === active ? " active" : ""}`}
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
            if (dragged.current && !readOnly) onMove(dragged.current, index);
            dragged.current = null;
          }}
        >
          <span className="presentation-slide-number">{index + 1}</span>
          <button
            className="presentation-slide-select"
            aria-label={`幻灯片 ${index + 1}`}
            aria-current={slide.id === active ? "true" : undefined}
            onClick={() => onSelect(slide.id)}
          >
            <SlidePreview slide={slide} />
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
