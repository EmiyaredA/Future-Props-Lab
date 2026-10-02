import { Editor } from "@tiptap/core";
import { zipSync, strToU8 } from "fflate";
import { fetchApiBlob } from "@platform/api/client";
import { editorExtensions } from "../editorExtensions";
import { buildHtmlDocument } from "../portability";
import { download } from "../download";
import type { Note } from "../api";
import { libraryExportSnapshot } from "./api";

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
export async function exportLibraryHtml(id: string) {
  const snapshot = await libraryExportSnapshot(id),
    files: Record<string, Uint8Array> = {},
    cache = new Map<string, Promise<Blob>>();
  const documents = snapshot.documents as Note[],
    paths: Record<string, string> = {},
    titles: Record<string, string> = {};
  documents.forEach((note) => {
    paths[note.id] = `${note.id}.html`;
    titles[note.id] = note.title;
  });
  const resources: Record<string, string> = {};
  for (const asset of snapshot.asset_ids) {
    const path = `/v1/files/${encodeURIComponent(asset)}/download`,
      promise = fetchApiBlob(path);
    cache.set(path, promise);
    const blob = await promise;
    resources[asset] = `../assets/${asset}`;
    files[`assets/${asset}`] = new Uint8Array(await blob.arrayBuffer());
    cache.set(
      `/v1/files/${encodeURIComponent(asset)}/content`,
      Promise.resolve(blob),
    );
  }
  const tree = (parent: string | null, seen = new Set<string>()): string => {
    const children = documents.filter(
      (note) =>
        !note.is_home && note.parent_id === parent && !seen.has(note.id),
    );
    return children.length
      ? "<ul>" +
          children
            .map((note) => {
              const next = new Set(seen);
              next.add(note.id);
              return `<li><a href="documents/${note.id}.html">${escape(note.title)}</a>${tree(note.id, next)}</li>`;
            })
            .join("") +
          "</ul>"
      : "";
  };
  const libraryTitle = String(snapshot.knowledge_base.title ?? "知识库"),
    home = documents.find((note) => note.is_home);
  files["index.html"] = strToU8(
    `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(libraryTitle)}</title><style>body{max-width:900px;margin:32px auto;padding:16px;font:16px/1.8 system-ui}a{color:#b95437}</style><body><h1>${escape(libraryTitle)}</h1>${home ? `<p><a href="documents/${home.id}.html">知识库首页</a></p>` : ""}${tree(null)}</body></html>`,
  );
  for (const note of documents) {
    const editor = new Editor({
      extensions: editorExtensions(undefined, true),
      content: note.document,
      editable: false,
    });
    try {
      const { html } = await buildHtmlDocument(note, editor, {
        assetPaths: resources,
        referencePaths: paths,
        referenceTitles: titles,
        cache,
      });
      const children = documents.filter(
        (child) =>
          !child.is_home && child.parent_id === (note.is_home ? null : note.id),
      );
      const navigation = `<nav><a href="../index.html">返回知识库目录</a>${children.length ? "<h2>子文档</h2><ul>" + children.map((child) => `<li><a href="${child.id}.html">${escape(child.title)}</a></li>`).join("") + "</ul>" : ""}</nav>`;
      files[`documents/${note.id}.html`] = strToU8(
        html.replace("<body>", `<body>${navigation}`),
      );
    } finally {
      editor.destroy();
    }
  }
  download(
    new Blob([zipSync(files) as BlobPart], { type: "application/zip" }),
    `${libraryTitle.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100)}-html.zip`,
  );
}
