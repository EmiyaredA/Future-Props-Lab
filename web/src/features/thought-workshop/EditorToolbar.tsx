import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Undo2,
  Redo2,
  Link,
  ImagePlus,
  Table2,
  Paperclip,
  RemoveFormatting,
} from "lucide-react";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";

export function EditorToolbar({
  editor,
  onImage,
  onAttachment,
  onLink,
  onMath,
}: {
  editor: Editor;
  onImage: () => void;
  onAttachment: () => void;
  onLink: () => void;
  onMath: (inline: boolean) => void;
}) {
  const tools = [
    {
      label: "粗体",
      icon: Bold,
      active: "bold",
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: "斜体",
      icon: Italic,
      active: "italic",
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: "下划线",
      icon: Underline,
      active: "underline",
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      label: "删除线",
      icon: Strikethrough,
      active: "strike",
      run: () => editor.chain().focus().toggleStrike().run(),
    },
  ];
  const insert = (value: string) => {
    const chain = editor.chain().focus();
    if (value === "table")
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    if (value === "bullet") chain.toggleBulletList().run();
    if (value === "ordered") chain.toggleOrderedList().run();
    if (value === "task") chain.toggleTaskList().run();
    if (value === "quote") chain.toggleBlockquote().run();
    if (value === "code") chain.toggleCodeBlock().run();
    if (value === "rule") chain.setHorizontalRule().run();
    if (value === "details")
      chain
        .insertContent({
          type: "details",
          attrs: { open: true },
          content: [
            {
              type: "detailsSummary",
              content: [{ type: "text", text: "折叠标题" }],
            },
            { type: "detailsContent", content: [{ type: "paragraph" }] },
          ],
        })
        .run();
    if (value === "math") onMath(false);
    if (value === "inlineMath") onMath(true);
    if (value === "mermaid") chain.insertContent({ type: "mermaid" }).run();
  };
  return (
    <div
      className="thought-toolbar"
      role="group"
      aria-label="排版工具栏"
      onMouseDown={(event) => {
        if ((event.target as HTMLElement).closest("button"))
          event.preventDefault();
      }}
    >
      <div className="thought-tool-group" role="group" aria-label="段落">
        <CustomSelect
          ariaLabel="段落样式"
          value={
            editor.isActive("heading")
              ? String(editor.getAttributes("heading").level)
              : "0"
          }
          options={[
            { value: "0", label: "正文" },
            ...[1, 2, 3, 4, 5, 6].map((n) => ({
              value: String(n),
              label: `标题 ${n}`,
            })),
          ]}
          onChange={(v) =>
            v === "0"
              ? editor.chain().focus().setParagraph().run()
              : editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: Number(v) as 1 | 2 | 3 | 4 | 5 | 6 })
                  .run()
          }
        />
      </div>
      <div className="thought-tool-group" role="group" aria-label="文字格式">
        {tools.map((t) => (
          <button
            key={t.label}
            title={t.label}
            aria-label={t.label}
            aria-pressed={editor.isActive(t.active)}
            onClick={t.run}
          >
            <t.icon size={16} />
          </button>
        ))}
        <CustomSelect
          ariaLabel="字号"
          value={editor.getAttributes("textStyle").fontSize || ""}
          options={[
            { value: "", label: "字号" },
            ...[12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 60, 72].map((n) => ({
              value: `${n}px`,
              label: `${n}`,
            })),
          ]}
          onChange={(v) =>
            v
              ? editor.chain().focus().setFontSize(v).run()
              : editor.chain().focus().unsetFontSize().run()
          }
        />
      </div>
      <div
        className="thought-tool-group thought-tool-colors"
        role="group"
        aria-label="颜色"
      >
        <CustomColorPicker
          compact
          ariaLabel="文字颜色"
          value={editor.getAttributes("textStyle").color || "#e57b59"}
          onChange={(v) => editor.chain().focus().setColor(v).run()}
        />
        <CustomColorPicker
          compact
          ariaLabel="文字高亮"
          value={editor.getAttributes("highlight").color || "#edc36c"}
          onChange={(v) =>
            editor.chain().focus().toggleHighlight({ color: v }).run()
          }
        />
      </div>
      <div className="thought-tool-group" role="group" aria-label="对齐">
        <CustomSelect
          ariaLabel="文字对齐"
          value={
            editor.getAttributes("paragraph").textAlign ||
            editor.getAttributes("heading").textAlign ||
            "left"
          }
          options={[
            { value: "left", label: "左对齐" },
            { value: "center", label: "居中" },
            { value: "right", label: "右对齐" },
            { value: "justify", label: "两端对齐" },
          ]}
          onChange={(v) => editor.chain().focus().setTextAlign(v).run()}
        />
      </div>
      <div
        className="thought-tool-group thought-tool-insert"
        role="group"
        aria-label="插入"
      >
        <button
          aria-label="插入表格"
          title="插入 3×3 表格"
          onClick={() => insert("table")}
        >
          <Table2 size={16} />
          表格
        </button>
        <button
          aria-label="插入附件"
          title="PDF、Word、Excel、PPT、TXT、Markdown、CSV、JSON、ZIP；默认单文件 200 MiB，服务端配置为准"
          onClick={onAttachment}
        >
          <Paperclip size={16} />
          附件
        </button>
        <button aria-label="添加链接" title="添加链接" onClick={onLink}>
          <Link size={16} />
          链接
        </button>
        <button aria-label="插入图片" title="插入图片" onClick={onImage}>
          <ImagePlus size={16} />
          图片
        </button>
        <CustomSelect
          ariaLabel="插入内容"
          value=""
          options={[
            { value: "", label: "插入…" },
            ...Object.entries({
              table: "表格",
              bullet: "项目列表",
              ordered: "编号列表",
              task: "待办清单",
              quote: "引用",
              code: "代码块",
              details: "折叠段落",
              rule: "分隔线",
              inlineMath: "行内公式",
              math: "独立公式",
              mermaid: "Mermaid 图表",
            }).map(([value, label]) => ({ value, label })),
          ]}
          onChange={insert}
        />
        {editor.isActive("table") && (
          <CustomSelect
            ariaLabel="表格操作"
            value=""
            options={[
              { value: "", label: "表格…" },
              ...Object.entries({
                addRowAfter: "添加行",
                deleteRow: "删除行",
                addColumnAfter: "添加列",
                deleteColumn: "删除列",
                mergeCells: "合并单元格",
                splitCell: "拆分单元格",
                deleteTable: "删除表格",
              }).map(([value, label]) => ({ value, label })),
            ]}
            onChange={(v) => {
              const c = editor.chain().focus();
              if (v === "addRowAfter") c.addRowAfter().run();
              if (v === "deleteRow") c.deleteRow().run();
              if (v === "addColumnAfter") c.addColumnAfter().run();
              if (v === "deleteColumn") c.deleteColumn().run();
              if (v === "mergeCells") c.mergeCells().run();
              if (v === "splitCell") c.splitCell().run();
              if (v === "deleteTable") c.deleteTable().run();
            }}
          />
        )}
      </div>
      <div className="thought-tool-group" role="group" aria-label="编辑历史">
        <button
          title="清除文字格式"
          aria-label="清除文字格式"
          onClick={() => editor.chain().focus().unsetAllMarks().run()}
        >
          <RemoveFormatting size={16} />
        </button>
        <button
          aria-label="撤销"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 size={16} />
        </button>
        <button
          aria-label="重做"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 size={16} />
        </button>
      </div>
    </div>
  );
}
