import type { Root } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { OfficialDocumentSummary } from "./catalog";

const sources = import.meta.glob<string>("./content/**/*.md", {
  query: "?raw",
  import: "default",
});
export function loadOfficialDocument(document: OfficialDocumentSummary) {
  const load = sources[document.source];
  if (!load)
    return Promise.reject(new Error("官方文档资源缺失，请检查应用版本。"));
  return load();
}
export type OfficialHeading = { id: string; title: string; level: number };
export function officialHeadings(markdown: string): OfficialHeading[] {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  return tree.children.flatMap((node) => {
    if (node.type !== "heading") return [];
    const text = (item: {
      type: string;
      value?: string;
      children?: typeof node.children;
    }): string => item.value ?? item.children?.map(text).join("") ?? "";
    return [
      {
        id: `section-${node.position?.start.offset ?? 0}`,
        title: text(node),
        level: node.depth,
      },
    ];
  });
}

/** Recognize a small Markdown vocabulary; source HTML remains disabled. */
export function remarkOfficialCallouts() {
  return (tree: Root) => {
    const walk = (node: Root | Root["children"][number]) => {
      if (node.type === "blockquote") {
        const paragraph = node.children[0];
        const first =
          paragraph?.type === "paragraph" ? paragraph.children[0] : undefined;
        const marker =
          first?.type === "text" &&
          /^\[!(NOTE|TIP|WARNING)\](?:\s*\n|$)/.exec(first.value);
        if (marker && first?.type === "text") {
          first.value = first.value.slice(marker[0].length);
          node.data = {
            ...node.data,
            hProperties: { "data-official-callout": marker[1].toLowerCase() },
          };
        }
      }
      if ("children" in node)
        for (const child of node.children) {
          if ("children" in child) walk(child as Root["children"][number]);
        }
    };
    walk(tree);
  };
}
