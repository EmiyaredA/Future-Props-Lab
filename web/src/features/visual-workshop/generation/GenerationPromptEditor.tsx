import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ManagedFile } from "@features/files";
import {
  EMPTY_COMPOSER_TEXT,
  findMentionAtCaret,
  mentionPartLength,
  mentionProjection,
  normalizeMentionParts,
} from "@features/visual-workshop/mention-composer/model";
import { GenerationMediaPreview } from "@features/visual-workshop/generation/GenerationMediaPreview";

const EMPTY_PROMPT_TEXT = EMPTY_COMPOSER_TEXT;
let promptPartSequence = 0;

type PromptTextPart = { key: string; type: "text"; text: string };
type PromptAssetPart = { key: string; type: "asset"; file: ManagedFile };
type PromptPart = PromptTextPart | PromptAssetPart;
type PromptCaret = { key: string; offset: number };
type PromptMention = PromptCaret & { start: number; query: string };
type PromptSelection = { start: number; end: number };

function promptKey(prefix: "text" | "asset") {
  promptPartSequence += 1;
  return `${prefix}-${promptPartSequence}`;
}

function promptTextPart(text = ""): PromptTextPart {
  return { key: promptKey("text"), type: "text", text };
}

function promptAssetPart(file: ManagedFile): PromptAssetPart {
  return { key: promptKey("asset"), type: "asset", file };
}

function promptAssetExtension(file: ManagedFile) {
  const match = /(\.[^./\\]+)$/.exec(file.original_filename);
  return match?.[1] ?? "";
}

function promptAssetBaseName(file: ManagedFile) {
  const extension = promptAssetExtension(file);
  const trimmed = file.display_name.trim();
  if (!extension || trimmed.length <= extension.length) return trimmed;
  return trimmed
    .toLocaleLowerCase("zh-CN")
    .endsWith(extension.toLocaleLowerCase("zh-CN"))
    ? trimmed.slice(0, -extension.length).trim()
    : trimmed;
}

function promptAssetReferenceName(file: ManagedFile) {
  const baseName = promptAssetBaseName(file);
  const fallback = file.original_filename.slice(
    0,
    Math.max(
      0,
      file.original_filename.length - promptAssetExtension(file).length,
    ),
  );
  return `${baseName || fallback || file.display_name}${promptAssetExtension(file)}`;
}

function promptAssetNameMap(assets: ManagedFile[]) {
  const filesByName = new Map<string, ManagedFile>();
  for (const file of assets) {
    for (const name of [
      file.display_name,
      file.original_filename,
      promptAssetBaseName(file),
      promptAssetReferenceName(file),
    ]) {
      if (name && !filesByName.has(name)) filesByName.set(name, file);
    }
  }
  return filesByName;
}

function promptPartsFromValue(value: string, assets: ManagedFile[]) {
  if (!value.includes("[") && !value.includes("@"))
    return [promptTextPart(value)];
  const filesByName = promptAssetNameMap(assets);
  const parts: PromptPart[] = [];
  let cursor = 0;
  let searchOffset = 0;
  while (searchOffset < value.length) {
    const nextBracket = value.indexOf("[", searchOffset);
    const nextLegacy = value.indexOf("@", searchOffset);
    const candidates = [nextBracket, nextLegacy].filter((index) => index >= 0);
    if (!candidates.length) break;
    const marker = Math.min(...candidates);
    const rest = value.slice(marker);
    const bracketed = rest.match(/^\[([^\]\r\n]+)\]/u);
    const legacyBracketed = rest.match(/^@\[([^\]\r\n]+)\]/u);
    const legacyBare = rest.match(
      /^@([^\s@\][()（）【】,，。;；:：!！?？]+)(?=$|[\s,，。;；:：!！?？)）\]】])/u,
    );
    const match = bracketed ?? legacyBracketed ?? legacyBare;
    const name = match?.[1];
    const length = match ? match[0].length : 0;
    const file = name ? filesByName.get(name) : undefined;
    if (!file || !length) {
      searchOffset = marker + 1;
      continue;
    }
    if (marker > cursor)
      parts.push(promptTextPart(value.slice(cursor, marker)));
    parts.push(promptAssetPart(file));
    cursor = marker + length;
    searchOffset = cursor;
  }
  if (cursor < value.length) parts.push(promptTextPart(value.slice(cursor)));
  return normalizePromptParts(parts.length ? parts : [promptTextPart(value)]);
}

function resolvePromptReferences(parts: PromptPart[], assets: ManagedFile[]) {
  return normalizePromptParts(
    parts.flatMap((part) =>
      part.type === "text" ? promptPartsFromValue(part.text, assets) : [part],
    ),
  );
}

function normalizePromptParts(parts: PromptPart[]): PromptPart[] {
  return normalizeMentionParts(parts, promptTextPart);
}

function promptProjection(parts: PromptPart[]) {
  return mentionProjection(
    parts,
    (part) => `[${promptAssetReferenceName(part.file)}]`,
  );
}

function promptPartLength(part: PromptPart) {
  return mentionPartLength(
    part,
    (token) => `[${promptAssetReferenceName(token.file)}]`,
  );
}

function promptSelectedText(parts: PromptPart[], selection: PromptSelection) {
  const chunks: string[] = [];
  let offset = 0;
  for (const part of parts) {
    const length = promptPartLength(part);
    const partEnd = offset + length;
    if (partEnd > selection.start && offset < selection.end) {
      if (part.type === "asset") {
        chunks.push(`[${promptAssetReferenceName(part.file)}]`);
      } else {
        chunks.push(
          part.text.slice(
            Math.max(0, selection.start - offset),
            Math.min(length, selection.end - offset),
          ),
        );
      }
    }
    offset = partEnd;
  }
  return chunks.join("");
}

