import { useLayoutEffect, type RefObject } from "react";
import type { PreviewAnchor } from "./useLinkPreview";

export function useLinkPreviewPosition(
  anchor: PreviewAnchor | null,
  surface: RefObject<HTMLDivElement | null>,
  close: () => void,
) {
  useLayoutEffect(() => {
    const card = surface.current;
    if (!anchor || !card) return;
    card.showPopover?.();
    let frame = 0;
    const position = () => {
      const viewport = window.visualViewport;
      const left = (viewport?.offsetLeft ?? 0) + 12;
      const viewportTop = (viewport?.offsetTop ?? 0) + 12;
      const toolbar =
        anchor.element
          .closest(".thought-document")
          ?.querySelector(".thought-document-bar") ??
        document.querySelector(".knowledge-topbar");
      const top = Math.max(
        viewportTop,
        toolbar?.getBoundingClientRect().bottom ?? viewportTop,
      );
      const right = left + (viewport?.width ?? innerWidth) - 24;
      const bottom = viewportTop + (viewport?.height ?? innerHeight) - 24;
      const rect = anchor.element.getBoundingClientRect();
      let clip = { left, top, right, bottom };
      for (
        let parent = anchor.element.parentElement;
        parent;
        parent = parent.parentElement
      ) {
        const style = getComputedStyle(parent);
        const bounds = parent.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          clip = {
            ...clip,
            left: Math.max(clip.left, bounds.left),
            right: Math.min(clip.right, bounds.right),
          };
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          clip = {
            ...clip,
            top: Math.max(clip.top, bounds.top),
            bottom: Math.min(clip.bottom, bounds.bottom),
          };
        }
      }
      if (
        !anchor.element.isConnected ||
        rect.bottom <= clip.top ||
        rect.top >= clip.bottom ||
        rect.right <= clip.left ||
        rect.left >= clip.right
      ) {
        close();
        return;
      }
      card.style.maxWidth = `${Math.max(0, right - left)}px`;
      card.style.maxHeight = `${Math.max(0, bottom - top)}px`;
      const height = card.offsetHeight;
      const above = rect.top - height - 8 >= top;
      const x = Math.max(left, Math.min(rect.left, right - card.offsetWidth));
      const y = above
        ? rect.top - height - 8
        : Math.max(top, Math.min(rect.bottom + 8, bottom - height));
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      card.dataset.side = above ? "above" : "below";
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    };
    position();
    const observer = new ResizeObserver(schedule);
    observer.observe(card);
    observer.observe(anchor.element);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    viewportListeners("addEventListener");
    function viewportListeners(
      method: "addEventListener" | "removeEventListener",
    ) {
      window.visualViewport?.[method]("resize", schedule);
      window.visualViewport?.[method]("scroll", schedule);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      viewportListeners("removeEventListener");
      if (card.isConnected) card.hidePopover?.();
    };
  }, [anchor, surface, close]);
}
