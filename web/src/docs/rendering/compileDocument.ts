/** Sayflow's Markdown → inert document tree boundary, adapted for existing FPL Markdown. */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkMath from "remark-math";
import { toHast } from "mdast-util-to-hast";
import contract from "./componentContract.json";
import type { GuidePage } from "../types";
import type { DocDocument, DocNode } from "./types";

interface Ast {
  type: string;
  name?: string;
  tagName?: string;
  value?: string;
  url?: string;
  depth?: number;
  children?: Ast[];
  attributes?: { type: string; name: string; value: unknown }[];
  properties?: Record<string, unknown>;
  data?: { hProperties?: Record<string, unknown> };
}
interface Rule {
  attributes: string[];
  required?: string[];
  enums?: Record<string, string[]>;
  parent?: string;
  child?: string;
}
const rules: Record<string, Rule> = contract;
const plain = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const structured = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(remarkMdx);
export function safeDocUrl(value: string) {
  return !/^(?:javascript|vbscript|data|file):/i.test(
    value
      .split("")
      .filter((char) => char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127)
      .join(""),
  );
}
function textOf(node: Ast): string {
  return node.value || (node.children || []).map(textOf).join("");
}
function validate(
  node: Ast,
  metadata: Record<string, unknown>,
  parent?: Ast,
): void {
  if (
    ["mdxjsEsm", "mdxFlowExpression", "mdxTextExpression"].includes(node.type)
  )
    throw new Error(
      "文档只支持静态组件，不允许 import、export 或 JavaScript 表达式",
    );
  if (node.url && !safeDocUrl(node.url))
    throw new Error("文档链接协议不受支持");
  if (node.type.startsWith("mdxJsx")) {
    const rule = rules[node.name || ""];
    if (!rule) throw new Error(`未注册的文档组件：${node.name}`);
    if (rule.parent && parent?.name !== rule.parent)
      throw new Error(`${node.name} 必须直接放在 ${rule.parent} 内`);
    const children = (node.children || []).filter(
      (child) => child.type !== "text" || child.value?.trim(),
    );
    if (
      rule.child &&
      (!children.length || children.some((child) => child.name !== rule.child))
    )
      throw new Error(`${node.name} 只接受 ${rule.child} 子组件`);
    if (
      node.name === "Steps" &&
      children.some((child) => child.name === "Step") &&
      children.some((child) => child.name !== "Step")
    )
      throw new Error("Step 不能与其他步骤内容混用");
    const seen = new Set<string>();
    for (const attr of node.attributes || []) {
      if (
        attr.type !== "mdxJsxAttribute" ||
        typeof attr.value !== "string" ||
        !rule.attributes.includes(attr.name) ||
        seen.has(attr.name)
      )
        throw new Error(`${node.name} 的属性必须是白名单中的唯一字符串字面量`);
      seen.add(attr.name);
      if (
        rule.enums?.[attr.name] &&
        !rule.enums[attr.name].includes(attr.value)
      )
        throw new Error(`${node.name}.${attr.name} 的值不受支持`);
      if (["src", "href"].includes(attr.name) && !safeDocUrl(attr.value))
        throw new Error("文档链接协议不受支持");
      if ((rule.required || []).includes(attr.name) && !attr.value.trim())
        throw new Error(`${node.name}.${attr.name} 不能为空`);
    }
    for (const name of rule.required || [])
      if (!seen.has(name)) throw new Error(`${node.name} 缺少 ${name}`);
    const source = node.attributes?.find(
      (attr) => attr.name === "source",
    )?.value;
    const value =
      typeof source === "string" && Object.hasOwn(metadata, source)
        ? metadata[source]
        : undefined;
    if (node.name === "DataCode" && typeof value !== "string")
      throw new Error(`DataCode.${source} 必须引用字符串数据`);
    if (node.name === "DataTable") {
      const table = value as { headings?: unknown; rows?: unknown } | undefined;
      const strings = (row: unknown): row is string[] =>
        Array.isArray(row) && row.every((cell) => typeof cell === "string");
      if (
        !table ||
        !strings(table.headings) ||
        !table.headings.length ||
        !Array.isArray(table.rows) ||
        table.rows.some(
          (row) =>
            !strings(row) || row.length !== (table.headings as string[]).length,
        )
      )
        throw new Error(`DataTable.${source} 必须引用列数一致的字符串表格`);
    }
  }
  for (const child of node.children || []) validate(child, metadata, node);
}

export function compileDocument(page: GuidePage): DocDocument {
  const parser = page.componentSyntax ? structured : plain;
  const tree = parser.parse(page.markdown) as Ast;
  validate(tree, page.data || {});
  let headingIndex = 0;
  const links: string[] = [],
    assets: string[] = [];
  function prepare(node: Ast) {
    if (node.type === "heading" && (node.depth || 0) <= 3) {
      const heading = page.headings[headingIndex++];
      node.data = {
        hProperties: {
          id: heading?.id,
          tabIndex: node.depth === 1 ? -1 : undefined,
        },
      };
    }
    if (
      node.type.startsWith("mdxJsx") &&
      ["Steps", "Purpose", "Section", "SectionGroup", "Subsection"].includes(
        node.name || "",
      )
    )
      headingIndex++;
    if (node.type === "link" && node.url) links.push(node.url);
    if (node.type === "image" && node.url) assets.push(node.url);
    for (const child of node.children || []) prepare(child);
  }
  prepare(tree);
  const hast = toHast(tree as Parameters<typeof toHast>[0], {
    passThrough: ["mdxJsxFlowElement", "mdxJsxTextElement"],
    handlers: {
      math: (_state, node) => ({
        type: "element",
        tagName: "Formula",
        properties: { source: textOf(node as Ast) },
        children: [],
      }),
      inlineMath: (_state, node) => ({
        type: "element",
        tagName: "InlineFormula",
        properties: { source: textOf(node as Ast) },
        children: [],
      }),
    },
  }) as Ast;
  function serialize(node: Ast): DocNode | null {
    if (node.type === "text") return { type: "text", value: node.value || "" };
    if (node.type !== "element" && !node.type.startsWith("mdxJsx")) return null;
    return {
      type: "element",
      name: node.tagName || node.name || "div",
      attributes:
        node.properties ||
        Object.fromEntries(
          (node.attributes || []).map((attr) => [attr.name, attr.value]),
        ),
      children: (node.children || [])
        .map(serialize)
        .filter((child): child is DocNode => child !== null),
    };
  }
  return {
    version: 1,
    metadata: { ...page.data, id: page.id, title: page.title },
    sourcePath: page.source,
    nodes: (hast.children || [])
      .map(serialize)
      .filter((node): node is DocNode => node !== null),
    headings: page.headings.map((h) => ({ ...h, slug: h.id })),
    links,
    assets,
    searchText: textOf(tree),
    markdown: page.markdown,
  };
}
