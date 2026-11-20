import "./card-variants.css";
import { useEffect, useRef, useState, type HTMLAttributes } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export function VariantStrip({
  label,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { label: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  useEffect(() => {
    const element = viewport.current!;
    const update = () => {
      const left = element.scrollLeft > 1;
      const right =
        element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setEdges((previous) =>
        previous.left === left && previous.right === right
          ? previous
          : { left, right },
      );
    };
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY))
        return;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? element.clientWidth
            : 1;
      const next = Math.max(
        0,
        Math.min(
          element.scrollWidth - element.clientWidth,
          element.scrollLeft + event.deltaY * unit,
        ),
      );
      if (next === element.scrollLeft) return;
      event.preventDefault();
      element.scrollLeft = next;
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    element.addEventListener("scroll", update, { passive: true });
    element.addEventListener("wheel", wheel, { passive: false });
    update();
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", update);
      element.removeEventListener("wheel", wheel);
    };
  }, [children]);

  function move(direction: number) {
    const element = viewport.current!;
    element.scrollBy({
      left: direction * Math.max(102, element.clientWidth - 36),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }

  return (
    <div className="card-variant-carousel">
      <div
        {...props}
        ref={viewport}
        className="card-variant-strip"
        role="group"
        aria-label={label}
      >
        {children}
      </div>
      {(edges.left || edges.right) && (
        <>
          <button
            type="button"
            className="card-variant-scroll card-variant-scroll--left"
            aria-label={`向左滚动${label}`}
            disabled={!edges.left}
            onClick={() => move(-1)}
          >
            <ChevronLeft size={16} aria-hidden />
          </button>
          <button
            type="button"
            className="card-variant-scroll card-variant-scroll--right"
            aria-label={`向右滚动${label}`}
            disabled={!edges.right}
            onClick={() => move(1)}
          >
            <ChevronRight size={16} aria-hidden />
          </button>
        </>
      )}
    </div>
  );
}
