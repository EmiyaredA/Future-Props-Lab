import type { JSONContent } from "@tiptap/core";
import { emptyCard } from "../document-layout/model";
import type { OfficialKnowledgeBase, OfficialDocumentSummary } from "./catalog";
import { officialGroupDescription } from "./reading";
export function officialHomeDocument(
  library: OfficialKnowledgeBase,
): JSONContent {
  const card = (
    doc: OfficialDocumentSummary,
    featured = false,
  ): JSONContent => ({
    ...emptyCard(),
    attrs: {
      ...emptyCard().attrs,
      kind: "official",
      libraryId: library.id,
      documentId: doc.id,
      style: featured ? "featured" : "standard",
      eyebrow: featured ? "从这里开始" : "",
    },
  });
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: library.description }],
      },
      ...(library.documents[0] ? [card(library.documents[0], true)] : []),
      ...[...new Set(library.documents.map((doc) => doc.group))].flatMap(
        (group) => [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: group }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: officialGroupDescription(group) }],
          },
          {
            type: "cardGrid",
            content: library.documents
              .filter((doc) => doc.group === group)
              .map((doc) => card(doc)),
          },
        ],
      ),
    ],
  };
}
