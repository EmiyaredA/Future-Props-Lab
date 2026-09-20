import type { Editor, JSONContent } from "@tiptap/react";
import {
  DOMParser as ProseMirrorDOMParser,
  DOMSerializer,
  type Fragment,
} from "@tiptap/pm/model";
import { fetchApiBlob } from "@platform/api/client";
import { uploadImage } from "./api";

export const THOUGHT_CLIPBOARD_MIME =
  "application/vnd.future-props-lab.thought+json";
/** Chromium/Electron ClipboardItem key; paste events cannot read this via getData. */
export const THOUGHT_CLIPBOARD_WEB_MIME = `web ${THOUGHT_CLIPBOARD_MIME}`;
export const THOUGHT_CLIPBOARD_VERSION = 1;
export const THOUGHT_CLIPBOARD_MAX_BYTES = 128 * 1024 * 1024;

export class ThoughtClipboardFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThoughtClipboardFormatError";
  }
}

type ClipboardAsset = {
  mimeType: string;
  data: string;
  filename: string;
};

export type ThoughtClipboardPayload = {
  version: 1;
  sourceScopeId: string | null;
  fragment: { type: "doc"; content: JSONContent[] };
  assets: Record<string, ClipboardAsset>;
};

type ClipboardSelection = {
  fragment: Fragment;
  html: string;
  text: string;
  imageIds: string[];
};

let sessionPayload: ThoughtClipboardPayload | null = null;

export function peekSessionThoughtClipboard() {
  return sessionPayload;
}

export function clearSessionThoughtClipboard() {
  sessionPayload = null;
}

function rememberSessionPayload(payload: ThoughtClipboardPayload) {
  sessionPayload = payload;
}

function uniqueImageIds(content: JSONContent[], result = new Set<string>()) {
  if (!Array.isArray(content)) return [...result];
  for (const node of content) {
    if (node.type === "image" && typeof node.attrs?.assetId === "string")
      result.add(node.attrs.assetId);
    if (node.content) uniqueImageIds(node.content, result);
  }
  return [...result];
}

function selectionContent(editor: Editor): ClipboardSelection {
  const fragment = editor.state.selection.content().content;
  const wrapper = document.createElement("div");
  wrapper.appendChild(
    DOMSerializer.fromSchema(editor.schema).serializeFragment(fragment),
  );
  const content = (fragment.toJSON() as JSONContent[] | JSONContent) ?? [];
  return {
    fragment,
    html: wrapper.innerHTML,
    text: fragment.textBetween(0, fragment.size, "\n\n"),
    imageIds: uniqueImageIds(Array.isArray(content) ? content : [content]),
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize)
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

const IMAGE_MIME_EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
};

function extensionForImageMime(mimeType: string) {
  return IMAGE_MIME_EXTENSIONS[mimeType.toLowerCase()] ?? null;
}

function sniffImageMime(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "image/png";
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "image/jpeg";
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46
  )
    return "image/gif";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return "image/webp";
  return null;
}

function resolveImageMime(bytes: Uint8Array, declaredType?: string) {
  const declared = (declaredType || "").toLowerCase().trim();
  if (declared && declared !== "application/octet-stream") {
    if (extensionForImageMime(declared)) return declared;
  }
  return sniffImageMime(bytes) || "image/png";
}

/** Backend upload validates by filename extension; alt text alone is rejected. */
function uploadableImageFile(
  bytes: Uint8Array,
  filename: string,
  declaredType?: string,
) {
  const mimeType = resolveImageMime(bytes, declaredType);
  const extension = extensionForImageMime(mimeType) || ".png";
  const base =
    (filename || "粘贴图片").replace(/\.[^.]+$/u, "").trim() || "粘贴图片";
  return new File([bytes], `${base}${extension}`, { type: mimeType });
}

function fileFromDataUrl(value: string, filename: string) {
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  return uploadableImageFile(base64ToBytes(match[2]), filename, match[1]);
}

function hasInlineImageData(image: Element) {
  return /^data:[^;,]+;base64,/i.test(image.getAttribute("src") || "");
}

