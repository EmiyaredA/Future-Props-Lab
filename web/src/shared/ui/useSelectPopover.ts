import { useLayoutEffect, type RefObject } from "react";

/** Keep the custom menu inside its focus scope, but above scroll clipping. */
export function useSelectPopover(
  open: boolean,
  trigger: RefObject<HTMLButtonElement | null>,
  menu: RefObject<HTMLDivElement | null>,
) {
  useLayoutEffect(() => {
    const element = menu.current;
    const anchor = trigger.current;
    if (!open || !element || !anchor) return;
    element.showPopover?.();
    const position = () => {
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(Math.max(rect.width, 180), innerWidth - 24);
      const visibleTop = window.visualViewport?.offsetTop ?? 0;
      const visibleBottom =
        visibleTop + (window.visualViewport?.height ?? innerHeight);
      const below = visibleBottom - rect.bottom - 17;
      const above = rect.top - visibleTop - 17;
      const upwards = below < 180 && above > below;
      Object.assign(element.style, {
        position: "fixed",
        margin: "0",
        right: "auto",
        bottom: "auto",
        width: `${width}px`,
        maxHeight: `${Math.max(40, Math.min(280, upwards ? above : below))}px`,
        left: `${Math.max(12, Math.min(rect.right - width, innerWidth - width - 12))}px`,
      });
      element.style.top = `${Math.max(visibleTop + 12, Math.min(visibleBottom - element.offsetHeight - 12, upwards ? rect.top - element.offsetHeight - 5 : rect.bottom + 5))}px`;
    };
    position();
    const scroll = (event: Event) => {
      if (!element.contains(event.target as Node)) position();
    };
    window.visualViewport?.addEventListener("resize", position);
    window.visualViewport?.addEventListener("scroll", position);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", scroll, true);
    return () => {
      window.visualViewport?.removeEventListener("resize", position);
      window.visualViewport?.removeEventListener("scroll", position);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", scroll, true);
      if (element.isConnected) element.hidePopover?.();
    };
  }, [open, trigger, menu]);
}
