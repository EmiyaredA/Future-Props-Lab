import { useEffect, useLayoutEffect, useId, useRef, useState } from "react";
import { useSelectPopover } from "@shared/ui/useSelectPopover";
import { TextInputDialog } from "@shared/ui/TextInputDialog";
import type { ManagedFile } from "@features/files";
import { GenerationMediaPreview } from "./GenerationMediaPreview";
import { PromptRenderedContent } from "./PromptRenderedContent";
import { useH3PromptEditing } from "./useH3PromptEditing";
import type { H3Selection } from "./h3PromptSelection";
import type { PromptMentionOption } from "./generationPromptModel";
import type {
  PromptReferenceSlots,
  PromptRenderDocument,
} from "./promptRendering";

/** Rendered text stays source-backed; @ inserts only at an explicit source caret. */
export function H3PromptPreview({
  value,
  document: parsed,
  assets,
  referenceSlots,
  mentions,
  label,
  maxLength = 6000,
  onInsert,
  onChange,
  onBlur,
}: {
  value: string;
  document: PromptRenderDocument;
  assets: ManagedFile[];
  referenceSlots?: PromptReferenceSlots;
  mentions: PromptMentionOption[];
  label: string;
  maxLength?: number;
  onInsert: (value: string) => void;
  onChange: (value: string) => void;
  onBlur?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const editable = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const insertion = useRef<H3Selection>({
    start: value.length,
    end: value.length,
  });
  const [query, setQuery] = useState<string>();
  const [active, setActive] = useState(0);
  const [top, setTop] = useState(24);
  const [dialogue, setDialogue] = useState(false);
  const dirty = useRef(false);
  const editing = useH3PromptEditing({
    root: editable,
    value,
    document: parsed,
    maxLength,
    onChange: (next) => {
      dirty.current = true;
      onChange(next);
    },
    onInsert: (next) => {
      dirty.current = false;
      onInsert(next);
    },
    onMention: () => openMention(),
  });
  const shown = mentions.filter(
    (item) =>
      !query ||
      `${item.label} ${item.description ?? ""} ${item.source}`
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  useSelectPopover(query !== undefined, anchor, menu, 300, 300, "start");
  const menuOpen = query !== undefined;
  useLayoutEffect(() => {
    if (menuOpen) search.current?.focus({ preventScroll: true });
  }, [menuOpen]);
  useEffect(() => {
    if (query === undefined) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setQuery(undefined);
    };
    window.document.addEventListener("pointerdown", outside);
    return () => window.document.removeEventListener("pointerdown", outside);
  }, [query]);
  const rememberCaret = () => {
    insertion.current = { ...editing.read() };
    const selection = window.getSelection();
    if (!selection || !root.current) return;
    const bounds = root.current.getBoundingClientRect();
    const rect = selection.rangeCount
      ? selection.getRangeAt(0).getBoundingClientRect?.()
      : undefined;
    setTop(rect?.height ? rect.bottom - bounds.top : 24);
  };
  const openMention = () => {
    rememberCaret();
    setActive(0);
    setQuery("");
  };
  const insert = (source: string) => {
    setQuery(undefined);
    setDialogue(false);
    editing.replace(source, insertion.current, true);
  };
  const choose = (item?: PromptMentionOption) => {
    if (!item) return;
    if (item.kind === "dialogue") {
      setQuery(undefined);
      setDialogue(true);
    } else insert(item.source);
  };
  return (
    <div
      ref={root}
      className="prompt-render-preview"
      role="region"
      aria-label={`${label}渲染预览`}
      onBlur={(event) => {
        if (
          dirty.current &&
          !root.current?.contains(event.relatedTarget as Node)
        ) {
          dirty.current = false;
          onBlur?.();
        }
      }}
    >
      <div
        ref={editable}
        className="prompt-render-editor"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        {...editing.handlers}
        onMouseUp={() => {
          editing.handlers.onMouseUp();
          rememberCaret();
        }}
        onKeyDown={(event) => {
          if (
            event.target !== editable.current ||
            event.nativeEvent.isComposing
          )
            return;
          if (query === undefined) {
            if (
              event.key === "@" &&
              !event.metaKey &&
              !event.ctrlKey &&
              !event.altKey
            ) {
              event.preventDefault();
              openMention();
            } else editing.handlers.onKeyDown(event);
            return;
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setQuery(undefined);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) =>
              shown.length
                ? (index + (event.key === "ArrowDown" ? 1 : shown.length - 1)) %
                  shown.length
                : 0,
            );
          } else if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            choose(shown[active]);
          } else if (event.key === "Backspace") {
            event.preventDefault();
            setActive(0);
            setQuery(query.slice(0, -1));
          } else if (event.key.length === 1) {
            event.preventDefault();
            setActive(0);
            setQuery(query + event.key);
          }
        }}
      >
        <div key={`${value}:${editing.revision}`}>
          <PromptRenderedContent
            document={parsed}
            assets={assets}
            referenceSlots={referenceSlots}
            caret={editing.caret}
          />
        </div>
      </div>
      {query !== undefined && (
        <>
          <button
            className="prompt-mention-anchor"
            style={{ top }}
            ref={anchor}
            type="button"
            tabIndex={-1}
            aria-hidden
          />
          <div
            ref={menu}
            popover="manual"
            className="generation-prompt-mention-menu"
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") {
                event.preventDefault();
                setQuery(undefined);
                editable.current?.focus();
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) =>
                  shown.length
                    ? (index +
                        (event.key === "ArrowDown" ? 1 : shown.length - 1)) %
                      shown.length
                    : 0,
                );
              } else if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                choose(shown[active]);
              }
            }}
          >
            <input
              ref={search}
              role="combobox"
              aria-label="搜索引用"
              aria-expanded="true"
              aria-controls={menuId}
              aria-autocomplete="list"
              aria-activedescendant={
                shown[active] ? `${menuId}-option-${active}` : undefined
              }
              value={query}
              placeholder="搜索素材、主体或说话人"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
            />
            <div role="listbox" aria-label="引用已选素材" id={menuId}>
              {shown.map((item, index) => (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  id={`${menuId}-option-${index}`}
                  aria-label={item.label}
                  aria-selected={active === index}
                  data-reference-kind={item.kind}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(item)}
                >
                  <span className="generation-prompt-option-preview">
                    {item.file ? (
                      <GenerationMediaPreview file={item.file} thumbnailOnly />
                    ) : (
                      <span>
                        {item.kind === "dialogue"
                          ? "对白"
                          : item.kind === "speaker"
                            ? "S"
                            : "主体"}
                      </span>
                    )}
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description ?? item.source}</small>
                  </span>
                </button>
              ))}
              {!shown.length && <span>没有匹配的引用</span>}
            </div>
          </div>
        </>
      )}
      {editing.error && <p role="alert">{editing.error}</p>}
      <small className="prompt-render-count">
        {value.length}/{maxLength}
      </small>
      {dialogue && (
        <TextInputDialog
          open
          title="插入对白"
          label="对白内容"
          confirmLabel="插入"
          onCancel={() => setDialogue(false)}
          onConfirm={(text) => insert(`<d>[Chinese] ${text}</d>`)}
        />
      )}
    </div>
  );
}
