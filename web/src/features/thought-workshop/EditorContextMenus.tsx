import type { Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { TextSelection } from "@tiptap/pm/state";
import {
  Bold,
  Columns3,
  Italic,
  Link,
  Rows3,
  Strikethrough,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
  Underline,
  Unlink,
} from "lucide-react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomSelect } from "@shared/ui/CustomSelect";

function keepSelection(event: React.MouseEvent) {
  if ((event.target as HTMLElement).closest("button")) event.preventDefault();
}

const TEXT_MENU_OPTIONS = { placement: "top", offset: 8 } as const;
const TABLE_MENU_OPTIONS = { placement: "top", offset: 10 } as const;
const showTextMenu = ({
  state,
  editor,
}: Parameters<
  NonNullable<React.ComponentProps<typeof BubbleMenu>["shouldShow"]>
>[0]) =>
  state.selection instanceof TextSelection &&
  !state.selection.empty &&
  !editor.isActive("image") &&
  !editor.isActive("attachment") &&
  !editor.isActive("table");
const showTableMenu = ({
  editor,
}: Parameters<
  NonNullable<React.ComponentProps<typeof BubbleMenu>["shouldShow"]>
>[0]) => editor.isActive("table");

export function EditorContextMenus({
  editor,
  onLink,
}: {
  editor: Editor;
  onLink: () => void;
}) {
  const markButtons = [
    {
      name: "bold",
      label: "粗体",
      icon: Bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      name: "italic",
      label: "斜体",
      icon: Italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      name: "underline",
      label: "下划线",
      icon: Underline,
      run: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      name: "strike",
      label: "删除线",
      icon: Strikethrough,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
  ];
  return (
    <>
      <BubbleMenu
        editor={editor}
        pluginKey="thoughtTextMenu"
        className="thought-text-menu"
        options={TEXT_MENU_OPTIONS}
        shouldShow={showTextMenu}
        onMouseDown={keepSelection}
      >
        <CustomSelect
          ariaLabel="段落样式"
          value={
            editor.isActive("heading")
              ? String(editor.getAttributes("heading").level)
              : "0"
          }
          options={[
            { value: "0", label: "正文" },
            ...[1, 2, 3, 4, 5, 6].map((level) => ({
              value: String(level),
              label: `标题 ${level}`,
            })),
          ]}
          onChange={(value) =>
            value === "0"
              ? editor.chain().focus().setParagraph().run()
              : editor
                  .chain()
                  .focus()
                  .setHeading({ level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 })
                  .run()
          }
        />
        <span className="thought-context-divider" />
        {markButtons.map((tool) => (
          <button
            key={tool.name}
            type="button"
            title={tool.label}
            aria-label={tool.label}
            aria-pressed={editor.isActive(tool.name)}
            onClick={tool.run}
          >
            <tool.icon size={16} />
          </button>
        ))}
        <CustomSelect
          ariaLabel="字号"
          value={editor.getAttributes("textStyle").fontSize || ""}
          options={[
            { value: "", label: "字号" },
            ...[12, 14, 16, 18, 20, 24, 28, 32, 40, 48, 60, 72].map((size) => ({
              value: `${size}px`,
              label: `${size}`,
            })),
          ]}
          onChange={(value) =>
            value
              ? editor.chain().focus().setFontSize(value).run()
              : editor.chain().focus().unsetFontSize().run()
          }
        />
        <CustomColorPicker
          compact
          ariaLabel="文字颜色"
          value={editor.getAttributes("textStyle").color || "#E57B59"}
          onChange={(value) => editor.chain().focus().setColor(value).run()}
        />
        <CustomColorPicker
          compact
          ariaLabel="文字高亮"
          value={editor.getAttributes("highlight").color || "#EDC36C"}
          onChange={(value) =>
            editor.chain().focus().toggleHighlight({ color: value }).run()
          }
        />
        <span className="thought-context-divider" />
        <button
          type="button"
          title="添加链接"
          aria-label="添加链接"
          onClick={onLink}
        >
          <Link size={16} />
        </button>
        <button
          type="button"
          title="移除链接"
          aria-label="移除链接"
          disabled={!editor.isActive("link")}
          onClick={() => editor.chain().focus().unsetLink().run()}
        >
          <Unlink size={16} />
        </button>
        <button
          type="button"
          className="thought-clear-format"
          onClick={() => editor.chain().focus().unsetAllMarks().run()}
        >
          清除格式
        </button>
      </BubbleMenu>
      <BubbleMenu
        editor={editor}
        pluginKey="thoughtTableMenu"
        className="thought-table-menu"
        options={TABLE_MENU_OPTIONS}
        shouldShow={showTableMenu}
        onMouseDown={keepSelection}
      >
        <button
          type="button"
          onClick={() => editor.chain().focus().addRowAfter().run()}
        >
          <Rows3 size={16} />
          添加行
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().deleteRow().run()}
        >
          <Rows3 size={16} />
          删除行
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().addColumnAfter().run()}
        >
          <Columns3 size={16} />
          添加列
        </button>
        <button
          type="button"
          onClick={() => editor.chain().focus().deleteColumn().run()}
        >
          <Columns3 size={16} />
          删除列
        </button>
        <button
          type="button"
          disabled={!editor.can().mergeCells()}
          onClick={() => editor.chain().focus().mergeCells().run()}
        >
          <TableCellsMerge size={16} />
          合并
        </button>
        <button
          type="button"
          disabled={!editor.can().splitCell()}
          onClick={() => editor.chain().focus().splitCell().run()}
        >
          <TableCellsSplit size={16} />
          拆分
        </button>
        <button
          type="button"
          className="is-danger"
          onClick={() => editor.chain().focus().deleteTable().run()}
        >
          <Trash2 size={16} />
          删除表格
        </button>
      </BubbleMenu>
    </>
  );
}