function promptBoundaryOffset(
  root: HTMLDivElement,
  parts: PromptPart[],
  node: Node,
  offset: number,
) {
  if (node === root) {
    let total = 0;
    for (let index = 0; index < offset; index += 1) {
      const child = root.childNodes[index];
      const element = child instanceof HTMLElement ? child : undefined;
      const part = parts.find(
        (candidate) => candidate.key === element?.dataset.partKey,
      );
      if (part) total += promptPartLength(part);
    }
    return total;
  }
  const element = node instanceof HTMLElement ? node : node.parentElement;
  const partElement = element?.closest<HTMLElement>("[data-part-key]");
  if (!partElement || !root.contains(partElement)) return null;
  const index = parts.findIndex(
    (part) => part.key === partElement.dataset.partKey,
  );
  if (index < 0) return null;
  const before = parts
    .slice(0, index)
    .reduce((total, part) => total + promptPartLength(part), 0);
  const part = parts[index];
  if (part.type === "asset")
    return before + (offset > 0 ? promptPartLength(part) : 0);
  const range = document.createRange();
  range.selectNodeContents(partElement);
  try {
    range.setEnd(node, offset);
  } catch {
    return null;
  }
  return before + range.toString().replaceAll(EMPTY_PROMPT_TEXT, "").length;
}

function promptSelection(
  root: HTMLDivElement,
  parts: PromptPart[],
): PromptSelection | null {
  const selection = window.getSelection();
  if (!selection?.anchorNode || !selection.focusNode) return null;
  const anchor = promptBoundaryOffset(
    root,
    parts,
    selection.anchorNode,
    selection.anchorOffset,
  );
  const focus = promptBoundaryOffset(
    root,
    parts,
    selection.focusNode,
    selection.focusOffset,
  );
  if (anchor === null || focus === null) return null;
  return { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
}

function promptCaretAtOffset(parts: PromptPart[], target: number) {
  let offset = 0;
  let previousText: PromptTextPart | undefined;
  for (const part of parts) {
    const length = promptPartLength(part);
    if (part.type === "text") {
      if (target <= offset + length)
        return { key: part.key, offset: Math.max(0, target - offset) };
      previousText = part;
    } else if (target < offset + length && previousText) {
      return { key: previousText.key, offset: previousText.text.length };
    }
    offset += length;
  }
  return previousText
    ? { key: previousText.key, offset: previousText.text.length }
    : undefined;
}

function renderPromptParts(root: HTMLDivElement, parts: PromptPart[]) {
  const fragment = document.createDocumentFragment();
  for (const part of parts) {
    if (part.type === "text") {
      const span = document.createElement("span");
      span.dataset.promptText = "";
      span.dataset.partKey = part.key;
      span.append(document.createTextNode(part.text));
      fragment.append(span);
      continue;
    }
    const asset = document.createElement("span");
    asset.className = "generation-prompt-asset";
    asset.contentEditable = "false";
    asset.dataset.assetId = part.file.id;
    asset.dataset.partKey = part.key;
    asset.title = promptAssetReferenceName(part.file);

    const preview = document.createElement("span");
    preview.className = "generation-prompt-asset-preview";
    preview.setAttribute("aria-hidden", "true");
    preview.dataset.kindLabel =
      part.file.media_kind === "image"
        ? "图"
        : part.file.media_kind === "video"
          ? "视"
          : part.file.media_kind === "audio"
            ? "音"
            : "文";
    const name = document.createElement("span");
    name.textContent = promptAssetReferenceName(part.file);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.removePromptAsset = part.key;
    remove.setAttribute(
      "aria-label",
      `移除引用 ${promptAssetReferenceName(part.file)}`,
    );
    asset.append(preview, name, remove);
    fragment.append(asset);
  }
  root.replaceChildren(fragment);
}

function promptCaret(root: HTMLDivElement): PromptCaret | null {
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode) return null;
  const anchor = selection.anchorNode;
  const element = anchor instanceof HTMLElement ? anchor : anchor.parentElement;
  const textElement = element?.closest<HTMLElement>("[data-prompt-text]");
  if (!textElement || !root.contains(textElement)) return null;
  const range = document.createRange();
  range.selectNodeContents(textElement);
  try {
    range.setEnd(anchor, selection.anchorOffset);
  } catch {
    return null;
  }
  return {
    key: textElement.dataset.partKey || "",
    offset: range.toString().replaceAll(EMPTY_PROMPT_TEXT, "").length,
  };
}

function promptMentionAtCaret(
  parts: PromptPart[],
  caret: PromptCaret | null,
): PromptMention | null {
  return findMentionAtCaret(parts, caret);
}

export function GenerationPromptEditor({
  value,
  assets,
  label,
  placeholder,
  onChange,
  onBlur,
}: {
  value: string;
  assets: ManagedFile[];
  label: string;
  placeholder: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
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
    if (projected === nextProjected) {
      if (value !== nextProjected) onChange(nextProjected);
      return;
    }
    if (document.activeElement === editorRef.current) return;
    pendingDomSync.current = true;
    setParts(nextParts);
    if (value !== nextProjected) onChange(nextProjected);
  }, [assets, onChange, parts, value]);

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