function imageSourceScope(image: Element) {
  const figure = image.closest("figure[data-thought-image]");
  return (
    image.getAttribute("data-fpl-source-scope") ??
    figure?.getAttribute("data-fpl-source-scope")
  );
}

function inThoughtFigure(image: Element) {
  return Boolean(image.closest("figure[data-thought-image]"));
}

function scopeDiffers(image: Element, targetScopeId?: string) {
  return imageSourceScope(image) !== (targetScopeId ?? "");
}

function isMigratableInlineImage(
  image: Element,
  targetScopeId?: string,
  preserveMigratableImages = false,
) {
  if (!preserveMigratableImages || !hasInlineImageData(image)) return false;
  const assetId = image.getAttribute("data-asset-id");
  if (assetId) return scopeDiffers(image, targetScopeId);
  return inThoughtFigure(image);
}

function dataUrl(mimeType: string, data: string) {
  return `data:${mimeType || "application/octet-stream"};base64,${data}`;
}

function assetFilename(node: JSONContent[], assetId: string) {
  let filename = "粘贴图片";
  const visit = (items: JSONContent[]) => {
    for (const item of items) {
      if (
        item.type === "image" &&
        item.attrs?.assetId === assetId &&
        typeof item.attrs.alt === "string" &&
        item.attrs.alt.trim()
      )
        filename = item.attrs.alt.trim();
      if (item.content) visit(item.content);
    }
  };
  visit(node);
  return filename;
}

async function serializeSelection(
  editor: Editor,
  sourceScopeId?: string,
): Promise<ThoughtClipboardPayload> {
  const selected = selectionContent(editor);
  const raw = selected.fragment.toJSON() as JSONContent[] | JSONContent;
  const content = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const assets: Record<string, ClipboardAsset> = {};
  let totalBytes = 0;
  for (const assetId of selected.imageIds) {
    const blob = await fetchApiBlob(
      `/v1/files/${encodeURIComponent(assetId)}/content`,
    );
    totalBytes += blob.size;
    if (totalBytes > THOUGHT_CLIPBOARD_MAX_BYTES)
      throw new Error(
        "所选图片过大，无法复制。请使用 Markdown 或完整备份导出。",
      );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mimeType = resolveImageMime(bytes, blob.type);
    const file = uploadableImageFile(
      bytes,
      assetFilename(content, assetId),
      mimeType,
    );
    assets[assetId] = {
      mimeType: file.type,
      data: bytesToBase64(bytes),
      filename: file.name,
    };
  }
  return {
    version: THOUGHT_CLIPBOARD_VERSION,
    sourceScopeId: sourceScopeId ?? null,
    fragment: { type: "doc", content },
    assets,
  };
}

function htmlWithInlineAssets(html: string, payload: ThoughtClipboardPayload) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("img[data-asset-id]").forEach((image) => {
    const assetId = image.getAttribute("data-asset-id");
    const asset = assetId ? payload.assets[assetId] : undefined;
    if (!asset) return;
    image.setAttribute("src", dataUrl(asset.mimeType, asset.data));
    image.setAttribute("data-fpl-source-scope", payload.sourceScopeId || "");
    const figure = image.closest("figure[data-thought-image]");
    if (figure)
      figure.setAttribute("data-fpl-source-scope", payload.sourceScopeId || "");
  });
  return parsed.body.innerHTML;
}

function clipboardJson(payload: ThoughtClipboardPayload) {
  return JSON.stringify(payload);
}

function isThoughtClipboardType(type: string) {
  return (
    type === THOUGHT_CLIPBOARD_WEB_MIME ||
    type === THOUGHT_CLIPBOARD_MIME ||
    (type.startsWith("web ") && type.slice(4) === THOUGHT_CLIPBOARD_MIME)
  );
}

function payloadBlob(payload: ThoughtClipboardPayload) {
  return new Blob([clipboardJson(payload)], { type: THOUGHT_CLIPBOARD_MIME });
}

