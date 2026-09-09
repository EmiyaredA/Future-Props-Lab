import { encodedFilePath } from "./archiveFiles";
import type { JSONContent } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import Image from "@tiptap/extension-image";
import { editorExtensions } from "./editorExtensions";

const manager = () =>
  new MarkdownManager({
    extensions: [
      ...editorExtensions().filter(
        (e) => !["image", "mermaid", "attachment"].includes(e.name),
      ),
      Image,
    ],
  });
export function parseMarkdown(
  text: string,
  allowRelativeFiles = false,
): JSONContent {
  const doc = manager().parse(text);
  const visit = (node: JSONContent): JSONContent => {
    if (node.type === "codeBlock" && node.attrs?.language === "mermaid") {
      return {
        type: "mermaid",
        attrs: {
          source: (node.content || []).map((n) => n.text || "").join(""),
        },
      };
    }
    const copy = {
      ...node,
      ...(node.content ? { content: node.content.map(visit) } : {}),
    };
    if (copy.marks)
      copy.marks = copy.marks.filter(
        (m) =>
          m.type !== "link" ||
          (allowRelativeFiles &&
            !/^(?:[a-z][a-z0-9+.-]*:|\/|\\)/i.test(String(m.attrs?.href))) ||
          /^(https?:|mailto:)/i.test(String(m.attrs?.href)),
      );
    return copy;
  };
  return visit(doc);
}

export function markdownWarnings(doc: JSONContent): string[] {
  const warnings = new Set<string>();
  const visit = (node: JSONContent) => {
    if (
      node.marks?.some((m) =>
        ["textStyle", "highlight", "underline"].includes(m.type),
      )
    )
      warnings.add("文字颜色、字号、高亮与下划线将转换为普通文字。");
    if (node.attrs?.textAlign && node.attrs.textAlign !== "left")
      warnings.add("段落对齐样式将省略。");
    if (
      ["tableCell", "tableHeader"].includes(node.type || "") &&
      (Number(node.attrs?.colspan || 1) > 1 ||
        Number(node.attrs?.rowspan || 1) > 1)
    )
      warnings.add("合并单元格将展开为普通表格，建议另存完整备份。");
    if (node.type === "details") warnings.add("折叠段落将展开为正文。");
    if (node.type === "image") {
      warnings.add("图片保留在附件中，尺寸、裁剪与对齐将省略。");
      if (node.attrs?.caption)
        warnings.add("图片图注将导出为图片下方的普通文字。");
    }
    node.content?.forEach(visit);
  };
  visit(doc);
  return [...warnings];
}
export function toMarkdown(
  doc: JSONContent,
  imagePaths: Record<string, string>,
): string {
  const tokens: Record<string, string> = {};
  let index = 0;
  const walk = (node: JSONContent): JSONContent => {
    if (node.type === "attachment") {
      const token = `THOUGHTEXPORT${index++}TOKEN`;
      const name = String(node.attrs?.filename || "附件").replace(
        /[\\[\]]/g,
        "\\$&",
      );
      const path = imagePaths[String(node.attrs?.assetId)] || "";
      tokens[token] = `[${name}](${encodedFilePath(path)})`;
      return { type: "paragraph", content: [{ type: "text", text: token }] };
    }
    if (node.type === "image") {
      const token = `THOUGHTEXPORT${index++}TOKEN`;
      const alt = String(node.attrs?.alt || "").replace(/[\\[\]]/g, "\\$&");
      const path = encodedFilePath(
        imagePaths[String(node.attrs?.assetId)] || "",
      );
      const caption = String(node.attrs?.caption || "").trim();
      tokens[token] = caption
        ? `![${alt}](${path})\n\n*${caption.replace(/\*/g, "\\*")}*`
        : `![${alt}](${path})`;
      return { type: "paragraph", content: [{ type: "text", text: token }] };
    }
    if (["inlineMath", "blockMath", "mermaid"].includes(node.type || "")) {
      const token = `THOUGHTEXPORT${index++}TOKEN`;
      tokens[token] =
        node.type === "mermaid"
          ? `\n\`\`\`mermaid\n${node.attrs?.source || ""}\n\`\`\`\n`
          : node.type === "blockMath"
            ? `\n$$\n${node.attrs?.latex || ""}\n$$\n`
            : `$${node.attrs?.latex || ""}$`;
      return node.type === "inlineMath"
        ? { type: "text", text: token }
        : { type: "paragraph", content: [{ type: "text", text: token }] };
    }
    const content = node.content?.flatMap((child) =>
      child.type === "details"
        ? (child.content || []).flatMap((c) =>
            c.type === "detailsContent"
              ? (c.content || []).map(walk)
              : [walk({ ...c, type: "paragraph" })],
          )
        : [walk(child)],
    );
    return { ...node, ...(content ? { content } : {}) };
  };
  let result = manager().serialize(walk(doc));
  for (const [key, value] of Object.entries(tokens))
    result = result.replaceAll(key, value);
  return result;
}
