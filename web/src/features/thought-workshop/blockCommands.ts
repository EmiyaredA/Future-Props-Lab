import type { Editor } from "@tiptap/react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeRangeSelection } from "@tiptap/extension-node-range";
import { TextSelection } from "@tiptap/pm/state";
import { writeThoughtClipboard } from "./clipboard";

export type InsertCommandKey =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bullet"
  | "ordered"
  | "task"
  | "quote"
  | "code"
  | "details"
  | "rule"
  | "image"
  | "attachment"
  | "inlineMath"
  | "math"
  | "canvas"
  | "mermaid"
  | "table";

export type InsertCallbacks = {
  image: (position?: number) => void;
  attachment: (position?: number) => void;
  math: (inline: boolean, position?: number) => void;
};

export type InsertCommand = {
  key: InsertCommandKey;
  label: string;
  description: string;
  keywords: string;
  glyph: string;
};

export const INSERT_COMMANDS: InsertCommand[] = [
  {
    key: "paragraph",
    label: "正文",
    description: "普通文本段落",
    keywords: "text paragraph",
    glyph: "T",
  },
  {
    key: "heading1",
    label: "一级标题",
    description: "页面主标题",
    keywords: "h1 title",
    glyph: "H1",
  },
  {
    key: "heading2",
    label: "二级标题",
    description: "章节标题",
    keywords: "h2 title",
    glyph: "H2",
  },
  {
    key: "heading3",
    label: "三级标题",
    description: "小节标题",
    keywords: "h3 title",
    glyph: "H3",
  },
  {
    key: "bullet",
    label: "项目列表",
    description: "无序列表",
    keywords: "bullet list",
    glyph: "•",
  },
  {
    key: "ordered",
    label: "编号列表",
    description: "有序列表",
    keywords: "number list",
    glyph: "1.",
  },
  {
    key: "task",
    label: "待办清单",
    description: "可勾选任务",
    keywords: "todo task",
    glyph: "☑",
  },
  {
    key: "quote",
    label: "引用",
    description: "突出一段引用",
    keywords: "quote",
    glyph: "❝",
  },
  {
    key: "code",
    label: "代码块",
    description: "等宽代码区域",
    keywords: "code",
    glyph: "<>",
  },
  {
    key: "details",
    label: "折叠段落",
    description: "可展开的内容",
    keywords: "details fold",
    glyph: "▸",
  },
  {
    key: "rule",
    label: "分隔线",
    description: "分隔上下内容",
    keywords: "divider rule",
    glyph: "—",
  },
  {
    key: "image",
    label: "图片",
    description: "上传一张或多张图片",
    keywords: "image photo",
    glyph: "▧",
  },
  {
    key: "attachment",
    label: "附件",
    description: "上传文档或压缩包",
    keywords: "file attachment",
    glyph: "⌕",
  },
  {
    key: "inlineMath",
    label: "行内公式",
    description: "插入 LaTeX 行内公式",
    keywords: "math latex inline",
    glyph: "ƒ",
  },
  {
    key: "math",
    label: "独立公式",
    description: "插入 LaTeX 公式块",
    keywords: "math latex",
    glyph: "∑",
  },
  {
    key: "canvas",
    label: "画板",
    description: "绘制可编辑的技术信息图",
    keywords: "canvas board diagram 信息图",
    glyph: "▧",
  },
  {
    key: "mermaid",
    label: "Mermaid 图表",
    description: "使用文本描述图表",
    keywords: "diagram mermaid",
    glyph: "◇",
  },
  {
    key: "table",
    label: "表格",
    description: "插入 3 × 3 表格",
    keywords: "table",
    glyph: "▦",
  },
];

function contentFor(key: InsertCommandKey) {
  if (key === "paragraph") return { type: "paragraph" };
  if (key.startsWith("heading"))
    return { type: "heading", attrs: { level: Number(key.slice(-1)) } };
  if (key === "bullet")
    return {
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
    };
  if (key === "ordered")
    return {
      type: "orderedList",
      content: [{ type: "listItem", content: [{ type: "paragraph" }] }],
    };
  if (key === "task")
    return {
      type: "taskList",
      content: [
        {
          type: "taskItem",
          attrs: { checked: false },
          content: [{ type: "paragraph" }],
        },
      ],
    };
  if (key === "quote")
    return { type: "blockquote", content: [{ type: "paragraph" }] };
  if (key === "code") return { type: "codeBlock" };
  if (key === "details")
    return {
      type: "details",
      attrs: { open: true },
      content: [
        {
          type: "detailsSummary",
          content: [{ type: "text", text: "折叠标题" }],
        },
        { type: "detailsContent", content: [{ type: "paragraph" }] },
      ],
    };
  if (key === "rule") return { type: "horizontalRule" };
  if (key === "canvas") return { type: "canvas" };
  if (key === "mermaid") return { type: "mermaid" };
  if (key === "table")
    return {
      type: "table",
      content: Array.from({ length: 3 }, (_, row) => ({
        type: "tableRow",
        content: Array.from({ length: 3 }, () => ({
          type: row === 0 ? "tableHeader" : "tableCell",
          content: [{ type: "paragraph" }],
        })),
      })),
    };
  return null;
}

