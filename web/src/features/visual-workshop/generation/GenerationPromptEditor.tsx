import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ManagedFile } from "@features/files";
import {
  EMPTY_PROMPT_TEXT,
  normalizePromptParts,
  promptAssetPart,
  promptAssetReferenceName,
  promptCaret,
  promptCaretAtOffset,
  promptKey,
  promptMentionAtCaret,
  promptPartLength,
  promptPartsFromValue,
  promptPartsSignature,
  promptProjection,
  promptSelectedText,
  promptSelection,
  promptTextPart,
  renderPromptParts,
  resolvePromptReferences,
  type PromptCaret,
  type PromptMention,
  type PromptPart,
  type PromptSelection,
  type PromptTextPart,
} from "@features/visual-workshop/generation/generationPromptModel";
import { GenerationMediaPreview } from "@features/visual-workshop/generation/GenerationMediaPreview";

export function GenerationPromptEditor({
  value,
  assets,
  label,
  placeholder,
  onChange,
  onBlur,
  canvasHistoryShortcuts = false,
}: {
  value: string;
  assets: ManagedFile[];
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  canvasHistoryShortcuts?: boolean;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastCaret = useRef<PromptCaret | undefined>(undefined);
  const pendingCaret = useRef<PromptCaret | undefined>(undefined);
  const pendingDomSync = useRef(true);
  const composing = useRef(false);
  const [parts, setParts] = useState<PromptPart[]>(() => [
    ...promptPartsFromValue(value, assets),
  ]);
  const [mention, setMention] = useState<PromptMention>();
  const [mentionTop, setMentionTop] = useState(32);
  const [activeOption, setActiveOption] = useState(0);
  const query = mention?.query.trim().toLocaleLowerCase("zh-CN") ?? "";
  const options = assets
    .filter((file) =>
      query
        ? `${file.display_name} ${file.original_filename} ${promptAssetReferenceName(file)}`
            .toLocaleLowerCase("zh-CN")
            .includes(query)
        : true,
    )
    .slice(0, 8);

  const restoreCaret = (caret: PromptCaret) => {
    const root = editorRef.current;
    const textElement = [
      ...(root?.querySelectorAll<HTMLElement>("[data-prompt-text]") ?? []),
    ].find((element) => element.dataset.partKey === caret.key);
    const node = textElement?.firstChild;
    if (!textElement || !node) return;
    const length = node.textContent?.length ?? 0;
    const offset =
      length === 1 && node.textContent === EMPTY_PROMPT_TEXT
        ? 1
        : Math.min(caret.offset, length);
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    lastCaret.current = caret;
  };

  useLayoutEffect(() => {
    const root = editorRef.current;
    if (!root || !pendingDomSync.current) return;
    pendingDomSync.current = false;
    renderPromptParts(root, parts);
    if (!pendingCaret.current) return;
    const caret = pendingCaret.current;
    pendingCaret.current = undefined;
    restoreCaret(caret);
  }, [parts]);

  useEffect(() => {
    const nextParts = promptPartsFromValue(value, assets);
    const projected = promptProjection(parts);
    const nextProjected = promptProjection(nextParts);
    if (
      projected === nextProjected &&
      promptPartsSignature(parts) === promptPartsSignature(nextParts)
    ) {
      if (value !== nextProjected) onChange(nextProjected);
      return;
    }
    if (
      !canvasHistoryShortcuts &&
      document.activeElement === editorRef.current &&
      value !== projected
    )
      return;
    pendingDomSync.current = true;
    setParts(nextParts);
    if (value !== nextProjected) onChange(nextProjected);
  }, [assets, canvasHistoryShortcuts, onChange, parts, value]);

  useEffect(() => setActiveOption(0), [query]);

  const commit = (
    next: PromptPart[],
    caret?: PromptCaret,
    options: { parseReferences?: boolean } = {},
  ) => {
    const normalized = options.parseReferences
      ? resolvePromptReferences(next, assets)
      : normalizePromptParts(next);
    const projected = promptProjection(normalized);
    if (projected.length > 6000) {
      pendingDomSync.current = true;
      setParts((current) => [...current]);
      return;
    }
    if (caret) {
      lastCaret.current = caret;
      pendingCaret.current = caret;
    }
    pendingDomSync.current = true;
    setParts(normalized);
    onChange(projected);
  };

  const rememberCaret = () => {
    const root = editorRef.current;
    if (!root) return;
    const caret = promptCaret(root);
    if (caret) lastCaret.current = caret;
  };

  const placeMentionMenu = () => {
    const root = editorRef.current;
    const selection = window.getSelection();
    if (!root || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return;
    const caretRect =
      typeof range.getBoundingClientRect === "function"
        ? range.getBoundingClientRect()
        : undefined;
    if (!caretRect) return;
    const rootRect = root.getBoundingClientRect();
    setMentionTop(Math.max(28, caretRect.bottom - rootRect.top + 6));
  };

  const ensureCaret = () => {
    const root = editorRef.current;
    if (!root) return;
    const selection = window.getSelection();
    // Non-collapsed selection: leave highlight alone (promptCaret only tracks caret).
    if (
      selection &&
      !selection.isCollapsed &&
      selection.anchorNode &&
      root.contains(selection.anchorNode)
    )
      return;
    const caret = promptCaret(root);
    if (caret) {
      lastCaret.current = caret;
      return;
    }
    const fallback = [...parts]
      .reverse()
      .find((part): part is PromptTextPart => part.type === "text");
    if (fallback)
      restoreCaret(
        lastCaret.current ?? {
          key: fallback.key,
          offset: fallback.text.length,
        },
      );
  };

  const selectAssetElement = (target: EventTarget | null) => {
    const root = editorRef.current;
    if (!(target instanceof Element) || !root) return false;
    if (target.closest("[data-remove-prompt-asset]")) return false;
    const asset = target.closest<HTMLElement>("[data-asset-id]");
    if (!asset || !root.contains(asset)) return false;
    const selection = window.getSelection();
    if (!selection?.isCollapsed) return true;
    root.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNode(asset);
    selection.removeAllRanges();
    selection.addRange(range);
    setMention(undefined);
    return true;
  };

  const insertText = (
    text: string,
    options: { parseReferences?: boolean } = {},
  ) => {
    const caret = lastCaret.current;
    if (!caret) return;
    const index = parts.findIndex((part) => part.key === caret.key);
    const current = parts[index];
    if (current?.type !== "text") return;
    const next = {
      ...current,
      text:
        current.text.slice(0, caret.offset) +
        text +
        current.text.slice(caret.offset),
    };
    commit(
      [...parts.slice(0, index), next, ...parts.slice(index + 1)],
      {
        key: next.key,
        offset: caret.offset + text.length,
      },
      options,
    );
  };

  const replaceSelection = (
    selection: PromptSelection,
    replacement = "",
    options: { parseReferences?: boolean } = {},
  ) => {
    let { start, end } = selection;
    let offset = 0;
    for (const part of parts) {
      const length = promptPartLength(part);
      const partEnd = offset + length;
      if (part.type === "asset") {
        if (start > offset && start < partEnd) start = offset;
        if (end > offset && end < partEnd) end = partEnd;
      }
      offset = partEnd;
    }
    const next: PromptPart[] = [];
    let inserted = false;
    offset = 0;
    for (const part of parts) {
      const length = promptPartLength(part);
      const partEnd = offset + length;
      if (partEnd <= start || offset >= end) {
        if (!inserted && offset >= end) {
          next.push(promptTextPart(replacement));
          inserted = true;
        }
        next.push(part);
        offset = partEnd;
        continue;
      }
      if (part.type === "text") {
        const prefixLength = Math.max(0, start - offset);
        const suffixOffset = Math.min(length, Math.max(0, end - offset));
        if (prefixLength)
          next.push({ ...part, text: part.text.slice(0, prefixLength) });
        if (!inserted) {
          next.push(promptTextPart(replacement));
          inserted = true;
        }
        if (suffixOffset < length)
          next.push(promptTextPart(part.text.slice(suffixOffset)));
      } else if (!inserted) {
        next.push(promptTextPart(replacement));
        inserted = true;
      }
      offset = partEnd;
    }
    if (!inserted) next.push(promptTextPart(replacement));
    const normalized = normalizePromptParts(next);
    const caret = promptCaretAtOffset(normalized, start + replacement.length);
    commit(normalized, caret, options);
    setMention(undefined);
  };

  const removeAsset = (key: string) => {
    const index = parts.findIndex((part) => part.key === key);
    if (index < 0) return;
    const before = parts[index - 1];
    commit(
      parts.filter((part) => part.key !== key),
      before?.type === "text"
        ? { key: before.key, offset: before.text.length }
        : undefined,
    );
  };

  const selectAsset = (file: ManagedFile) => {
    if (!mention) return;
    const index = parts.findIndex((part) => part.key === mention.key);
    const current = parts[index];
    if (current?.type !== "text") return;
    const before = { ...current, text: current.text.slice(0, mention.start) };
    const after = promptTextPart(current.text.slice(mention.offset));
    commit(
      [
        ...parts.slice(0, index),
        before,
        promptAssetPart(file),
        after,
        ...parts.slice(index + 1),
      ],
      { key: after.key, offset: 0 },
    );
    setMention(undefined);
  };

  const syncFromDom = () => {
    const root = editorRef.current;
    if (!root) return;
    const known = new Map(
      [
        ...assets,
        ...parts.flatMap((part) => (part.type === "asset" ? [part.file] : [])),
      ].map((file) => [file.id, file]),
    );
    const next: PromptPart[] = [];
    for (const node of [...root.childNodes]) {
      if (node instanceof HTMLElement && node.dataset.assetId) {
        const file = known.get(node.dataset.assetId);
        if (file)
          next.push({
            key: node.dataset.partKey || promptKey("asset"),
            type: "asset",
            file,
          });
        continue;
      }
      let element = node instanceof HTMLElement ? node : undefined;
      if (!element) {
        element = document.createElement("span");
        element.dataset.promptText = "";
        element.dataset.partKey = promptKey("text");
        root.insertBefore(element, node);
        element.append(node);
      } else if (!element.dataset.partKey) {
        element.dataset.promptText = "";
        element.dataset.partKey = promptKey("text");
      }
      next.push({
        key: element.dataset.partKey,
        type: "text",
        text: (node.textContent || "").replaceAll(EMPTY_PROMPT_TEXT, ""),
      });
    }
    const caret = promptCaret(root);
    if (caret) lastCaret.current = caret;
    const normalized = normalizePromptParts(next);
    const projected = promptProjection(normalized);
    if (projected.length > 6000) {
      pendingDomSync.current = true;
      if (caret) pendingCaret.current = caret;
      setParts((current) => [...current]);
      return;
    }
    setParts(normalized);
    onChange(projected);
    setMention(promptMentionAtCaret(normalized, caret) ?? undefined);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    rememberCaret();
    const root = editorRef.current;
    const selection = root ? promptSelection(root, parts) : null;
    if (
      !composing.current &&
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      if (selection && selection.start !== selection.end) {
        event.preventDefault();
        replaceSelection(selection, event.key);
        return;
      }
      const caret = lastCaret.current;
      const textElement = caret
        ? [
            ...(editorRef.current?.querySelectorAll<HTMLElement>(
              "[data-prompt-text]",
            ) ?? []),
          ].find((element) => element.dataset.partKey === caret.key)
        : undefined;
      if (caret && textElement) {
        const text = (textElement.textContent || "").replaceAll(
          EMPTY_PROMPT_TEXT,
          "",
        );
        const nextText =
          text.slice(0, caret.offset) + event.key + text.slice(caret.offset);
        placeMentionMenu();
        setMention(
          promptMentionAtCaret(
            [{ key: caret.key, type: "text", text: nextText }],
            { key: caret.key, offset: caret.offset + event.key.length },
          ) ?? undefined,
        );
      }
    }
    if (mention && !composing.current) {
      if (
        options.length &&
        (event.key === "ArrowDown" || event.key === "ArrowUp")
      ) {
        event.preventDefault();
        setActiveOption((current) =>
          event.key === "ArrowDown"
            ? (current + 1) % options.length
            : (current - 1 + options.length) % options.length,
        );
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const file = options[activeOption];
        if (file) selectAsset(file);
        return;
      }
    }
    if (event.key === "Escape" && mention) {
      event.preventDefault();
      setMention(undefined);
      return;
    }
    if (event.key === "Enter" && !composing.current) {
      event.preventDefault();
      if (selection && selection.start !== selection.end)
        replaceSelection(selection, "\n");
      else insertText("\n");
      return;
    }
    if (event.key !== "Backspace" && event.key !== "Delete") return;
    if (composing.current || event.nativeEvent.isComposing) return;
    if (!selection) return;
    let { start, end } = selection;
    if (start === end) {
      if (event.key === "Backspace" && start > 0) start -= 1;
      if (event.key === "Delete" && end < promptProjection(parts).length)
        end += 1;
    }
    if (start === end) return;
    event.preventDefault();
    replaceSelection({ start, end });
  };

  return (
    <div className="generation-prompt-editor-shell">
      <div
        ref={editorRef}
        className="generation-prompt-editor"
        role="textbox"
        aria-label={label}
        aria-multiline="true"
        aria-autocomplete="list"
        aria-expanded={Boolean(mention)}
        data-canvas-history-shortcuts={
          canvasHistoryShortcuts ? "true" : undefined
        }
        data-empty={!promptProjection(parts).length}
        data-placeholder={placeholder}
        contentEditable
        suppressContentEditableWarning
        onInput={syncFromDom}
        onKeyDown={handleKeyDown}
        onKeyUp={rememberCaret}
        onMouseUp={(event) => {
          if (!selectAssetElement(event.target)) ensureCaret();
        }}
        onFocus={ensureCaret}
        onBlur={onBlur}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
          syncFromDom();
        }}
        onPaste={(event) => {
          event.preventDefault();
          rememberCaret();
          const selection = editorRef.current
            ? promptSelection(editorRef.current, parts)
            : null;
          const text = event.clipboardData.getData("text/plain");
          if (selection && selection.start !== selection.end)
            replaceSelection(selection, text, { parseReferences: true });
          else insertText(text, { parseReferences: true });
        }}
        onCopy={(event) => {
          const selection = editorRef.current
            ? promptSelection(editorRef.current, parts)
            : null;
          if (!selection || selection.start === selection.end) return;
          event.preventDefault();
          event.clipboardData.setData(
            "text/plain",
            promptSelectedText(parts, selection),
          );
        }}
        onCut={(event) => {
          const selection = editorRef.current
            ? promptSelection(editorRef.current, parts)
            : null;
          if (!selection || selection.start === selection.end) return;
          event.preventDefault();
          event.clipboardData.setData(
            "text/plain",
            promptSelectedText(parts, selection),
          );
          replaceSelection(selection);
        }}
        onClick={(event) => {
          const target =
            event.target instanceof Element
              ? event.target.closest<HTMLButtonElement>(
                  "[data-remove-prompt-asset]",
                )
              : null;
          const key = target?.dataset.removePromptAsset;
          if (key) removeAsset(key);
        }}
      />
      <small>{promptProjection(parts).length}/6000</small>
      {mention ? (
        <div
          className="generation-prompt-mention-menu"
          role="listbox"
          aria-label="引用已选素材"
          style={{ top: mentionTop }}
        >
          {options.length ? (
            options.map((file, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === activeOption}
                key={file.id}
                onMouseDown={(event) => {
                  event.preventDefault();
                  selectAsset(file);
                }}
                onMouseEnter={() => setActiveOption(index)}
              >
                <span className="generation-prompt-option-preview">
                  <GenerationMediaPreview file={file} />
                </span>
                <span>
                  <strong>{promptAssetReferenceName(file)}</strong>
                  <small>
                    {file.media_kind === "image"
                      ? "图片"
                      : file.media_kind === "video"
                        ? "视频"
                        : file.media_kind === "audio"
                          ? "音频"
                          : "文档"}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <span>{assets.length ? "没有匹配素材" : "请先在上方添加素材"}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
