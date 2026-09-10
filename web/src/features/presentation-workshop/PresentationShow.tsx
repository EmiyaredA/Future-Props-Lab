import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { SlideSurface } from "./SlideSurface";
import type { Deck } from "./types";

export function PresentationShow({
  deck,
  start,
  onClose,
}: {
  deck: Deck;
  start: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(start),
    [scale, setScale] = useState(1);
  const root = useDrawerFocus<HTMLDivElement>(onClose, true, false),
    viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const resize = () => {
      const box = viewport.current?.getBoundingClientRect();
      if (box) setScale(Math.min(box.width / 1280, box.height / 720));
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (viewport.current) observer.observe(viewport.current);
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        setIndex((i) => Math.min(deck.slides.length - 1, i + 1));
      }
      if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }
      if (e.key === "Home") setIndex(0);
      if (e.key === "End") setIndex(deck.slides.length - 1);
    };
    window.addEventListener("keydown", key);
    return () => {
      observer.disconnect();
      window.removeEventListener("keydown", key);
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, [deck.slides.length]);
  return (
    <div
      ref={root}
      className="presentation-show"
      role="dialog"
      aria-modal="true"
      aria-label="幻灯片放映"
    >
      <div ref={viewport} className="presentation-show-viewport">
        <div style={{ width: 1280 * scale, height: 720 * scale }}>
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            <SlideSurface slide={deck.slides[index]} />
          </div>
        </div>
      </div>
      <nav aria-label="放映控制">
        <button
          aria-label="上一页"
          disabled={index === 0}
          onClick={() => setIndex((i) => i - 1)}
        >
          <ChevronLeft />
        </button>
        <span>
          {index + 1} / {deck.slides.length}
        </span>
        <button
          aria-label="下一页"
          disabled={index === deck.slides.length - 1}
          onClick={() => setIndex((i) => i + 1)}
        >
          <ChevronRight />
        </button>
        <button
          aria-label="全屏放映"
          onClick={() => {
            void root.current?.requestFullscreen?.().catch(() => {});
          }}
        >
          <Expand size={20} />
        </button>
        <button aria-label="退出放映" onClick={onClose}>
          <X size={20} />
        </button>
      </nav>
    </div>
  );
}
