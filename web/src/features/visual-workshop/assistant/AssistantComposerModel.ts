import type { ManagedFile } from "@features/files";
import type {
  VisualAssistantAsset,
  VisualAssistantContentPart,
  VisualAssistantMessage,
} from "@features/visual-workshop/api";
import {
  EMPTY_COMPOSER_TEXT,
  findMentionAtCaret,
  normalizeMentionParts,
} from "@features/visual-workshop/mention-composer/model";

export const MAX_ATTACHMENTS = 5;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".avif",
  ".mp4",
  ".webm",
  ".mov",
  ".mp3",
  ".wav",
  ".m4a",
  ".ogg",
  ".pdf",
  ".txt",
  ".md",
]);
export const ATTACHMENT_ACCEPT = Array.from(SUPPORTED_EXTENSIONS).join(",");

export type SelectedAttachment = Pick<
  VisualAssistantAsset,
  "id" | "display_name" | "mime_type" | "byte_size"
>;

export function isImage(asset: SelectedAttachment) {
  return asset.mime_type.startsWith("image/");
}

export function attachmentTypeLabel(asset: SelectedAttachment) {
  if (asset.mime_type.startsWith("image/")) return "图片";
  if (asset.mime_type.startsWith("video/")) return "视频";
  if (asset.mime_type.startsWith("audio/")) return "音频";
  if (asset.mime_type === "application/pdf") return "PDF";
  if (asset.mime_type === "text/markdown") return "Markdown";
  if (asset.mime_type.startsWith("text/")) return "文本";
  return "文件";
}

export function attachmentSize(byteSize: number) {
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 * 1024) return `${Math.round(byteSize / 1024)} KB`;
  return `${(byteSize / (1024 * 1024)).toFixed(1)} MB`;
}

export function uploadIsSupported(file: globalThis.File) {
  const dot = file.name.lastIndexOf(".");
  return (
    dot >= 0 && SUPPORTED_EXTENSIONS.has(file.name.slice(dot).toLowerCase())
  );
}

export const EMPTY_EDITOR_TEXT = EMPTY_COMPOSER_TEXT;
let composerPartSequence = 0;

export type ComposerTextPart = {
  key: string;
  type: "text";
  text: string;
};
export type ComposerAssetPart = {
  key: string;
  type: "asset";
  asset: SelectedAttachment;
};
export type ComposerPart = ComposerTextPart | ComposerAssetPart;
export type ComposerCaret = { key: string; offset: number };
export type MentionMatch = ComposerCaret & { start: number; query: string };

export type AssistantComposerHandle = {
  insertAssets: (assets: SelectedAttachment[]) => void;
  focus: () => void;
};

export function composerKey(prefix: "text" | "asset") {
  composerPartSequence += 1;
  return `${prefix}-${composerPartSequence}`;
}

export function textPart(text = ""): ComposerTextPart {
  return { key: composerKey("text"), type: "text", text };
}

export function assetPart(asset: SelectedAttachment): ComposerAssetPart {
  return { key: composerKey("asset"), type: "asset", asset };
}

export function normalizeComposerParts(parts: ComposerPart[]): ComposerPart[] {
  return normalizeMentionParts(parts, textPart, { leadingText: true });
}

export function uniqueComposerAttachments(parts: ComposerPart[]) {
  const unique = new Map<string, SelectedAttachment>();
  parts.forEach((part) => {
    if (part.type === "asset" && !unique.has(part.asset.id))
      unique.set(part.asset.id, part.asset);
  });
  return [...unique.values()];
}

export function composerContentParts(
  parts: ComposerPart[],
): VisualAssistantContentPart[] {
  const contentParts: VisualAssistantContentPart[] = [];
  for (const part of parts) {
    if (part.type === "asset")
      contentParts.push({ type: "asset", asset_id: part.asset.id });
    else if (part.text) contentParts.push({ type: "text", text: part.text });
  }
  return contentParts;
}

export function composerText(parts: ComposerPart[]) {
  return parts
    .filter((part): part is ComposerTextPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function caretInComposer(root: HTMLDivElement): ComposerCaret | null {
  const selection = window.getSelection();
  if (!selection?.isCollapsed || !selection.anchorNode) return null;
  const anchor = selection.anchorNode;
  const element = anchor instanceof HTMLElement ? anchor : anchor.parentElement;
  const textElement = element?.closest<HTMLElement>("[data-composer-text]");
  if (textElement && root.contains(textElement)) {
    const range = document.createRange();
    range.selectNodeContents(textElement);
    try {
      range.setEnd(anchor, selection.anchorOffset);
    } catch {
      return null;
    }
    return {
      key: textElement.dataset.partKey || "",
      offset: range.toString().replaceAll(EMPTY_EDITOR_TEXT, "").length,
    };
  }
  return null;
}

export function mentionAtCaret(
  parts: ComposerPart[],
  caret: ComposerCaret | null,
) {
  return findMentionAtCaret(parts, caret);
}

export function partsFromMessage(
  message: VisualAssistantMessage,
): ComposerPart[] {
  const assets = new Map(
    (message.assets ?? []).map((asset) => [asset.id, asset]),
  );
  if (message.content_parts?.length) {
    const parts: ComposerPart[] = [];
    for (const part of message.content_parts) {
      if (part.type === "text") parts.push(textPart(part.text));
      else {
        const asset = assets.get(part.asset_id);
        if (asset) parts.push(assetPart(asset));
      }
    }
    return normalizeComposerParts(parts);
  }
  const legacy: ComposerPart[] = [textPart(message.content)];
  for (const asset of message.assets ?? []) legacy.push(assetPart(asset));
  return normalizeComposerParts(legacy);
}

export function toSelected(file: ManagedFile): SelectedAttachment {
  return {
    id: file.id,
    display_name: file.display_name,
    mime_type: file.mime_type,
    byte_size: file.byte_size,
  };
}
