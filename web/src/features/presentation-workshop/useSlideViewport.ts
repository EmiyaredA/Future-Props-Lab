import { defaultPageSize, type PageSize } from "./types";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

type Anchor = { x: number; y: number; slideX: number; slideY: number };

/** View state only: never changes slide geometry or draft history. */
export function useSlideViewport({
  host,
  canvas,
  zoom,
  onZoomChange,
  isZoomBlocked,
  size: pageSize = defaultPageSize,
}: {
  size?: PageSize;
  host: RefObject<HTMLDivElement | null>;
  canvas: RefObject<HTMLDivElement | null>;
  zoom: number | null;
  onZoomChange?: (zoom: number) => void;
  isZoomBlocked: () => boolean;
}) {
  const [size, setSize] = useState({ fit: 0.5, width: 0, height: 0 });
  const scale = zoom ?? size.fit;
  const pending = useRef<Anchor | null>(null);
  const center = useRef<Anchor | null>(null);
  const current = useRef({ scale, onZoomChange, isZoomBlocked });
  const requested = useRef(scale);

  useLayoutEffect(() => {
    current.current = { scale, onZoomChange, isZoomBlocked };
  });

  useLayoutEffect(() => {
    const area = host.current;
    const slide = canvas.current;
    if (!area || !slide) return;
    const anchorAt = (x: number, y: number): Anchor => {
      const rect = slide.getBoundingClientRect();
      return {
        x,
        y,
        slideX: (x - rect.left) / current.current.scale,
        slideY: (y - rect.top) / current.current.scale,
      };
    };
    const rememberCenter = () => {
      const rect = area.getBoundingClientRect();
      center.current = anchorAt(
        rect.left + area.clientLeft + area.clientWidth / 2,
        rect.top + area.clientTop + area.clientHeight / 2,
      );
    };
    const resize = () => {
      const rect = area.getBoundingClientRect();
      const css = getComputedStyle(area);
      const padding = (
        name: "paddingLeft" | "paddingRight" | "paddingTop" | "paddingBottom",
      ) => {
        const value = parseFloat(css[name]);
        return Number.isFinite(value) ? value : 24;
      };
      const width = area.clientWidth || rect.width;
      const height = area.clientHeight || rect.height;
      setSize({
        width,
        height,
        fit: Math.max(
          0.08,
          Math.min(
            (width - padding("paddingLeft") - padding("paddingRight")) /
              pageSize.width,
            (height - padding("paddingTop") - padding("paddingBottom")) /
              pageSize.height,
          ),
        ),
      });
    };
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (!current.current.onZoomChange) return;
      // Also consume at the limits and during transforms: do not zoom the app.
      event.preventDefault();
      if (
        current.current.isZoomBlocked() ||
        !Number.isFinite(event.deltaY) ||
        !event.deltaY
      )
        return;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? area.clientHeight
            : 1;
      const delta = Math.max(-500, Math.min(500, event.deltaY * unit));
      const next = Math.max(
        0.25,
        Math.min(2, requested.current * Math.exp(-delta * 0.002)),
      );
      // Fit may be outside the manual range on tiny or very large windows.
      // Never reverse the user's gesture when entering that range.
      if (
        next === requested.current ||
        (delta > 0 && next > requested.current) ||
        (delta < 0 && next < requested.current)
      )
        return;
      pending.current = anchorAt(event.clientX, event.clientY);
      requested.current = next;
      current.current.onZoomChange(next);
    };
    resize();
    rememberCenter();
    const observer = new ResizeObserver(resize);
    observer.observe(area);
    area.addEventListener("wheel", wheel, { passive: false });
    area.addEventListener("scroll", rememberCenter);
    return () => {
      observer.disconnect();
      area.removeEventListener("wheel", wheel);
      area.removeEventListener("scroll", rememberCenter);
    };
  }, [host, canvas, pageSize.width, pageSize.height]);

  useLayoutEffect(() => {
    const area = host.current;
    const slide = canvas.current;
    if (!area || !slide) return;
    const rect = area.getBoundingClientRect();
    const x = rect.left + area.clientLeft + area.clientWidth / 2;
    const y = rect.top + area.clientTop + area.clientHeight / 2;
    const anchor =
      pending.current ?? (center.current && { ...center.current, x, y });
    if (zoom === null) {
      area.scrollLeft = 0;
      area.scrollTop = 0;
    } else if (anchor) {
      const slideRect = slide.getBoundingClientRect();
      area.scrollLeft += slideRect.left + anchor.slideX * scale - anchor.x;
      area.scrollTop += slideRect.top + anchor.slideY * scale - anchor.y;
    }
    const slideRect = slide.getBoundingClientRect();
    center.current = {
      x,
      y,
      slideX: (x - slideRect.left) / scale,
      slideY: (y - slideRect.top) / scale,
    };
    pending.current = null;
    requested.current = scale;
  }, [scale, zoom, size, host, canvas]);

  return scale;
}