async function writeClipboardItem(
  data: Record<string, Blob | Promise<Blob>>,
) {
  await navigator.clipboard.write([new ClipboardItem(data)]);
}

export async function writeThoughtClipboard(
  editor: Editor,
  sourceScopeId?: string,
) {
  const selected = selectionContent(editor);
  const canWriteRich =
    typeof navigator.clipboard?.write === "function" &&
    typeof globalThis.ClipboardItem === "function";
  if (canWriteRich) {
    const payloadPromise = serializeSelection(editor, sourceScopeId).then(
      (payload) => {
        rememberSessionPayload(payload);
        return payload;
      },
    );
    const hasImages = selected.imageIds.length > 0;
    const payload = hasImages ? undefined : await payloadPromise;
    if (payload) rememberSessionPayload(payload);
    const html = payload
      ? htmlWithInlineAssets(selected.html, payload)
      : selected.html;
    const plain = new Blob([selected.text], { type: "text/plain" });
    const customPayload = payload
      ? payloadBlob(payload)
      : payloadPromise.then(payloadBlob);
    const htmlBlob = payload
      ? new Blob([html], { type: "text/html" })
      : payloadPromise.then(
          (value) =>
            new Blob([htmlWithInlineAssets(selected.html, value)], {
              type: "text/html",
            }),
        );
    try {
      await writeClipboardItem({
        "text/html": htmlBlob,
        "text/plain": plain,
        [THOUGHT_CLIPBOARD_WEB_MIME]: customPayload,
      });
      return;
    } catch {
      const fallbackPayload = await payloadPromise;
      rememberSessionPayload(fallbackPayload);
      try {
        await writeClipboardItem({
          "text/html": new Blob(
            [htmlWithInlineAssets(selected.html, fallbackPayload)],
            { type: "text/html" },
          ),
          "text/plain": plain,
        });
        return;
      } catch {
        // Fall through to plain-text paths below.
      }
    }
  }
  if (selected.imageIds.length) {
    try {
      const payload = await serializeSelection(editor, sourceScopeId);
      rememberSessionPayload(payload);
    } catch {
      // Prefer the original browser-support error when serialization also fails.
    }
    throw new Error(
      "当前浏览器不支持带图片复制，请使用 Markdown 或完整备份导出。",
    );
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(selected.text);
    return;
  }
  if (legacyCopy(selected.text)) return;
  throw new Error("当前浏览器不允许访问剪贴板");
}

function removeManagedImage(image: Element) {
  const figure = image.closest("figure[data-thought-image]");
  (figure ?? image).remove();
}

export function sanitizeThoughtPastedHTML(
  html: string,
  targetScopeId?: string,
  options: { preserveMigratableImages?: boolean } = {},
) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed
    .querySelectorAll("script,iframe,object,embed,style")
    .forEach((node) => node.remove());
  parsed.querySelectorAll("img").forEach((image) => {
    const assetId = image.getAttribute("data-asset-id");
    const sourceScope = imageSourceScope(image);
    const migratable = isMigratableInlineImage(
      image,
      targetScopeId,
      options.preserveMigratableImages,
    );
    if (
      !assetId &&
      !(
        options.preserveMigratableImages &&
        inThoughtFigure(image) &&
        hasInlineImageData(image)
      )
    ) {
      removeManagedImage(image);
      return;
    }
    if (
      sourceScope &&
      sourceScope !== (targetScopeId ?? "") &&
      !migratable
    ) {
      removeManagedImage(image);
      return;
    }
    if (!migratable) image.removeAttribute("src");
  });
  parsed.querySelectorAll("*").forEach((node) =>
    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const allowedImageAttrs = new Set([
        "data-asset-id",
        "data-caption",
        "data-fpl-source-scope",
        "alt",
        "title",
        "width",
        "height",
        ...(options.preserveMigratableImages ? ["src"] : []),
      ]);
      const allowedFigureAttrs = new Set([
        "data-thought-image",
        "data-fpl-source-scope",
        "data-align",
        "data-crop-left",
        "data-crop-top",
        "data-crop-width",
        "data-crop-height",
      ]);
      const allowed =
        (node.tagName === "IMG" && allowedImageAttrs.has(name)) ||
        (node.matches("figure[data-thought-image]") &&
          allowedFigureAttrs.has(name));
      if (name.startsWith("on") || (name.startsWith("data-") && !allowed))
        node.removeAttribute(attribute.name);
    }),
  );
  parsed.querySelectorAll("figure[data-thought-image]").forEach((figure) => {
    const image = figure.querySelector("img");
    const keepInline =
      options.preserveMigratableImages &&
      image &&
      hasInlineImageData(image) &&
      !image.getAttribute("data-asset-id");
    if (!figure.querySelector("img[data-asset-id]") && !keepInline)
      figure.remove();
  });
  return parsed.body.innerHTML;
}

