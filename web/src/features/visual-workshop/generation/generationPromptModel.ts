import type { ManagedFile } from "@features/files";
import {
  EMPTY_COMPOSER_TEXT,
  findMentionAtCaret,
  mentionPartLength,
  mentionProjection,
  normalizeMentionParts,
} from "@features/visual-workshop/mention-composer/model";

export const EMPTY_PROMPT_TEXT = EMPTY_COMPOSER_TEXT;
let promptPartSequence = 0;

export type PromptTextPart = { key: string; type: "text"; text: string };
export type PromptAssetPart = { key: string; type: "asset"; file: ManagedFile };
export type PromptPart = PromptTextPart | PromptAssetPart;
export type PromptCaret = { key: string; offset: number };
export type PromptMention = PromptCaret & { start: number; query: string };
export type PromptSelection = { start: number; end: number };

export function promptKey(prefix: "text" | "asset") {
  promptPartSequence += 1;
  return `${prefix}-${promptPartSequence}`;
}

export function promptTextPart(text = ""): PromptTextPart {
  return { key: promptKey("text"), type: "text", text };
}

export function promptAssetPart(file: ManagedFile): PromptAssetPart {
  return { key: promptKey("asset"), type: "asset", file };
}

export function promptAssetExtension(file: ManagedFile) {
  const match = /(\.[^./\\]+)$/.exec(file.original_filename);
  return match?.[1] ?? "";
}

export function promptAssetBaseName(file: ManagedFile) {
  const extension = promptAssetExtension(file);
  const trimmed = file.display_name.trim();
  if (!extension || trimmed.length <= extension.length) return trimmed;
  return trimmed
    .toLocaleLowerCase("zh-CN")
    .endsWith(extension.toLocaleLowerCase("zh-CN"))
    ? trimmed.slice(0, -extension.length).trim()
    : trimmed;
}

export function promptAssetReferenceName(file: ManagedFile) {
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

export function promptAssetNameMap(assets: ManagedFile[]) {
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

export function promptPartsFromValue(value: string, assets: ManagedFile[]) {
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

export function resolvePromptReferences(
  parts: PromptPart[],
  assets: ManagedFile[],
) {
  return normalizePromptParts(
    parts.flatMap((part) =>
      part.type === "text" ? promptPartsFromValue(part.text, assets) : [part],
    ),
  );
}

export function normalizePromptParts(parts: PromptPart[]): PromptPart[] {
  return normalizeMentionParts(parts, promptTextPart);
}

export function promptProjection(parts: PromptPart[]) {
  return mentionProjection(
    parts,
    (part) => `[${promptAssetReferenceName(part.file)}]`,
  );
}

export function promptPartLength(part: PromptPart) {
  return mentionPartLength(
    part,
    (token) => `[${promptAssetReferenceName(token.file)}]`,
  );
}

export function promptSelectedText(
  parts: PromptPart[],
  selection: PromptSelection,
) {
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

export function promptBoundaryOffset(
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

export function promptSelection(
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

export function promptCaretAtOffset(parts: PromptPart[], target: number) {
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

export function renderPromptParts(root: HTMLDivElement, parts: PromptPart[]) {
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

export function promptCaret(root: HTMLDivElement): PromptCaret | null {
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

export function promptMentionAtCaret(
  parts: PromptPart[],
  caret: PromptCaret | null,
): PromptMention | null {
  return findMentionAtCaret(parts, caret);
}