export function runInsertCommand(
  editor: Editor,
  key: InsertCommandKey,
  callbacks: InsertCallbacks,
  position?: number,
  replaceRange?: { from: number; to: number },
) {
  // Slash replacement and block creation must reach React as one document update.
  // A NodeView can flush pending renders while the insertion is being dispatched.
  if (
    replaceRange &&
    ["image", "attachment", "inlineMath", "math"].includes(key)
  )
    editor.chain().focus().deleteRange(replaceRange).run();
  if (key === "image") return callbacks.image(position);
  if (key === "attachment") return callbacks.attachment(position);
  if (key === "inlineMath") return callbacks.math(true, position);
  if (key === "math") return callbacks.math(false, position);
  const content = contentFor(key);
  if (!content) return;
  const insertAt = Math.max(
    0,
    Math.min(
      position ?? editor.state.selection.to,
      editor.state.doc.content.size,
    ),
  );
  editor
    .chain()
    .focus()
    .insertContentAt(replaceRange ?? insertAt, content, {
      updateSelection: true,
    })
    .run();
}

export function selectBlockAt(
  editor: Editor,
  pos: number,
  node: ProseMirrorNode,
) {
  const start = Math.max(0, Math.min(pos, editor.state.doc.content.size));
  const end = Math.max(
    start,
    Math.min(pos + node.nodeSize, editor.state.doc.content.size),
  );
  editor.view.dispatch(
    editor.state.tr.setSelection(
      NodeRangeSelection.create(editor.state.doc, start, end),
    ),
  );
}

export async function copyBlockSelection(
  editor: Editor,
  sourceScopeId?: string,
) {
  await writeThoughtClipboard(editor, sourceScopeId);
}

export function deleteBlockSelection(editor: Editor) {
  const { from, to } = editor.state.selection;
  const tr = editor.state.tr.delete(from, to);
  if (!tr.doc.childCount) tr.insert(0, editor.schema.nodes.paragraph.create());
  tr.setSelection(
    TextSelection.near(tr.doc.resolve(Math.min(from, tr.doc.content.size))),
  );
  editor.view.dispatch(tr.scrollIntoView());
  editor.commands.focus();
}

export function clearBlockSelection(editor: Editor) {
  const position = Math.min(
    editor.state.selection.from + 1,
    editor.state.doc.content.size,
  );
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.near(editor.state.doc.resolve(position)),
    ),
  );
}

export function moveSelectedBlock(editor: Editor, direction: -1 | 1) {
  const { selection, doc } = editor.state;
  const from = selection.from;
  const to = selection.to;
  const $from = doc.resolve(from);
  const depth = Math.max(0, $from.depth - ($from.parent.isTextblock ? 1 : 0));
  const parent = $from.node(depth);
  const parentStart = depth === 0 ? 0 : $from.start(depth);
  let before: { pos: number; size: number } | null = null;
  let after: { pos: number; size: number } | null = null;
  parent.forEach((node, offset) => {
    const pos = parentStart + offset;
    if (pos + node.nodeSize <= from) before = { pos, size: node.nodeSize };
    if (!after && pos >= to) after = { pos, size: node.nodeSize };
  });
  const sibling = (direction < 0 ? before : after) as {
    pos: number;
    size: number;
  } | null;
  if (!sibling) return false;
  const slice = doc.slice(from, to).content;
  const tr = editor.state.tr.delete(from, to);
  const insertAt =
    direction < 0 ? sibling.pos : sibling.pos + sibling.size - (to - from);
  tr.insert(insertAt, slice);
  tr.setSelection(
    NodeRangeSelection.create(tr.doc, insertAt, insertAt + slice.size),
  );
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
