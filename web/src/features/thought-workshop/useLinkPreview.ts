import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";

export type PreviewAnchor = { element: HTMLAnchorElement; url: string };

function findLink(
  target: EventTarget | null,
  root: HTMLElement,
): PreviewAnchor | null {
  const element =
    target instanceof Element
      ? target.closest<HTMLAnchorElement>("a[href]")
      : null;
  if (
    !element ||
    !root.contains(element) ||
    !/^https?:\/\//i.test(element.getAttribute("href") || "")
  )
    return null;
  try {
    const url = new URL(element.href);
    if (url.username || url.password) return null;
    return { element, url: url.href };
  } catch {
    return null;
  }
}

export function useLinkPreview(editor: Editor) {
  const [anchor, setAnchor] = useState<PreviewAnchor | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const openAction = useRef<HTMLAnchorElement>(null);
  const controls = useRef({ close: () => {}, keep: () => {}, leave: () => {} });

  useEffect(() => {
    const root = editor.view.dom;
    let current: PreviewAnchor | null = null;
    let pending: HTMLAnchorElement | null = null;
    let opening: ReturnType<typeof setTimeout> | undefined;
    let closing: ReturnType<typeof setTimeout> | undefined;
    let touchTarget: HTMLAnchorElement | null = null;
    let restoringFocus = false;
    const keep = () => clearTimeout(closing);
    const close = () => {
      clearTimeout(opening);
      clearTimeout(closing);
      current = null;
      pending = null;
      setAnchor(null);
    };
    const leave = () => {
      clearTimeout(opening);
      pending = null;
      clearTimeout(closing);
      closing = setTimeout(close, 150);
    };
    const show = (next: PreviewAnchor, delay: number) => {
      keep();
      if (current?.element === next.element && current.url === next.url) return;
      if (delay && pending === next.element) return;
      close();
      pending = next.element;
      const activate = () => {
        pending = null;
        if (!next.element.isConnected) return;
        current = next;
        setAnchor(next);
      };
      if (delay) opening = setTimeout(activate, delay);
      else activate();
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      const link = findLink(event.target, root);
      if (link) show(link, 300);
    };
    const out = (event: PointerEvent) => {
      if (current?.element.contains(event.relatedTarget as Node | null)) return;
      if (surface.current?.contains(event.relatedTarget as Node | null)) keep();
      else leave();
    };
    const focus = (event: FocusEvent) => {
      if (restoringFocus) return;
      const link = findLink(event.target, root);
      if (link) show(link, 0);
    };
    const blur = (event: FocusEvent) => {
      if (!surface.current?.contains(event.relatedTarget as Node | null))
        leave();
    };
    const pointerDown = (event: PointerEvent) => {
      const link = findLink(event.target, root);
      touchTarget =
        event.pointerType === "touch" ? (link?.element ?? null) : null;
      if (!link && !surface.current?.contains(event.target as Node)) close();
    };
    const click = (event: MouseEvent) => {
      const link = findLink(event.target, root);
      if (link && link.element === touchTarget) {
        event.preventDefault();
        event.stopPropagation();
        show(link, 0);
      }
      touchTarget = null;
    };
    const key = (event: KeyboardEvent) => {
      if (!current) return;
      const inside = surface.current?.contains(event.target as Node);
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        const previous = current.element;
        close();
        if (inside) {
          restoringFocus = true;
          previous.focus({ preventScroll: true });
          restoringFocus = false;
        }
      } else if (
        event.key === "Tab" &&
        !event.shiftKey &&
        event.target === current.element
      ) {
        event.preventDefault();
        openAction.current?.focus();
      } else if (event.key === "Tab" && event.shiftKey && inside) {
        event.preventDefault();
        current.element.focus({ preventScroll: true });
      }
    };
    controls.current = { close, keep, leave };
    root.addEventListener("pointerover", over);
    root.addEventListener("pointerout", out);
    root.addEventListener("focusin", focus);
    root.addEventListener("focusout", blur);
    root.addEventListener("click", click, true);
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("keydown", key, true);
    // setContent(..., emitUpdate:false) still dispatches a document transaction.
    const transaction = ({
      transaction: tr,
    }: {
      transaction: { docChanged: boolean };
    }) => {
      if (tr.docChanged) close();
    };
    editor.on("transaction", transaction);
    return () => {
      clearTimeout(opening);
      clearTimeout(closing);
      root.removeEventListener("pointerover", over);
      root.removeEventListener("pointerout", out);
      root.removeEventListener("focusin", focus);
      root.removeEventListener("focusout", blur);
      root.removeEventListener("click", click, true);
      document.removeEventListener("pointerdown", pointerDown, true);
      document.removeEventListener("keydown", key, true);
      editor.off("transaction", transaction);
    };
  }, [editor]);
  return { anchor, surface, openAction, controls };
}
