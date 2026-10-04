import {
  canvasAssetIds,
  mapCanvasAssets,
  parseCanvasScene,
} from "./diagrams/model";
import { canvasSvgText } from "./diagrams/export";
import {
  attachments,
  attachmentMimes,
  isBackup,
  attachmentArchivePath,
  encodedFilePath,
} from "./archiveFiles";
import { download } from "./download";
import type { Editor, JSONContent } from "@tiptap/core";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { fetchApiBlob } from "@platform/api/client";
import { importArchive, type Note, type KnowledgeBase } from "./api";
import { parseMarkdown, toMarkdown } from "./markdown";
import {
  navigationHtml,
  navigationMarkdown,
  navigationExportCss,
  type NavigationAccess,
} from "./document-layout/navigationExport";
import type { DirectoryEntry } from "./document-layout/model";
import { renderDiagram } from "./diagram";
import { staticTableContent } from "./multitable/staticContent";
import { generateHTML } from "@tiptap/core";
import { editorExtensions } from "./editorExtensions";

const safeName = (title: string) =>
  title
    .replace(/[\\/:*?"<>|]/g, "_")
    .split("")
    .map((c) => (c.charCodeAt(0) < 32 ? "_" : c))
    .join("")
    .slice(0, 100) || "笔记";
function images(doc: JSONContent): string[] {
  return [
    ...new Set([
      ...(doc.type === "image" ? [String(doc.attrs?.assetId)] : []),
      ...(doc.type === "canvas"
        ? canvasAssetIds(parseCanvasScene(doc.attrs?.scene))
        : []),
      ...(doc.content || []).flatMap(images),
    ]),
  ];
}
export async function exportMarkdown(
  note: Note,
  assetUrl?: (id: string) => string,
  navigation?: NavigationAccess,
) {
  const files: Record<string, Uint8Array> = {};
  const paths: Record<string, string> = {};
  for (const id of images(note.document)) {
    const blob = await fetchApiBlob(
      assetUrl?.(id) ?? `/v1/files/${encodeURIComponent(id)}/content`,
    );
    const suffix = blob.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const path = `assets/${id}.${suffix}`;
    paths[id] = path;
    files[path] = new Uint8Array(await blob.arrayBuffer());
  }
  for (const node of attachments(note.document)) {
    const id = String(node.attrs?.assetId);
    if (paths[id]) continue;
    const path = attachmentArchivePath(
      id,
      String(node.attrs?.filename || "附件"),
    );
    paths[id] = path;
    files[path] = new Uint8Array(
      await (
        await fetchApiBlob(
          assetUrl?.(id) ?? `/v1/files/${encodeURIComponent(id)}/download`,
        )
      ).arrayBuffer(),
    );
  }
  const resolved = await navigationMarkdown(
    await staticTableContent(note, navigation),
    note.knowledge_base_id,
    navigation,
  );
  const content = `# ${note.title}\n\n${toMarkdown(resolved, paths)}`;
  if (!Object.keys(files).length) {
    download(
      new Blob([content], { type: "text/markdown;charset=utf-8" }),
      `${safeName(note.title)}.md`,
    );
    return;
  }
  files[`${safeName(note.title)}.md`] = strToU8(content);
  download(
    new Blob([zipSync(files) as BlobPart], { type: "application/zip" }),
    `${safeName(note.title)}-markdown.zip`,
  );
}

function relativePath(base: string, source: string): string | null {
  if (/^(?:[a-z]+:|\/|\\)/i.test(source)) return null;
  const parts = base.split("/").slice(0, -1);
  let decoded: string;
  try {
    decoded = decodeURIComponent(source);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.startsWith("/")) return null;
  for (const part of decoded.split("/")) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}
export async function importFile(file: File, project?: KnowledgeBase) {
  if (file.name.toLowerCase().endsWith(".zip") && (await isBackup(file)))
    return { ...(await importArchive(file)), open_note_id: null };
  if (file.size > 128 * 1024 * 1024)
    throw new Error("Markdown 内容包不能超过 128 MiB；完整备份由服务端校验");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let files: Record<string, Uint8Array>;
  if (file.name.toLowerCase().endsWith(".md")) files = { [file.name]: bytes };
  else {
    let size = 0;
    let count = 0;
    files = unzipSync(bytes, {
      filter: (info) => {
        size += info.originalSize;
        count++;
        if (
          size > 128 * 1024 * 1024 ||
          count > 10000 ||
          info.name.startsWith("/") ||
          info.name.includes("\\") ||
          info.name.split("/").includes("..")
        )
          throw new Error("文件包过大或包含不安全路径");
        return true;
      },
    });
    if (files["manifest.json"])
      return { ...(await importArchive(file)), open_note_id: null };
  }
  const markdownPaths = Object.keys(files).filter((p) =>
    p.toLowerCase().endsWith(".md"),
  );
  const rootPaths = markdownPaths.filter((p) => !p.includes("/"));
  const paths = rootPaths.length
    ? rootPaths
    : markdownPaths.filter((p) => !p.startsWith("attachments/"));
  if (!paths.length)
    throw new Error("请选择 Markdown 文件、Markdown 图片包或工坊备份");
  const assets: Array<{
    id: string;
    path: string;
    filename: string;
    content_type: string;
  }> = [];
  const output: Record<string, Uint8Array> = {};
  const warnings = new Set<string>();
  const notes = paths.map((path) => {
    const doc = parseMarkdown(strFromU8(files[path]), true);
    const transform = (node: JSONContent): JSONContent[] => {
      if (node.type === "canvas") {
        const scene = mapCanvasAssets(
          parseCanvasScene(node.attrs?.scene),
          (source) => {
            const replacement = transform({
              type: "image",
              attrs: { src: source, alt: "画板图片" },
            })[0];
            if (replacement.type !== "image")
              throw new Error("画板引用的图片缺失");
            return String(replacement.attrs?.assetId);
          },
        );
        return [{ type: "canvas", attrs: { scene } }];
      }
      const link = node.marks?.find((m) => m.type === "link");
      if (
        link &&
        !/^\/apps\/thought-workshop\/official-knowledge-bases\/[a-z0-9-]+(?:\/documents\/[a-z0-9-]+)?$/.test(
          String(link.attrs?.href),
        ) &&
        !/^(https?:|mailto:)/i.test(String(link.attrs?.href))
      ) {
        const source = String(link.attrs?.href || "");
        const attachmentPath = relativePath(path, source);
        const mime =
          attachmentMimes[
            attachmentPath?.split(".").pop()?.toLowerCase() || ""
          ];
        if (!attachmentPath || !files[attachmentPath] || !mime) {
          warnings.add(`附件未导入：${source}`);
          return [{ ...node, marks: node.marks?.filter((m) => m !== link) }];
        }
        let asset = assets.find(
          (a) => a.path === `attachments/${attachmentPath}`,
        );
        if (!asset) {
          asset = {
            id: crypto.randomUUID(),
            path: `attachments/${attachmentPath}`,
            filename: attachmentPath.split("/").pop()!,
            content_type: mime,
          };
          assets.push(asset);
          output[asset.path] = files[attachmentPath];
        }
        return [
          {
            type: "attachment",
            attrs: {
              assetId: asset.id,
              filename: asset.filename,
              mimeType: mime,
              byteSize: files[attachmentPath].length,
            },
          },
        ];
      }

      if (node.type === "image") {
        const source = String(node.attrs?.src || "");
        const imagePath = relativePath(path, source);
        if (!imagePath || !files[imagePath]) {
          warnings.add(`图片未导入：${source}`);
          return [
            {
              type: "paragraph",
              content: [
                { type: "text", text: `[图片：${node.attrs?.alt || source}]` },
              ],
            },
          ];
        }
        const ext = imagePath.split(".").pop()?.toLowerCase();
        const mime = (
          {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
          } as Record<string, string>
        )[ext || ""];
        if (!mime) throw new Error("仅支持 PNG、JPEG、GIF 和 WebP 图片");
        const id = crypto.randomUUID();
        output[`assets/${id}`] = files[imagePath];
        assets.push({
          id,
          path: `assets/${id}`,
          filename: imagePath.split("/").pop()!,
          content_type: mime,
        });
        return [
          { type: "image", attrs: { assetId: id, alt: node.attrs?.alt || "" } },
        ];
      }
      const children = node.content?.flatMap(transform);
      if (
        ["paragraph", "heading", "detailsSummary"].includes(node.type || "") &&
        children?.some((n) =>
          ["image", "paragraph", "attachment"].includes(n.type || ""),
        )
      ) {
        const result: JSONContent[] = [];
        let inline: JSONContent[] = [];
        for (const child of children) {
          if (["image", "paragraph", "attachment"].includes(child.type || "")) {
            if (inline.length)
              result.push({ type: "paragraph", content: inline });
            inline = [];
            result.push(child);
          } else inline.push(child);
        }
        if (inline.length) result.push({ type: "paragraph", content: inline });
        return result;
      }
      if (
        ["listItem", "taskItem"].includes(node.type || "") &&
        children?.length &&
        children[0].type !== "paragraph"
      )
        children.unshift({ type: "paragraph" });
      return [{ ...node, ...(children ? { content: children } : {}) }];
    };
    return {
      title: path.split("/").pop()!.replace(/\.md$/i, ""),
      document: transform(doc)[0],
      tags: [],
      schema_version: 2,
      id: crypto.randomUUID(),
      knowledge_base_id: "markdown-project",
      parent_id: null,
      is_home: false,
    };
  });
  output["manifest.json"] = strToU8(
    JSON.stringify({
      format: "thought-workshop-backup",
      version: 4,
      notes: [
        ...notes,
        {
          id: "markdown-home",
          knowledge_base_id: "markdown-project",
          title: "首页",
          is_home: true,
          parent_id: null,
          schema_version: 2,
          document: { type: "doc", content: [{ type: "paragraph" }] },
        },
      ],
      knowledge_bases: [
        {
          id: "markdown-project",
          title: file.name.replace(/\.(zip|md)$/i, "") || "导入的知识库",
          home_note_id: "markdown-home",
        },
      ],
      folders: [],
      assets,
    }),
  );
  const result = await importArchive(
    new File([zipSync(output) as BlobPart], "markdown.zip", {
      type: "application/zip",
    }),
    project,
  );
  return {
    ...result,
    open_note_id: result.note_ids[0] || null,
    warnings: [...(result.warnings || []), ...warnings],
  };
}

const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

type ExportCrop = {
  left: number;
  top: number;
  width: number;
  height: number;
};

function exportCrop(figure: HTMLElement): ExportCrop | null {
  const values = [
    figure.dataset.cropLeft,
    figure.dataset.cropTop,
    figure.dataset.cropWidth,
    figure.dataset.cropHeight,
  ].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return null;
  const [left, top, width, height] = values;
  if (width < 1 || height < 1 || left + width > 100 || top + height > 100)
    return null;
  return { left, top, width, height };
}

async function imageSize(blob: Blob) {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  }
  const source = await dataUrl(blob);
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = source;
  });
}

