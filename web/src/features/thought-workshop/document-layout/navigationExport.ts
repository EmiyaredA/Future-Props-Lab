import type { JSONContent } from "@tiptap/core";
import { resolveReferences } from "../knowledge-tools/api";
import { getDirectory } from "../knowledgeApi";
import { resolveOfficialLink } from "../community/api";
import type { DocumentAccess } from "../DocumentAccess";
import type { DirectoryEntry } from "./model";

export type NavigationAccess = Pick<
  DocumentAccess,
  | "resolveReferences"
  | "directory"
  | "referenceHref"
  | "publicationId"
  | "currentNoteId"
>;
const ordinary: NavigationAccess = {
  resolveReferences,
  directory: async (id) => (await getDirectory(id)).documents,
  referenceHref: (id, library) =>
    `/apps/thought-workshop/knowledge-bases/${encodeURIComponent(library)}/documents/${encodeURIComponent(id)}`,
};
export async function navigationSnapshot(
  document: JSONContent,
  library: string,
  access: NavigationAccess = ordinary,
  entries?: DirectoryEntry[],
  paths?: Record<string, string>,
) {
  const ids = new Set<string>();
  const legacy = new Map<string, Record<string, unknown>>();
  let needsDirectory = false;
  const scan = (node: JSONContent) => {
    if (
      (node.type === "documentCard" || node.type === "documentReference") &&
      node.attrs?.kind === "official"
    )
      legacy.set(
        `${node.attrs.libraryId}/${node.attrs.documentId ?? ""}`,
        node.attrs,
      );
    if (
      (node.type === "documentCard" || node.type === "documentReference") &&
      node.attrs?.kind === "note" &&
      node.attrs.noteId
    )
      ids.add(node.attrs.noteId);
    if (node.type === "documentDirectory") needsDirectory = true;
    node.content?.forEach(scan);
  };
  scan(document);
  const legacyTargets = new Map(
    await Promise.all(
      [...legacy].map(async ([key, attrs]) => {
        const rows = await resolveOfficialLink(
          String(attrs.libraryId),
          String(attrs.documentId ?? ""),
        );
        const target = rows.length === 1 ? rows[0] : undefined;
        return [
          key,
          target
            ? {
                title: target.title,
                summary: target.excerpt,
                href: `/apps/thought-workshop/community/${target.publication.id}/documents/${target.note_id}`,
              }
            : undefined,
        ] as const;
      }),
    ),
  );
  const resolved = entries
    ? entries.map((entry) => ({
        id: entry.id,
        title: entry.title,
        excerpt: entry.excerpt,
        knowledge_base_id: entry.knowledge_base_id,
        available: true,
      }))
    : ids.size
      ? (
          await Promise.all(
            Array.from({ length: Math.ceil(ids.size / 100) }, (_, index) =>
              access.resolveReferences(
                [...ids].slice(index * 100, index * 100 + 100),
              ),
            ),
          )
        ).flat()
      : [];
  const directory =
    entries ??
    (needsDirectory && access.directory ? await access.directory(library) : []);
  const byId = new Map(
    resolved.filter((row) => row.available).map((row) => [row.id, row]),
  );
  const card = (attrs: Record<string, unknown>) => {
    if (attrs.kind === "official") {
      return legacyTargets.get(`${attrs.libraryId}/${attrs.documentId ?? ""}`);
    }
    const target = byId.get(String(attrs.noteId));
    if (!target || (paths && !paths[target.id])) return undefined;
    return {
      title: target.title || "文档",
      summary: target.excerpt || "",
      href:
        paths?.[target.id] ??
        access.referenceHref(target.id, target.knowledge_base_id!),
    };
  };
  const children = (parent: string | null) =>
    parent && !directory.some((row) => row.id === parent)
      ? []
      : directory
          .filter(
            (row) =>
              !row.is_home &&
              row.parent_id === parent &&
              (!paths || paths[row.id]),
          )
          .sort((a, b) => a.position - b.position);
  return {
    card,
    children,
    href: (row: DirectoryEntry) =>
      paths?.[row.id] ?? access.referenceHref(row.id, row.knowledge_base_id),
  };
}
export async function navigationMarkdown(
  document: JSONContent,
  library: string,
  access?: NavigationAccess,
) {
  const snapshot = await navigationSnapshot(document, library, access);
  const paragraph = (title: string, href?: string): JSONContent => ({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: title,
        ...(href ? { marks: [{ type: "link", attrs: { href } }] } : {}),
      },
    ],
  });
  const walk = (node: JSONContent): JSONContent[] => {
    if (node.type === "documentReference") {
      const target = snapshot.card(node.attrs ?? {});
      return [
        {
          type: "text",
          text: target
            ? node.attrs?.customLabel || target.title
            : "文档不可访问",
          ...(target
            ? { marks: [{ type: "link", attrs: { href: target.href } }] }
            : {}),
        },
      ];
    }
    if (node.type === "documentCard") {
      const card = snapshot.card(node.attrs ?? {});
      return card
        ? [
            ...(node.attrs?.eyebrow ? [paragraph(node.attrs.eyebrow)] : []),
            paragraph(card.title, card.href),
            ...(card.summary ? [paragraph(card.summary)] : []),
          ]
        : [paragraph("文档不可访问")];
    }
    if (node.type === "documentDirectory")
      return snapshot
        .children(node.attrs?.parentId ?? null)
        .map((row) => paragraph(row.title, snapshot.href(row)));
    if (node.type === "cardGrid") return (node.content ?? []).flatMap(walk);
    return [
      {
        ...node,
        ...(node.content ? { content: node.content.flatMap(walk) } : {}),
      },
    ];
  };
  return walk(document)[0];
}
export async function navigationHtml(
  parsed: Document,
  document: JSONContent,
  library: string,
  access?: NavigationAccess,
  entries?: DirectoryEntry[],
  paths?: Record<string, string>,
) {
  const snapshot = await navigationSnapshot(
    document,
    library,
    access,
    entries,
    paths,
  );
  const render = (
    title: string,
    summary?: string,
    href?: string,
    featured?: boolean,
    eyebrow?: string,
  ) => {
    const wrapper = parsed.createElement(href ? "a" : "div");
    wrapper.className = `document-card${featured ? " is-featured" : ""}`;
    if (href) wrapper.setAttribute("href", href);
    const copy = parsed.createElement("span");
    copy.className = "document-card-copy";
    if (eyebrow && href) {
      const small = parsed.createElement("small");
      small.className = "document-card-eyebrow";
      small.textContent = eyebrow;
      copy.append(small);
    }
    const strong = parsed.createElement("strong");
    strong.textContent = title;
    copy.append(strong);
    if (summary) {
      const span = parsed.createElement("span");
      span.className = "document-card-summary";
      span.textContent = summary;
      copy.append(span);
    }
    if (featured && href) {
      const cta = parsed.createElement("span");
      cta.className = "document-card-cta";
      cta.textContent = "开始阅读 →";
      copy.append(cta);
    }
    wrapper.append(copy);
    return wrapper;
  };
  parsed
    .querySelectorAll<HTMLElement>("span[data-document-reference]")
    .forEach((element) => {
      const target = snapshot.card({
        kind: element.dataset.refKind,
        noteId: element.dataset.refNoteid,
        libraryId: element.dataset.refLibraryid,
        documentId: element.dataset.refDocumentid,
      });
      if (!target) {
        element.replaceWith(parsed.createTextNode("文档不可访问"));
        return;
      }
      const link = parsed.createElement("a");
      link.setAttribute("href", target.href);
      link.textContent = element.dataset.refCustomlabel || target.title;
      element.replaceWith(link);
    });
  parsed
    .querySelectorAll<HTMLElement>("[data-document-card]")
    .forEach((element) => {
      const attrs = Object.fromEntries(
        ["kind", "noteId", "libraryId", "documentId"].map((key) => [
          key,
          element.getAttribute(`data-navigation-${key.toLowerCase()}`),
        ]),
      );
      const card = snapshot.card(attrs);
      element.replaceWith(
        render(
          card?.title ?? "文档不可访问",
          card?.summary,
          card?.href,
          element.dataset.navigationStyle === "featured",
          element.dataset.navigationEyebrow,
        ),
      );
    });
  parsed
    .querySelectorAll<HTMLElement>("[data-document-directory]")
    .forEach((element) => {
      const wrapper = parsed.createElement("div");
      wrapper.className =
        element.dataset.navigationStyle === "cards"
          ? "document-card-grid"
          : "document-directory-list";
      snapshot
        .children(element.dataset.navigationParentid || null)
        .forEach((row) =>
          wrapper.append(render(row.title, row.excerpt, snapshot.href(row))),
        );
      element.replaceWith(wrapper);
    });
}
export const navigationExportCss = `.document-card{display:flex;gap:16px;padding:20px;border:1px solid #e7e1d8;border-radius:10px;color:inherit;text-decoration:none;overflow-wrap:anywhere}.document-card-copy{display:flex;flex-direction:column;gap:12px;min-width:0;flex:1}.document-card strong{font-size:17px;line-height:1.5}.document-card-summary{color:#716b63;font-size:14px;line-height:1.8}.document-card-eyebrow{color:#b95437;font-size:13px}.document-card.is-featured{background:#fcf0e9;border-color:transparent;border-left:4px solid #d96945;padding:28px}.document-card.is-featured strong{font-size:22px}.document-card-cta{align-self:flex-start;background:#d96945;color:#fff;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600}.document-card-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:20px 0}@media(max-width:700px){.document-card-grid{grid-template-columns:minmax(0,1fr)}.document-card.is-featured{padding:20px}}`;
