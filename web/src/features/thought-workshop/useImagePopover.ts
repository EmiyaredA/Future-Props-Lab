import { useLayoutEffect, useRef, type RefObject } from "react";

/** A top-layer surface that stays in the image node's DOM and focus scope. */
export function useImagePopover(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  surface: RefObject<HTMLDivElement | null>,
  kind: "toolbar" | "settings",
) {
  const reposition = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const element = surface.current;
    const reference = anchor.current;
    if (!element || !reference) return;
    let shown = false;
    let initial = true;
    let frame = 0;
    const hide = () => {
      element.style.display = "none";
      element.inert = true;
      if (shown) element.hidePopover?.();
      shown = false;
    };
    if (!open) {
      hide();
      return;
    }
    const position = () => {
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + 12;
      const right = left + (viewport?.width ?? innerWidth) - 24;
      const visibleTop = (viewport?.offsetTop ?? 0) + 12;
      const bottom = visibleTop + (viewport?.height ?? innerHeight) - 24;
      const bar = reference
        .closest(".thought-document")
        ?.querySelector(".thought-document-bar");
      const top = Math.max(
        visibleTop,
        bar?.getBoundingClientRect().bottom ?? visibleTop,
      );
      let rect = reference.getBoundingClientRect();
      // A hidden toolbar cannot anchor a settings surface.
      if (kind === "settings" && !reference.getClientRects().length) {
        hide();
        return;
      }
      element.style.display = kind === "toolbar" ? "flex" : "grid";
      if (!shown) element.showPopover?.();
      shown = true;
      element.style.maxWidth = `${right - left}px`;
      if (kind === "settings")
        element.style.maxHeight = `${Math.max(40, bottom - top)}px`;
      const height = element.offsetHeight;
      let y = rect.top - height - 8;
      if (kind === "toolbar") {
        const fitsAbove = y >= top && rect.top <= bottom;
        const fitsBelow =
          rect.bottom + 8 >= top && rect.bottom + height + 8 <= bottom;
        if (!fitsAbove && fitsBelow) y = rect.bottom + 8;
        else if (!fitsAbove && initial) {
          // Reveal the image's top edge once on selection, never chase user scrolling.
          reference.style.scrollMarginTop = `${top + height + 8}px`;
          reference.scrollIntoView?.({ block: "start", behavior: "instant" });
          rect = reference.getBoundingClientRect();
          y = rect.top - height - 8;
        }
        initial = false;
        if (
          y < top ||
          y + height > bottom ||
          rect.bottom < top ||
          rect.top > bottom ||
          rect.right < left ||
          rect.left > right
        ) {
          hide();
          return;
        }
      } else {
        const below = rect.bottom + 8;
        y =
          below + height <= bottom
            ? below
            : Math.max(top, rect.top - height - 8);
      }
      Object.assign(element.style, {
        left: `${Math.max(left, Math.min(rect.left + rect.width / 2 - element.offsetWidth / 2, right - element.offsetWidth))}px`,
        top: `${y}px`,
      });
      element.inert = false;
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    reposition.current = position;
    position();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(reference);
    const prose = reference.closest(".thought-prose");
    if (prose) observer?.observe(prose);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      reposition.current = () => {};
      observer?.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      reference.style.removeProperty("scroll-margin-top");
      hide();
    };
  }, [open, anchor, surface, kind]);
  useLayoutEffect(() => reposition.current());
}
