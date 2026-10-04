import { afterEach, describe, expect, it, vi } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { APPLICATION_DEFINITIONS } from "@app/applicationRegistry";
import { parseRoute, pathFor } from "@app/routes";
import {
  OFFICIAL_KNOWLEDGE_BASES,
  findOfficialLibrary,
  officialPath,
} from "@features/thought-workshop/official/catalog";
import * as content from "@features/thought-workshop/official/content";

afterEach(() => vi.restoreAllMocks());

describe("bundled official knowledge", () => {
  it("covers every application with substantive, uniquely addressed chapters and valid links", async () => {
    expect(OFFICIAL_KNOWLEDGE_BASES).toHaveLength(12);
    expect(new Set(OFFICIAL_KNOWLEDGE_BASES.map((item) => item.id)).size).toBe(
      12,
    );
    expect(
      OFFICIAL_KNOWLEDGE_BASES.flatMap((item) =>
        item.applicationId ? [item.applicationId] : [],
      ).sort(),
    ).toEqual(APPLICATION_DEFINITIONS.map((item) => item.id).sort());
    const sourcePaths: string[] = [];
    for (const library of OFFICIAL_KNOWLEDGE_BASES) {
      expect(new Set(library.documents.map((item) => item.id)).size).toBe(
        library.documents.length,
      );
      expect(library.documents.length).toBe(
        library.applicationId ? 5 : library.id === "technical" ? 31 : 12,
      );
      for (const doc of library.documents) {
        sourcePaths.push(doc.source);
        expect(doc.summary.length, doc.source).toBeGreaterThan(18);
        expect(doc.related.length, doc.source).toBeGreaterThanOrEqual(2);
        const references = doc.related.map(
          (ref) => `${ref.libraryId}/${ref.documentId}`,
        );
        expect(new Set(references).size, doc.source).toBe(references.length);
        expect(references, doc.source).not.toContain(`${library.id}/${doc.id}`);
        for (const ref of doc.related)
          expect(
            findOfficialLibrary(ref.libraryId)?.documents.some(
              (item) => item.id === ref.documentId,
            ),
            `${doc.source}: ${ref.libraryId}/${ref.documentId}`,
          ).toBe(true);
        const markdown = await content.loadOfficialDocument(doc);
        expect(markdown.length, doc.source).toBeGreaterThan(350);
        expect(
          content
            .officialHeadings(markdown)
            .filter((heading) => heading.level === 1),
        ).toHaveLength(1);
        expect(
          content.officialHeadings(markdown).length,
          doc.source,
        ).toBeGreaterThanOrEqual(3);
        expect(markdown, doc.source).not.toMatch(/TODO|待补充|占位正文/);
        const tree = unified().use(remarkParse).parse(markdown);
        const check = (node: {
          type: string;
          url?: string;
          children?: typeof tree.children;
        }) => {
          if (
            node.url?.startsWith(
              "/apps/thought-workshop/official-knowledge-bases/",
            )
          ) {
            const route = parseRoute(node.url);
            const target = findOfficialLibrary(route.projectId);
            expect(target, `${doc.source}: ${node.url}`).toBeDefined();
            if (route.documentId)
              expect(
                target?.documents.some((item) => item.id === route.documentId),
              ).toBe(true);
          }
          node.children?.forEach(check);
        };
        check(tree);
      }
    }
    expect(new Set(sourcePaths).size).toBe(93);
    const files = import.meta.glob(
      "../src/features/thought-workshop/official/content/**/*.md",
    );
    expect(Object.keys(files)).toHaveLength(93);
  });

  it("preserves legacy URLs for permission-checked publication resolution", () => {
    const path = officialPath("thought-workshop", "storage");
    const route = parseRoute(path);
    expect(route.page).toBe("thought-workshop-official");
    expect(pathFor(route.page, route.projectId, route.documentId)).toBe(path);
  });
});