async function prepareExportImage(
  parsed: Document,
  image: HTMLImageElement,
  blob: Blob,
) {
  const figure = image.closest<HTMLElement>("figure[data-thought-image]");
  image.src = await dataUrl(blob);
  image.removeAttribute("data-asset-id");
  if (!figure) return;
  const displayWidth = Number(image.getAttribute("width"));
  figure.classList.add("thought-export-figure");
  figure.style.width = displayWidth
    ? `min(100%, ${displayWidth}px)`
    : "fit-content";
  figure.style.maxWidth = "100%";
  image.removeAttribute("width");
  image.style.width = "100%";
  const crop = exportCrop(figure);
  if (!crop) return;
  const natural = await imageSize(blob);
  const viewport = parsed.createElement("div");
  viewport.className = "thought-export-image-crop";
  viewport.style.aspectRatio = String(
    (natural.width * crop.width) / (natural.height * crop.height),
  );
  image.style.width = `${10000 / crop.width}%`;
  image.style.height = `${10000 / crop.height}%`;
  image.style.left = `${(-crop.left / crop.width) * 100}%`;
  image.style.top = `${(-crop.top / crop.height) * 100}%`;
  image.style.maxWidth = "none";
  image.before(viewport);
  viewport.append(image);
}

export async function buildHtmlDocument(
  note: Note,
  editor: Editor,
  options: {
    navigation?: NavigationAccess;
    directoryEntries?: DirectoryEntry[];
    assetPaths?: Record<string, string>;
    assetUrl?: (id: string) => string;
    referencePaths?: Record<string, string>;
    cache?: Map<string, Promise<Blob>>;
  } = {},
) {
  const blobFor = (path: string) => {
    if (!options.cache) return fetchApiBlob(path);
    let promise = options.cache.get(path);
    if (!promise) {
      promise = fetchApiBlob(path);
      options.cache.set(path, promise);
    }
    return promise;
  };
  const parsed = new DOMParser().parseFromString(editor.getHTML(), "text/html");
  if (
    note.kind === "multitable" ||
    parsed.querySelector("[data-multitable-view]")
  ) {
    const content = await staticTableContent(note, options.navigation);
    const projection = new DOMParser().parseFromString(
      generateHTML(content, editorExtensions(undefined, true)),
      "text/html",
    );
    if (note.kind === "multitable")
      parsed.body.replaceChildren(...Array.from(projection.body.childNodes));
    else {
      // Replace the serialized body with the same controlled document plus static table nodes.
      parsed.body.replaceChildren(...Array.from(projection.body.childNodes));
    }
  }
  for (const image of parsed.querySelectorAll<HTMLImageElement>(
    "img[data-asset-id]",
  )) {
    const id = image.dataset.assetId || "";
    const blob = await blobFor(
      options.assetUrl?.(id) ?? `/v1/files/${encodeURIComponent(id)}/content`,
    );
    await prepareExportImage(parsed, image, blob);
    if (options.assetPaths?.[id]) image.src = options.assetPaths[id];
  }
  const files: Record<string, Uint8Array> = {};
  for (const card of parsed.querySelectorAll<HTMLElement>(
    "[data-attachment]",
  )) {
    const id = card.dataset.assetId || "";
    const name = card.dataset.filename || "附件";
    const path = options.assetPaths?.[id] ?? attachmentArchivePath(id, name);
    if (!options.assetPaths?.[id] && !files[path])
      files[path] = new Uint8Array(
        await (
          await blobFor(
            options.assetUrl?.(id) ??
              `/v1/files/${encodeURIComponent(id)}/download`,
          )
        ).arrayBuffer(),
      );
    const link = parsed.createElement("a");
    link.href = encodedFilePath(path);
    link.download = name;
    link.textContent = `${name} · 下载附件`;
    card.replaceChildren(link);
  }
  for (const canvas of parsed.querySelectorAll<HTMLElement>(
    "pre[data-fpl-canvas]",
  )) {
    const scene = parseCanvasScene(JSON.parse(canvas.textContent || ""));
    const figure = parsed.createElement("figure");
    if (options.assetPaths) {
      const { CanvasSvg } = await import("./diagrams/CanvasSvg");
      const { renderToStaticMarkup } = await import("react-dom/server");
      figure.innerHTML = renderToStaticMarkup(
        (await import("react")).createElement(CanvasSvg, {
          scene,
          images: options.assetPaths,
        }),
      );
    } else figure.innerHTML = await canvasSvgText(scene, options.assetUrl);
    canvas.replaceWith(figure);
  }
  const { default: katex } = await import("katex");
  for (const math of parsed.querySelectorAll<HTMLElement>(
    '[data-type="inline-math"],[data-type="block-math"]',
  )) {
    math.innerHTML = katex.renderToString(
      math.getAttribute("data-latex") || math.getAttribute("latex") || "",
      {
        displayMode: math.dataset.type === "block-math",
        throwOnError: false,
        trust: false,
        output: "mathml",
      },
    );
  }
  for (const diagram of parsed.querySelectorAll<HTMLElement>(
    "pre[data-mermaid]",
  )) {
    try {
      diagram.innerHTML = await renderDiagram(
        diagram.textContent || "",
        `export-${crypto.randomUUID()}`,
      );
    } catch {
      /* Keep source text when rendering is invalid. */
    }
  }
  parsed
    .querySelectorAll("script,iframe,object,embed")
    .forEach((n) => n.remove());
  parsed.querySelectorAll("*").forEach((n) =>
    Array.from(n.attributes).forEach((a) => {
      if (a.name.startsWith("on")) n.removeAttribute(a.name);
    }),
  );
  await navigationHtml(
    parsed,
    note.document,
    note.knowledge_base_id,
    options.navigation,
    options.directoryEntries,
    options.referencePaths,
  );
  const heading = parsed.createElement("h1");
  heading.textContent = note.title;
  parsed.body.prepend(heading);
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${heading.innerHTML}</title><style>${navigationExportCss}body{max-width:900px;margin:48px auto;padding:24px;font:16px/1.8 system-ui;color:#242621}img,svg{max-width:100%;height:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:8px}aside[data-callout]{border-left:4px solid #528da8;background:#edf4f8;padding:12px 16px;margin:16px 0}aside[data-callout=warning]{border-color:#c49433}aside[data-callout=danger]{border-color:#b95656}aside[data-callout=success]{border-color:#4b9870}blockquote{border-left:3px solid #e57b59;margin:16px 0;padding-left:20px}pre{background:#f4f1ec;padding:16px;white-space:pre-wrap}math[display=block]{margin:24px}a{color:#b95437}li[data-type=taskItem]{list-style:none}.thought-export-figure{margin:24px 0}.thought-export-figure[data-align=center]{margin-left:auto;margin-right:auto}.thought-export-figure[data-align=right]{margin-left:auto}.thought-export-figure>img{display:block;width:100%}.thought-export-figure figcaption{margin-top:8px;color:#686b65;text-align:center}.thought-export-image-crop{position:relative;width:100%;overflow:hidden;border-radius:8px}.thought-export-image-crop img{position:absolute;display:block}</style><body>${parsed.body.innerHTML}</body></html>`;
  return { html, files };
}

export async function exportHtml(
  note: Note,
  editor: Editor,
  assetUrl?: (id: string) => string,
  navigation?: NavigationAccess,
) {
  const { html, files } = await buildHtmlDocument(note, editor, {
    assetUrl,
    navigation,
  });
  if (Object.keys(files).length) {
    files[`${safeName(note.title)}.html`] = strToU8(html);
    download(
      new Blob([zipSync(files) as BlobPart], { type: "application/zip" }),
      `${safeName(note.title)}-html.zip`,
    );
  } else
    download(
      new Blob([html], { type: "text/html;charset=utf-8" }),
      `${safeName(note.title)}.html`,
    );
}
