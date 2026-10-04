import type { JSONContent } from "@tiptap/core";
import type { Note } from "../api";
import type { NavigationAccess } from "../document-layout/navigationExport";
import {
  tableRecords,
  tableStructure,
  type Table,
  type View,
  type Scope,
  type RecordRow,
} from "./api";
import { display, visibleFields } from "./model";

const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text }] : [],
});
async function content(
  note: string,
  table: Table,
  scope: Scope,
  access?: NavigationAccess,
  view?: View,
) {
  const rows: RecordRow[] = [];
  for (let offset = 0; offset < 5000; offset += 200) {
    const page = await tableRecords(
      note,
      table.id,
      { view_id: view?.id, offset, limit: 200, search: "" },
      scope,
    );
    rows.push(...page.items);
    if (rows.length >= page.total) break;
  }
  const fields = view ? visibleFields(table, view) : table.fields;
  const ids = [
    ...new Set(
      fields
        .filter((f) => f.type === "note")
        .flatMap((f) =>
          rows.flatMap((r) =>
            Array.isArray(r.values[f.id]) ? (r.values[f.id] as string[]) : [],
          ),
        ),
    ),
  ];
  const titles = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const resolved = await (
      access?.resolveReferences ??
      (await import("../knowledge-tools/api")).resolveReferences
    )(ids.slice(i, i + 100));
    for (const r of resolved) if (r.available) titles.set(r.id, r.title);
  }
  return [
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: table.name }],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: fields.map((f) => ({
            type: "tableHeader",
            content: [paragraph(f.name)],
          })),
        },
        ...rows.map((r) => ({
          type: "tableRow",
          content: fields.map((f) => {
            const value = r.values[f.id];
            const label =
              f.type === "note" && Array.isArray(value)
                ? value.map((id) => titles.get(id) ?? "文档不可访问").join("; ")
                : f.type === "attachment" && Array.isArray(value)
                  ? `${value.length} 个附件（请从原表下载）`
                  : display(f, value);
            return { type: "tableCell", content: [paragraph(label)] };
          }),
        })),
      ],
    },
  ] satisfies JSONContent[];
}

export async function staticTableContent(
  note: Note,
  access?: NavigationAccess,
): Promise<JSONContent> {
  const scope: Scope = {
    publication: access?.publicationId,
    parent: access?.publicationId ? note.id : undefined,
  };
  if (note.kind === "multitable") {
    const structure = await tableStructure(note.id, {
      ...scope,
      parent: undefined,
    });
    const nodes: JSONContent[] = [];
    for (const t of structure.tables)
      nodes.push(
        ...(await content(note.id, t, { ...scope, parent: undefined }, access)),
      );
    return { type: "doc", content: nodes };
  }
  const document = structuredClone(note.document);
  async function walk(node: JSONContent) {
    if (!node.content) return;
    const children: JSONContent[] = [];
    for (const child of node.content) {
      if (child.type !== "multitableView") {
        await walk(child);
        children.push(child);
        continue;
      }
      const { noteId, tableId, viewId } = child.attrs ?? {};
      try {
        const structure = await tableStructure(String(noteId), scope);
        const table = structure.tables.find((t) => t.id === tableId),
          view = table?.views.find((v) => v.id === viewId);
        if (!table || !view) {
          children.push(paragraph("多维表格视图已删除"));
          continue;
        }
        children.push(
          ...(await content(String(noteId), table, scope, access, view)),
        );
      } catch (error) {
        const { ApiError } = await import("@platform/api/client");
        if (error instanceof ApiError && [403, 404].includes(error.status))
          children.push(paragraph("多维表格不可访问"));
        else throw error;
      }
    }
    node.content = children;
  }
  await walk(document);
  return document;
}
