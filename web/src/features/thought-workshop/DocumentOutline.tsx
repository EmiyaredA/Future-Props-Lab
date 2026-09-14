import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Editor } from "@tiptap/core";
import { ChevronsLeft, ListTree, X } from "lucide-react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { useDocumentOutline } from "./useDocumentOutline";
import "./document-outline.css";

// UI preference lives only for this tab's current workshop session.
let expanded = true;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const snapshot = () => expanded;
function preferExpanded(value: boolean) {
  expanded = value;
  listeners.forEach((listener) => listener());
}

export function DocumentOutline({
  editor,
  title,
}: {
  editor: Editor;
  title: string;
}) {
  const preference = useSyncExternalStore(subscribe, snapshot);
  const { headings, active, layout, navigate } = useDocumentOutline(editor);
  const [floating, setFloating] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLElement>(null);
  const id = useId();
  const docked = layout.wide && preference && headings.length > 0;
  const open = floating && !docked && layout.visible;
  const surface = useDrawerFocus<HTMLDivElement>(
    () => setFloating(false),
    open,
    false,
  );
  useSelectPopover(open, trigger, surface, 520, 280, "start");
  useEffect(() => {
    setFloating(false);
  }, [layout.wide, editor]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        !surface.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setFloating(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, surface]);
  useEffect(() => {
    const nav = list.current;
    const item = nav?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!nav || !item || nav.contains(document.activeElement)) return;
    const bounds = nav.getBoundingClientRect();
    const rect = item.getBoundingClientRect();
    if (rect.top < bounds.top) nav.scrollTop += rect.top - bounds.top;
    else if (rect.bottom > bounds.bottom)
      nav.scrollTop += rect.bottom - bounds.bottom;
  }, [active, docked, open]);
  const jump = (position: number | null) => {
    navigate(position);
    if (!docked) setFloating(false);
  };
  const contents = (
    <>
      <header>
        <span>文档大纲</span>
        <button
          type="button"
          aria-label={docked ? "收起文档大纲" : "关闭文档大纲"}
          onClick={() => {
            if (docked) {
              preferExpanded(false);
              requestAnimationFrame(() =>
                trigger.current?.focus({ preventScroll: true }),
              );
            } else setFloating(false);
          }}
        >
          {docked ? <ChevronsLeft size={16} /> : <X size={16} />}
        </button>
      </header>
      <nav ref={list} aria-label="文档章节">
        <button
          type="button"
          className="thought-outline-title"
          aria-current={active === null ? "location" : undefined}
          onClick={() => jump(null)}
        >
          <span>{title || "未命名文档"}</span>
        </button>
        {headings.length ? (
          headings.map((heading) => (
            <button
              type="button"
              key={heading.position}
              style={{ paddingLeft: 10 + heading.depth * 14 }}
              aria-current={
                active === heading.position ? "location" : undefined
              }
              onClick={() => jump(heading.position)}
            >
              <span>{heading.text}</span>
            </button>
          ))
        ) : (
          <p className="thought-outline-empty">使用标题样式生成文档目录</p>
        )}
      </nav>
    </>
  );
  return (
    <>
      {!layout.wide && (
        <div className="thought-outline-launcher-space" aria-hidden="true" />
      )}
      <aside
        className="thought-outline"
        aria-label="文档大纲"
        style={{
          left: layout.left,
          top: layout.top,
          width: docked ? layout.width : undefined,
          maxHeight: layout.height,
          visibility: layout.visible ? "visible" : "hidden",
        }}
      >
        {docked ? (
          <div
            className="thought-outline-panel"
            style={{ maxHeight: layout.height }}
          >
            {contents}
          </div>
        ) : (
          <>
            <button
              ref={trigger}
              type="button"
              className="thought-outline-trigger"
              aria-expanded={open}
              aria-controls={open ? id : undefined}
              onClick={() => {
                if (layout.wide && headings.length) preferExpanded(true);
                else setFloating(!open);
              }}
            >
              <ListTree size={16} aria-hidden="true" />
              文档大纲
            </button>
            {open && (
              <div
                ref={surface}
                id={id}
                popover="manual"
                role="dialog"
                aria-label="文档大纲"
                className="thought-outline-popover"
              >
                {contents}
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}
