import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import {
  ChevronDown,
  ChevronRight,
  ChevronsRight,
  ListTree,
  X,
} from "lucide-react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";
import { useDrawerFocus } from "@shared/ui/useDrawerFocus";
import { useDocumentOutline } from "./useDocumentOutline";
import type { OutlineHeading } from "./outlineHeadings";
import type { DocumentChrome } from "./document-layout/useDocumentChrome";
import "./document-outline.css";

export function DocumentOutline({
  editor,
  title,
  tools,
  chrome,
  onDockChange,
}: {
  editor: Editor;
  title: string;
  tools?: ReactNode;
  chrome?: DocumentChrome;
  onDockChange?: (docked: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const preference = chrome?.expanded ?? expanded;
  const preferExpanded = chrome?.setExpanded ?? setExpanded;
  const { headings, active, layout, navigate, collapsed, toggle } =
    useDocumentOutline(editor);
  const [floating, setFloating] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLElement>(null);
  const id = useId();
  const docked = layout.wide && preference && headings.length > 0;
  const open = floating && !docked;
  const surface = useDrawerFocus<HTMLDivElement>(
    () => setFloating(false),
    open,
    false,
  );
  useSelectPopover(open, trigger, surface, 580, 300, "end");
  useEffect(() => {
    onDockChange?.(docked);
  }, [docked, onDockChange]);
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
  }, [active, docked, open, collapsed]);
  const jump = (position: number | null) => {
    navigate(position);
    if (!docked) {
      setFloating(false);
      trigger.current?.focus({ preventScroll: true });
    }
  };
  const children = new Map<number | null, OutlineHeading[]>();
  for (const heading of headings) {
    const siblings = children.get(heading.parent) ?? [];
    siblings.push(heading);
    children.set(heading.parent, siblings);
  }
  const branches = (parent: number | null): ReactNode => (
    <ul>
      {(children.get(parent) ?? []).map((heading) => {
        const hasChildren = children.has(heading.position);
        const folded = collapsed.has(heading.position);
        return (
          <li key={heading.position}>
            <div
              className="thought-outline-row"
              style={{ paddingLeft: heading.depth * 14 }}
            >
              {hasChildren ? (
                <button
                  type="button"
                  className="thought-outline-chevron"
                  aria-label={`${folded ? "展开" : "收起"}${heading.text}的子章节`}
                  aria-expanded={!folded}
                  aria-controls={`${id}-${heading.position}`}
                  onClick={() => toggle(heading.position)}
                >
                  {folded ? (
                    <ChevronRight size={14} aria-hidden />
                  ) : (
                    <ChevronDown size={14} aria-hidden />
                  )}
                </button>
              ) : (
                <span className="thought-outline-chevron-space" aria-hidden />
              )}
              <button
                type="button"
                className="thought-outline-link"
                title={heading.text}
                aria-current={
                  active === heading.position ? "location" : undefined
                }
                onClick={() => jump(heading.position)}
              >
                <span>{heading.text}</span>
              </button>
            </div>
            {hasChildren && (
              <div id={`${id}-${heading.position}`} hidden={folded}>
                {branches(heading.position)}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
  const contents = (
    <>
      <header>
        <span>本页目录</span>
        <button
          type="button"
          aria-label={docked ? "收起文档大纲" : "关闭文档大纲"}
          onClick={() => {
            if (docked) preferExpanded(false);
            else setFloating(false);
            requestAnimationFrame(() =>
              trigger.current?.focus({ preventScroll: true }),
            );
          }}
        >
          {docked ? (
            <ChevronsRight size={16} aria-hidden />
          ) : (
            <X size={16} aria-hidden />
          )}
        </button>
      </header>
      <nav ref={list} aria-label="文档章节">
        <button
          type="button"
          className="thought-outline-link thought-outline-title"
          title={title}
          aria-current={active === null ? "location" : undefined}
          onClick={() => jump(null)}
        >
          <span>概览</span>
        </button>
        {headings.length ? (
          branches(null)
        ) : (
          <p className="thought-outline-empty">使用标题样式生成文档目录</p>
        )}
      </nav>
    </>
  );
  const controls = (
    <div className="thought-document-controls">
      {tools}
      <button
        ref={trigger}
        type="button"
        className="btn small thought-outline-trigger"
        aria-label="文档大纲"
        title="本页目录"
        aria-expanded={docked || open}
        aria-controls={docked || open ? id : undefined}
        onClick={() => {
          if (layout.wide && headings.length) preferExpanded(!preference);
          else setFloating(!open);
        }}
      >
        <ListTree size={16} aria-hidden />
        <span>目录</span>
      </button>
    </div>
  );
  return (
    <>
      {chrome?.toolsTarget ? (
        createPortal(controls, chrome.toolsTarget)
      ) : (
        <div className="thought-document-tools">{controls}</div>
      )}
      {docked && (
        <aside
          id={id}
          className="thought-outline"
          aria-label="文档大纲"
          style={{
            left: layout.left,
            top: layout.top,
            width: layout.width,
            maxHeight: layout.height,
            visibility: layout.visible ? "visible" : "hidden",
          }}
        >
          <div
            className="thought-outline-panel"
            style={{ maxHeight: layout.height }}
          >
            {contents}
          </div>
        </aside>
      )}
      {open && (
        <div
          ref={surface}
          id={id}
          popover="manual"
          role="dialog"
          aria-label="文档大纲"
          className="thought-outline thought-outline-popover"
        >
          {contents}
        </div>
      )}
    </>
  );
}