export function htmlNeedsManagedMigration(
  html: string,
  targetScopeId?: string,
) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return [...parsed.querySelectorAll("img")].some((image) => {
    const assetId = image.getAttribute("data-asset-id");
    if (assetId) return scopeDiffers(image, targetScopeId);
    return inThoughtFigure(image) && hasInlineImageData(image);
  });
}

function hasUnrecoverableManagedImage(html: string, targetScopeId?: string) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  return [...parsed.querySelectorAll("img")].some((image) => {
    const assetId = image.getAttribute("data-asset-id");
    if (assetId)
      return scopeDiffers(image, targetScopeId) && !hasInlineImageData(image);
    return inThoughtFigure(image) && !hasInlineImageData(image);
  });
}

function isPayload(value: unknown): value is ThoughtClipboardPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<ThoughtClipboardPayload>;
  return (
    payload.version === THOUGHT_CLIPBOARD_VERSION &&
    !!payload.fragment &&
    payload.fragment.type === "doc" &&
    Array.isArray(payload.fragment.content) &&
    !!payload.assets &&
    typeof payload.assets === "object"
  );
}

function parsePayloadText(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ThoughtClipboardFormatError(
      "剪贴板数据损坏，请重新复制或使用导出导入。",
    );
  }
  if (!isPayload(parsed))
    throw new ThoughtClipboardFormatError(
      "剪贴板格式不受支持，请重新复制或使用导出导入。",
    );
  return parsed;
}

function rewriteAssetIds(
  content: JSONContent[],
  replacements: Record<string, string>,
): JSONContent[] {
  return content.map((node) => ({
    ...node,
    attrs:
      node.type === "image" && typeof node.attrs?.assetId === "string"
        ? {
            ...node.attrs,
            assetId: replacements[node.attrs.assetId] ?? node.attrs.assetId,
          }
        : node.attrs,
    content: node.content
      ? rewriteAssetIds(node.content, replacements)
      : node.content,
  }));
}

function validateImageAssets(
  content: JSONContent[],
  assets: Record<string, ClipboardAsset>,
) {
  let totalBytes = 0;
  for (const assetId of uniqueImageIds(content)) {
    const asset = assets[assetId];
    if (
      !asset ||
      typeof asset.data !== "string" ||
      typeof asset.mimeType !== "string"
    )
      throw new Error("剪贴板中的图片数据无效，请重新复制或使用导出导入。");
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(asset.data);
    } catch {
      throw new Error("剪贴板中的图片数据无效，请重新复制或使用导出导入。");
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > THOUGHT_CLIPBOARD_MAX_BYTES)
      throw new Error("剪贴板中的图片过大，请重新复制或使用导出导入。");
  }
}

