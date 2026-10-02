import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { OfficialArticle } from "@features/thought-workshop/official/OfficialArticle";
import { OfficialKnowledgePage } from "@features/thought-workshop/official/OfficialKnowledgePage";
import { OfficialLibraryCards } from "@features/thought-workshop/official/OfficialLibraryCards";

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
        library.applicationId ? 5 : library.id === "technical" ? 22 : 12,
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
    expect(new Set(sourcePaths).size).toBe(84);
    const files = import.meta.glob(
      "../src/features/thought-workshop/official/content/**/*.md",
    );
    expect(Object.keys(files)).toHaveLength(84);
  });

  it("keeps official identities separate from user projects and round-trips deep links", () => {
    const path = officialPath("thought-workshop", "storage");
    const route = parseRoute(path);
    expect(route).toEqual({
      page: "thought-workshop-official",
      projectId: "thought-workshop",
      documentId: "storage",
    });
    expect(pathFor(route.page, route.projectId, route.documentId)).toBe(path);
    expect(
      parseRoute("/apps/thought-workshop/knowledge-bases/general").page,
    ).toBe("thought-workshop-editor");
  });

  it("filters official cards without showing project mutation controls", () => {
    const onOpen = vi.fn();
    render(<OfficialLibraryCards query="透明镜头" onOpen={onOpen} />);
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("官方 · 只读")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "进入知识库" }));
    expect(onOpen).toHaveBeenCalledWith("motion-compositor");
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: /编辑|删除|导入/ })).toBeNull();
  });

  it("renders matching heading anchors, local links and inert Markdown", () => {
    const onOpen = vi.fn();
    const { container } = render(
      <OfficialArticle
        markdown={
          "# 标题\n\n## 相同\n\n## 相同\n\n#### 四级\n\n[去文档](/apps/thought-workshop/official-knowledge-bases/general/documents/start)\n\n<script>alert(1)</script>\n\n[危险](javascript:alert(1))"
        }
        onOpen={onOpen}
      />,
    );
    fireEvent.click(screen.getByText("文档大纲"));
    const links = within(
      screen.getByRole("navigation", { name: "文档章节" }),
    ).getAllByRole("link");
    expect(new Set(links.map((link) => link.getAttribute("href"))).size).toBe(
      4,
    );
    for (const link of links)
      expect(
        container.querySelector(link.getAttribute("href")!),
      ).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "去文档" }));
    expect(onOpen).toHaveBeenCalledWith("general", "start");
  });
});

function Reader({
  libraryId = "live2d-workshop",
  documentId,
}: {
  libraryId?: string;
  documentId?: string;
}) {
  const [route, setRoute] = useState({ libraryId, documentId });
  return (
    <OfficialKnowledgePage
      {...route}
      onBack={vi.fn()}
      onOpen={(libraryId, documentId) => setRoute({ libraryId, documentId })}
    />
  );
}
function renderReader(props: { libraryId?: string; documentId?: string } = {}) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Reader {...props} />
    </QueryClientProvider>,
  );
}

describe("official reader", () => {
  it("searches body text, opens results and clears the search on navigation", async () => {
    renderReader();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索官方文档" }), {
      target: { value: "moc3" },
    });
    const results = await screen.findByRole("region", {
      name: "官方文档搜索结果",
    });
    const result = await within(results).findByRole("button", {
      name: /导入导出与交付/,
    });
    fireEvent.click(result);
    expect(
      await screen.findByRole("article", { name: "官方文档正文" }),
    ).toHaveTextContent("moc3");
    expect(screen.getByRole("textbox", { name: "搜索官方文档" })).toHaveValue(
      "",
    );
    expect(
      screen.queryByRole("button", { name: /新建文档|编辑首页|导入项目/ }),
    ).toBeNull();
    expect(document.querySelector('[contenteditable="true"]')).toBeNull();
  });

  it("preserves figure identity and zoom when page navigation callbacks change", async () => {
    const markdown = "# 系统\n\n```fpl-canvas\nsystem\n```";
    const onCopy = vi.fn();
    const { rerender } = render(
      <OfficialArticle markdown={markdown} onOpen={vi.fn()} onCopy={onCopy} />,
    );
    const trigger = await screen.findByRole("button", {
      name: "复制到个人笔记",
    });
    fireEvent.click(screen.getByRole("button", { name: "放大图表" }));
    rerender(
      <OfficialArticle markdown={markdown} onOpen={vi.fn()} onCopy={onCopy} />,
    );
    expect(screen.getByRole("button", { name: "复制到个人笔记" })).toBe(
      trigger,
    );
    expect(screen.getByText("125%")).toBeVisible();
  });

  it("reports unknown library or document without substituting another library's article", () => {
    renderReader({
      libraryId: "presentation-workshop",
      documentId: "accounts",
    });
    expect(
      screen.getByRole("heading", { name: "官方文档不存在" }),
    ).toBeVisible();
    expect(screen.queryByRole("article")).toBeNull();
  });

  it("retains an explicit retry for failed article loading", async () => {
    vi.spyOn(content, "loadOfficialDocument").mockRejectedValueOnce(
      new Error("资源暂时无法读取"),
    );
    renderReader({ documentId: "overview" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "资源暂时无法读取",
    );
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(
      await screen.findByRole("article", { name: "官方文档正文" }),
    ).toHaveTextContent("Live2D");
  });
});
