import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { collectOutline, revealOutlineTarget } from "./outlineHeadings";

export function useDocumentOutline(editor: Editor) {
  const [headings, setHeadings] = useState(() =>
    collectOutline(editor.state.doc),
  );
  const [active, setActive] = useState<number | null>(null);
  const [layout, setLayout] = useState({
    wide: false,
    left: 16,
    top: 16,
    width: 180,
    height: 400,
    visible: false,
  });
  const restores = useRef(new Map<HTMLElement, () => void>());
  const refresh = useRef(() => {});
  const topOffset = useRef(16);

  useEffect(() => {
    const root = editor.view.dom;
    let composing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      if (composing || editor.view.composing || editor.isDestroyed) return;
      restores.current.forEach((restore) => restore());
      setHeadings(collectOutline(editor.state.doc));
    };
    const transaction = ({
      transaction: tr,
    }: {
      transaction: { docChanged: boolean };
    }) => {
      if (tr.docChanged) update();
    };
    const start = () => {
      composing = true;
    };
    const end = () => {
      composing = false;
      timer = setTimeout(update, 0);
    };
    editor.on("transaction", transaction);
    root.addEventListener("compositionstart", start);
    root.addEventListener("compositionend", end);
    const temporary = restores.current;
    return () => {
      clearTimeout(timer);
      editor.off("transaction", transaction);
      root.removeEventListener("compositionstart", start);
      root.removeEventListener("compositionend", end);
      temporary.forEach((restore) => restore());
    };
  }, [editor]);

  useEffect(() => {
    const root = editor.view.dom;
    const host =
      root.closest<HTMLElement>(".thought-rich-editor") ?? root.parentElement!;
    let frame = 0;
    const measure = () => {
      if (editor.isDestroyed) return;
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop ?? 0;
      const viewportBottom = viewportTop + (viewport?.height ?? innerHeight);
      const hostRect = host.getBoundingClientRect();
      const proseRect = root.getBoundingClientRect();
      const toolbar =
        root
          .closest(".thought-document")
          ?.querySelector(".thought-document-bar") ??
        document.querySelector(".knowledge-topbar") ??
        root.closest(".readonly-page")?.querySelector("header");
      const barBottom = toolbar?.getBoundingClientRect().bottom ?? viewportTop;
      const stickyTop = Math.max(viewportTop, barBottom) + 16;
      const top = Math.max(stickyTop, hostRect.top + 16);
      const gutter = proseRect.left - hostRect.left;
      const wide = gutter >= 212;
      const readingTop = stickyTop + (wide ? 0 : 44);
      topOffset.current = readingTop;
      const height = Math.max(
        0,
        Math.min(viewportBottom - 16, hostRect.bottom) - top,
      );
      const next = {
        wide,
        left: Math.max(
          (viewport?.offsetLeft ?? 0) + 16,
          wide ? hostRect.left + 16 : proseRect.left,
        ),
        top,
        width: Math.min(220, Math.max(180, gutter - 32)),
        height,
        visible: height >= 40 && hostRect.top < viewportBottom,
      };
      setLayout((previous) =>
        Object.keys(next).every(
          (key) =>
            previous[key as keyof typeof next] ===
            next[key as keyof typeof next],
        )
          ? previous
          : next,
      );
      const visibleHeadings = headings.flatMap((heading) => {
        const element = editor.view.nodeDOM(heading.position);
        if (
          !(element instanceof HTMLElement) ||
          !element.getClientRects().length
        )
          return [];
        return [{ ...heading, rect: element.getBoundingClientRect() }];
      });
      let current =
        visibleHeadings
          .filter((heading) => heading.rect.top <= readingTop + 12)
          .at(-1)?.position ?? null;
      const scrolling = document.scrollingElement;
      if (
        scrolling &&
        scrolling.scrollHeight > scrolling.clientHeight + 1 &&
        scrolling.scrollTop + scrolling.clientHeight >=
          scrolling.scrollHeight - 2
      ) {
        current =
          visibleHeadings
            .filter(
              (heading) =>
                heading.rect.top < viewportBottom &&
                heading.rect.bottom > readingTop,
            )
            .at(-1)?.position ?? current;
      }
      setActive(current);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    refresh.current = schedule;
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    observer.observe(host);
    const toolbar = document.querySelector(".knowledge-topbar");
    if (toolbar) observer.observe(toolbar);
    root.addEventListener("load", schedule, true);
    root.addEventListener("click", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      root.removeEventListener("load", schedule, true);
      root.removeEventListener("click", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      refresh.current = () => {};
    };
  }, [editor, headings]);

  const navigate = useCallback(
    (position: number | null) => {
      if (editor.isDestroyed || editor.view.composing) return;
      const root = editor.view.dom;
      const element =
        position === null
          ? root.closest<HTMLElement>(".thought-rich-editor")
          : editor.view.nodeDOM(position);
      if (!(element instanceof HTMLElement)) return;
      revealOutlineTarget(element, restores.current);
      element.scrollIntoView({ block: "start", behavior: "instant" });
      // Do not mutate heading styles: ProseMirror can reparse that mutation and
      // refresh a details node view, losing its temporary UI-only revelation.
      window.scrollBy({
        top: element.getBoundingClientRect().top - topOffset.current,
        behavior: "instant",
      });
      setActive(position);
      refresh.current();
    },
    [editor],
  );
  return { headings, active, layout, navigate };
}
