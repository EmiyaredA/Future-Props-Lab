import type { JSONContent } from "@tiptap/core";

export type DirectoryEntry = {
  id: string;
  title: string;
  parent_id: string | null;
  position: number;
  is_home: boolean;
  excerpt: string;
  knowledge_base_id: string;
};
export type CardTarget = {
  kind: "note" | "official";
  noteId: string | null;
  libraryId: string | null;
  documentId: string | null;
  style: "standard" | "featured";
  eyebrow: string;
};
export const emptyCard = (): JSONContent => ({
  type: "documentCard",
  attrs: {
    kind: "note",
    noteId: null,
    libraryId: null,
    documentId: null,
    style: "standard",
    eyebrow: "",
  },
});
export const homeTemplate = (): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "介绍这个知识库的主题与阅读方式。" }],
    },
    {
      ...emptyCard(),
      attrs: { ...emptyCard().attrs, style: "featured", eyebrow: "从这里开始" },
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "开始阅读" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "选择两篇文档，作为读者的入口。" }],
    },
    { type: "cardGrid", content: [emptyCard(), emptyCard()] },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "全部文档" }],
    },
    { type: "documentDirectory", attrs: { parentId: null, style: "cards" } },
  ],
});
