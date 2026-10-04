import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { collectOutline, revealOutlineTarget } from "./outlineHeadings";

function scrollContainer(root: HTMLElement): HTMLElement | null {
  for (let parent = root.parentElement; parent; parent = parent.parentElement) {
    if (parent === document.body || parent === document.documentElement) break;
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) return parent;
  }
  return null;
}

export function useDocumentOutline(editor: Editor) {
  const [headings, setHeadings] = useState(() =>
    collectOutline(editor.state.doc),
  );
  const [active, setActive] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const folded = useRef(collapsed);
  const lastActive = useRef<number | null>(null);
  const [layout, setLayout] = useState({
    wide: false,
    left: 16,
    top: 16,
    width: 220,
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
      const next = collectOutline(editor.state.doc);
      const positions = new Set(next.map((heading) => heading.position));
      folded.current = new Set(
        [...folded.current].filter((pos) => positions.has(pos)),
      );
      setCollapsed(folded.current);
      setHeadings(next);
    };
    const transaction = ({ transaction: tr }: { transaction: Transaction }) => {
      if (!tr.docChanged) return;
      const mappedActive = (position: number | null) => {
        if (position === null) return null;
        const mapped = tr.mapping.mapResult(position, 1);
        return mapped.deleted ? null : mapped.pos;
      };
      lastActive.current = mappedActive(lastActive.current);
      setActive(mappedActive);
      folded.current = new Set(
        [...folded.current].flatMap((pos) => {
          const mapped = tr.mapping.mapResult(pos, 1);
          return mapped.deleted ? [] : [mapped.pos];
        }),
      );
      update();
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
    if (active === lastActive.current) return;
    lastActive.current = active;
    const byPosition = new Map(
      headings.map((heading) => [heading.position, heading]),
    );
    const next = new Set(folded.current);
    let parent = active === null ? null : byPosition.get(active)?.parent;
    while (parent != null) {
      next.delete(parent);
      parent = byPosition.get(parent)?.parent;
    }
    folded.current = next;
    setCollapsed(next);
  }, [active, headings]);

  useEffect(() => {
    const root = editor.view.dom;
    const host =
      root.closest<HTMLElement>(".thought-rich-editor") ?? root.parentElement!;
    const scroller = scrollContainer(root);
    const main = host.closest(".knowledge-main");
    const toolbar =
      main?.querySelector(".knowledge-topbar") ??
      root
        .closest(".thought-document")
        ?.querySelector(".thought-document-bar") ??
      root.closest(".readonly-page")?.querySelector("header");
    let frame = 0;
    const measure = () => {
      if (editor.isDestroyed) return;
      const viewport = window.visualViewport;
      const viewportTop = Math.max(
        viewport?.offsetTop ?? 0,
        scroller?.getBoundingClientRect().top ?? 0,
      );
      const viewportBottom = Math.min(
        (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight),
        scroller?.getBoundingClientRect().bottom ?? Infinity,
      );
      const hostRect = host.getBoundingClientRect();
      const barBottom = toolbar?.getBoundingClientRect().bottom ?? viewportTop;
      const formatBottom =
        host.querySelector(".thought-toolbar")?.getBoundingClientRect()
          .bottom ?? 0;
      const readingTop = Math.max(viewportTop, barBottom, formatBottom) + 16;
      topOffset.current = readingTop;
      const top = Math.max(readingTop + 16, hostRect.top + 32);
      const height = Math.max(
        0,
        Math.min(viewportBottom - 24, hostRect.bottom) - top,
      );
      const next = {
        wide: hostRect.width >= 960,
        left: hostRect.right - 252,
        top,
        width: 220,
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
      const scrolling = scroller ?? document.scrollingElement;
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
      const scroll = scrollContainer(root) ?? window;
      scroll.scrollBy({
        top: element.getBoundingClientRect().top - topOffset.current,
        behavior: "instant",
      });
      setActive(position);
      refresh.current();
    },
    [editor],
  );
  const toggle = (position: number) => {
    const next = new Set(folded.current);
    if (next.has(position)) next.delete(position);
    else next.add(position);
    folded.current = next;
    setCollapsed(next);
  };
  return { headings, active, layout, navigate, collapsed, toggle };
}