export async function readThoughtClipboardPayload() {
  if (typeof navigator.clipboard?.read !== "function") return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      for (const type of item.types) {
        if (!isThoughtClipboardType(type)) continue;
        const blob = await item.getType(type);
        return parsePayloadText(await blob.text());
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function insertThoughtClipboardPayload(
  editor: Editor,
  payload: ThoughtClipboardPayload,
  targetScopeId?: string,
) {
  const content = payload.fragment.content;
  validateImageAssets(content, payload.assets);
  try {
    editor.schema.nodeFromJSON(payload.fragment);
  } catch {
    throw new ThoughtClipboardFormatError(
      "剪贴板内容与当前编辑器不兼容，请使用导出导入。",
    );
  }
  const replacements: Record<string, string> = {};
  const shouldMigrate = payload.sourceScopeId !== (targetScopeId ?? null);
  if (shouldMigrate) {
    for (const assetId of uniqueImageIds(content)) {
      const asset = payload.assets[assetId];
      const file = uploadableImageFile(
        base64ToBytes(asset.data),
        asset.filename || "粘贴图片",
        asset.mimeType,
      );
      replacements[assetId] = (await uploadImage(file)).asset_id;
    }
  }
  const rewritten = rewriteAssetIds(content, replacements);
  const { from, to } = editor.state.selection;
  editor.commands.insertContentAt({ from, to }, rewritten, {
    updateSelection: true,
  });
  return true;
}

export async function pasteThoughtClipboard(
  editor: Editor,
  clipboardData: DataTransfer | null | undefined,
  targetScopeId?: string,
) {
  const raw = clipboardData?.getData(THOUGHT_CLIPBOARD_MIME) || "";
  if (!raw) return false;
  await insertThoughtClipboardPayload(
    editor,
    parsePayloadText(raw),
    targetScopeId,
  );
  return true;
}

export async function pasteThoughtHTML(
  editor: Editor,
  html: string,
  targetScopeId?: string,
) {
  if (hasUnrecoverableManagedImage(html, targetScopeId))
    throw new Error("剪贴板中的图片缺少可迁移数据，请重新复制或使用导出导入。");
  const safeHtml = sanitizeThoughtPastedHTML(html, targetScopeId, {
    preserveMigratableImages: true,
  });
  const parsed = new DOMParser().parseFromString(safeHtml, "text/html");
  try {
    ProseMirrorDOMParser.fromSchema(editor.schema).parseSlice(parsed.body);
  } catch {
    throw new Error("剪贴板内容与当前编辑器不兼容，请使用导出导入。");
  }
  const replacements = new Map<string, string>();
  let anonymousIndex = 0;
  for (const image of parsed.querySelectorAll("img")) {
    const assetId = image.getAttribute("data-asset-id");
    const sourceScope = imageSourceScope(image);
    const needsUpload =
      hasInlineImageData(image) &&
      ((assetId && sourceScope !== (targetScopeId ?? "")) ||
        (!assetId && inThoughtFigure(image)));
    if (!needsUpload) continue;
    const dedupeKey =
      assetId || image.getAttribute("src") || `anonymous-${anonymousIndex++}`;
    const existing = replacements.get(dedupeKey);
    if (existing) {
      image.setAttribute("data-asset-id", existing);
    } else {
      const file = fileFromDataUrl(
        image.getAttribute("src") || "",
        image.getAttribute("alt") || "粘贴图片",
      );
      if (!file)
        throw new Error("剪贴板中的图片数据无效，请重新复制或使用导出导入。");
      const uploaded = await uploadImage(file);
      replacements.set(dedupeKey, uploaded.asset_id);
      image.setAttribute("data-asset-id", uploaded.asset_id);
    }
    image.removeAttribute("src");
    image.removeAttribute("data-fpl-source-scope");
  }
  parsed.querySelectorAll("img[data-asset-id]").forEach((image) => {
    image.removeAttribute("src");
    image.removeAttribute("data-fpl-source-scope");
  });
  parsed.querySelectorAll("figure[data-thought-image]").forEach((figure) => {
    figure.removeAttribute("data-fpl-source-scope");
  });
  const slice = ProseMirrorDOMParser.fromSchema(editor.schema).parseSlice(
    parsed.body,
  );
  const { from, to } = editor.state.selection;
  editor.commands.insertContentAt({ from, to }, slice.content.toJSON(), {
    updateSelection: true,
  });
  return true;
}

function legacyCopy(text: string) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}
