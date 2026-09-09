import { useEffect, useRef } from "react";

/** Contain focus in an open panel without resetting it when its viewport changes. */
export function useDrawerFocus<T extends HTMLElement = HTMLElement>(
  close: () => void,
  active = true,
  compactOnly = true,
) {
  const root = useRef<T>(null);
  const onClose = useRef(close);
  onClose.current = close;
  const wasActive = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  // Capture before child autoFocus runs in the commit phase.
  if (active && !wasActive.current)
    opener.current = document.activeElement as HTMLElement | null;
  wasActive.current = active;
  useEffect(() => {
    const element = root.current;
    if (!active || !element) return;
    const media = window.matchMedia("(max-width: 1200px)");
    const previousRole = element.getAttribute("role");
    const previousModal = element.getAttribute("aria-modal");
    let release: (() => void) | undefined;
    const update = () => {
      release?.();
      release = undefined;
      if (compactOnly && !media.matches) return;
      element.setAttribute("role", "dialog");
      element.setAttribute("aria-modal", "true");
      const controls = () =>
        Array.from(
          element.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
          ),
        ).filter(
          (item) =>
            item.getClientRects().length &&
            getComputedStyle(item).visibility !== "hidden",
        );
      if (!element.contains(document.activeElement)) controls()[0]?.focus();
      const key = (event: KeyboardEvent) => {
        if (event.defaultPrevented) return;
        if (!element.contains(document.activeElement)) {
          // WebKit can leave focus on body after a pointer activates a button.
          const dialogs = Array.from(
            document.querySelectorAll<HTMLElement>('[aria-modal="true"]'),
          ).filter((item) => item.getClientRects().length);
          if (
            document.activeElement !== document.body ||
            dialogs.at(-1) !== element
          )
            return;
          if (event.key === "Tab") {
            event.preventDefault();
            (event.shiftKey ? controls().at(-1) : controls()[0])?.focus();
            return;
          }
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onClose.current();
        }
        if (event.key !== "Tab") return;
        const items = controls(),
          first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      };
      document.addEventListener("keydown", key);
      release = () => {
        document.removeEventListener("keydown", key);
        if (previousRole) element.setAttribute("role", previousRole);
        else element.removeAttribute("role");
        if (previousModal) element.setAttribute("aria-modal", previousModal);
        else element.removeAttribute("aria-modal");
      };
    };
    update();
    if (compactOnly) media.addEventListener("change", update);
    const previous = opener.current;
    return () => {
      if (compactOnly) media.removeEventListener("change", update);
      release?.();
      if (previous?.isConnected) previous.focus();
    };
  }, [active, compactOnly]);
  return root;
}
