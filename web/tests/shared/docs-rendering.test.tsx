import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GUIDE_PAGES, PAGE_BY_ID, parseArticle } from "../../src/docs/content";
import { compileDocument } from "../../src/docs/rendering/compileDocument";
import { DocumentRenderer } from "../../src/docs/rendering/DocumentRenderer";
import type { GuidePage } from "../../src/docs/types";
import type { DocNode } from "../../src/docs/rendering/types";
import contract from "../../src/docs/rendering/componentContract.json";
import { createDocComponents } from "../../src/docs/rendering/createDocComponents";

afterEach(cleanup);
function article(markdown: string, data?: Record<string, unknown>): GuidePage {
  return {
    ...PAGE_BY_ID.get("overview")!,
    ...parseArticle(markdown, true),
    componentSyntax: true,
    data,
  };
}
function collect(nodes: DocNode[]): DocNode[] {
  return nodes.flatMap((node) => [
    node,
    ...(node.type === "element" ? collect(node.children) : []),
  ]);
}

describe("Sayflow document framework integration", () => {
  it("compiles every public article with preserved outline and protected documents excluded", () => {
    expect(GUIDE_PAGES.every((page) => page.category !== "developer")).toBe(
      true,
    );
    for (const page of GUIDE_PAGES) {
      const doc = compileDocument(page);
      const ids = collect(doc.nodes).flatMap((node) =>
        node.type === "element" && node.attributes.id
          ? [node.attributes.id]
          : [],
      );
      for (const heading of page.headings) {
        if (heading.id === "purpose-title") continue;
        expect(ids, `${page.id}#${heading.id}`).toContain(heading.id);
      }
    }
  });

  it("registers every Sayflow component and renders the complete showcase", () => {
    const components = createDocComponents({
      pageHref: (p) => p.id,
      assetHref: (p) => p,
      displayAssetHref: (p) => p,
    });
    for (const name of Object.keys(contract))
      expect(components[name], name).toBeDefined();
    // Mermaid behavior is checked in a real browser; avoid jsdom's missing SVG layout APIs.
    const showcase = PAGE_BY_ID.get("docs-reading")!;
    const source = showcase.markdown.replace(/```mermaid[\s\S]*?```/, "");
    const { container } = render(
      <DocumentRenderer
        document={compileDocument(article(source, showcase.data))}
      />,
    );
    expect(container.querySelectorAll(".guide-step-number")).toHaveLength(2);
    expect(container.querySelector(".guide-step-number")?.textContent).toBe(
      "1",
    );
    expect(screen.getAllByRole("note")).toHaveLength(3);
    expect(container.querySelectorAll(".guide-card")).toHaveLength(2);
    expect(container.querySelectorAll(".guide-example-panel")).toHaveLength(2);
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(screen.getByRole("img", { name: "文件库界面" })).toHaveAttribute(
      "src",
      "/docs/files-library.jpg",
    );
    expect(screen.getByRole("table")).toHaveTextContent("左侧导航");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps Markdown headings, GFM tables and exact code text, including embedded backticks", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    const page = article(
      '# 旧正文\n## 标题 {#stable}\n\n| 字段 | 值 |\n| --- | --- |\n| key | value |\n\n````python\nprint("```")\n````',
    );
    page.componentSyntax = false;
    render(<DocumentRenderer document={compileDocument(page)} />);
    expect(screen.getByRole("heading", { name: "标题" })).toHaveAttribute(
      "id",
      "stable",
    );
    expect(screen.getByRole("table")).toHaveTextContent("value");
    fireEvent.click(screen.getByRole("button", { name: "复制代码" }));
    expect(await screen.findByRole("button", { name: "已复制" })).toBeVisible();
    expect(writeText).toHaveBeenCalledWith('print("```")');
    vi.unstubAllGlobals();
  });

  it("preserves multiline component anchors and normal headings after components", () => {
    const page = article(
      "# 示例\n\n<Section\n id='details'\n title=\"具体步骤\"\n>\n\n内容。\n\n</Section>\n\n## 后续 {#next}",
    );
    expect(page.headings.map((h) => h.id)).toEqual(["示例", "details", "next"]);
    render(<DocumentRenderer document={compileDocument(page)} />);
    expect(screen.getByRole("heading", { name: "具体步骤" })).toHaveAttribute(
      "id",
      "details",
    );
    expect(screen.getByRole("heading", { name: "后续" })).toHaveAttribute(
      "id",
      "next",
    );
  });

  it.each([
    "<script>alert(1)</script>",
    '<Lead onClick="alert(1)" />',
    "<Lead>{window.location}</Lead>",
    'import x from "unsafe"\n\n# 标题',
    '<CardGroup><Card title="链接" href="javascript:alert(1)" /></CardGroup>',
    "<Lead {...props} />",
    '<Step title="游离步骤" />',
    '<Steps><Step title="步骤" /><Lead>混用</Lead></Steps>',
    "<CardGroup><Lead>错误子项</Lead></CardGroup>",
    '<FieldGroup><Field name="key" required="yes" /></FieldGroup>',
    "<Formula />",
    '<DataCode source="missing" />',
    '<DataTable source="missing" />',
  ])("rejects executable or invalid component content: %s", (source) => {
    expect(() => compileDocument(article(source))).toThrow();
  });

  it("rejects malformed table metadata and renders operation references from the SDK map", () => {
    expect(() =>
      compileDocument(
        article('<DataTable source="table" />', {
          table: { headings: ["列"], rows: [["太", "多"]] },
        }),
      ),
    ).toThrow(/列数一致/);
    render(
      <DocumentRenderer
        document={compileDocument(
          article('<ApiOperations ids="presentation.create_project" />'),
        )}
      />,
    );
    expect(screen.getByRole("table")).toHaveTextContent(
      "POST /v1/presentation-workshop/projects",
    );
    expect(screen.getByRole("link", { name: "查看接口" })).toHaveAttribute(
      "href",
      "/docs.html?page=sdk-reference-presentation#create-project",
    );
  });
});
