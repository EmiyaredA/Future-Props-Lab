import { useDocumentAccess } from "./DocumentAccess";
import { useEffect, useRef, useState, type RefObject } from "react";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { NestedOptions } from "@tiptap/extension-drag-handle";
import {
  isNodeRangeSelection,
  NodeRangeSelection,
} from "@tiptap/extension-node-range";
import type { Selection } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  Plus,
  Redo2,
  RemoveFormatting,
  Trash2,
  Undo2,
} from "lucide-react";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import { CustomSelect } from "@shared/ui/CustomSelect";
import { BlockInsertMenu } from "./BlockInsertMenu";
import { findMarqueeTargets, isGutterPointer } from "./blockSelection";
import {
  clearBlockSelection,
  copyBlockSelection,
  deleteBlockSelection,
  moveSelectedBlock,
  runInsertCommand,
  selectBlockAt,
  type InsertCallbacks,
} from "./blockCommands";

type ActiveBlock = { node: ProseMirrorNode; pos: number } | null;
type OpenMenu = "block" | "insert" | null;

const DRAG_POSITION = { placement: "left-start", strategy: "fixed" } as const;
const DRAG_NESTED: NestedOptions = {
  defaultRules: false,
  edgeDetection: "left",
  rules: [
    {
      id: "top-level-or-list-item",
      evaluate: ({ depth, node }) =>
        depth === 1 || ["listItem", "taskItem"].includes(node.type.name)
          ? 0
          : 1000,
    },
  ],
};

const BLOCK_LABELS: Record<string, string> = {
  paragraph: "正文",
  heading: "标题",
  bulletList: "列表",
  orderedList: "编号",
  taskList: "待办",
  listItem: "列表项",
  taskItem: "待办项",
  blockquote: "引用",
  codeBlock: "代码",
  horizontalRule: "分隔线",
  image: "图片",
  attachment: "附件",
  table: "表格",
  details: "折叠",
  mathBlock: "公式",
  mermaid: "图表",
  canvas: "画板",
  documentCard: "文档卡片",
  cardGrid: "卡片组",
  documentDirectory: "文档目录",
  callout: "提示块",
};

function blockLabel(block: ActiveBlock) {
  if (!block) return "块";
  if (block.node.type.name === "heading") return `H${block.node.attrs.level}`;
  return BLOCK_LABELS[block.node.type.name] ?? "块";
}

function selectionContainsBlock(
  selection: Selection,
  block: NonNullable<ActiveBlock>,
) {
  return (
    isNodeRangeSelection(selection) &&
    selection.ranges.some(
      (range) => block.pos >= range.$from.pos && block.pos < range.$to.pos,
    )
  );
}

function findScrollParent(element: HTMLElement) {
  let current = element.parentElement;
  while (current) {
    const style = getComputedStyle(current);
    if (
      /(auto|scroll)/.test(style.overflowY) &&
      current.scrollHeight > current.clientHeight
    )
      return current;
    current = current.parentElement;
  }
  return document.scrollingElement as HTMLElement | null;
}

function useGutterMarquee(
  editor: Editor,
  canvas: RefObject<HTMLDivElement | null>,
  disabled: boolean,
) {
  const [rect, setRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  useEffect(() => {
    const surface = canvas.current;
    if (!surface || disabled) return;
    let start: { x: number; y: number } | null = null;
    let last: { x: number; y: number } | null = null;
    const updateSelection = () => {
      if (!start || !last) return;
      const prose = surface.querySelector<HTMLElement>(".thought-prose");
      if (!prose) return;
      const box = {
        left: Math.min(start.x, last.x),
        top: Math.min(start.y, last.y),
        right: Math.max(start.x, last.x),
        bottom: Math.max(start.y, last.y),
      };
      const hits = findMarqueeTargets(prose, start.y, last.y, box);
      if (!hits.length) return;
      const positions = hits
        .map((node) => {
          try {
            const pos = editor.view.posAtDOM(node, 0);
            return { pos, node: editor.state.doc.nodeAt(pos) };
          } catch {
            return null;
          }
        })
        .filter(
          (item): item is { pos: number; node: ProseMirrorNode } =>
            !!item?.node,
        )
        .sort((a, b) => a.pos - b.pos);
      if (!positions.length) return;
      const from = positions[0].pos;
      const lastNode = positions[positions.length - 1];
      const to = Math.min(
        editor.state.doc.content.size,
        lastNode.pos + lastNode.node.nodeSize,
      );
      const selection = NodeRangeSelection.create(editor.state.doc, from, to);
      editor.view.dispatch(editor.state.tr.setSelection(selection));
    };
    const move = (event: PointerEvent) => {
      if (!start) return;
      last = { x: event.clientX, y: event.clientY };
      const bounds = surface.getBoundingClientRect();
      setRect({
        left: Math.min(start.x, last.x) - bounds.left,
        top: Math.min(start.y, last.y) - bounds.top + surface.scrollTop,
        width: Math.abs(start.x - last.x),
        height: Math.abs(start.y - last.y),
      });
      const scroller = findScrollParent(surface);
      if (scroller) {
        const scrollRect = scroller.getBoundingClientRect();
        if (event.clientY < scrollRect.top + 48) scroller.scrollTop -= 16;
        else if (event.clientY > scrollRect.bottom - 48)
          scroller.scrollTop += 16;
      }
      updateSelection();
    };
    const up = () => {
      if (!start || !last) return;
      if (
        Math.hypot(last.x - start.x, last.y - start.y) < 4 &&
        isNodeRangeSelection(editor.state.selection)
      )
        clearBlockSelection(editor);
      start = null;
      last = null;
      setRect(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    const down = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        (event.target instanceof Element &&
          event.target.closest(
            "button, input, [role='dialog'], .thought-insert-menu",
          )) ||
        window.innerWidth <= 700 ||
        !matchMedia("(pointer: fine)").matches
      )
        return;
      const prose = surface.querySelector<HTMLElement>(".thought-prose");
      if (!prose) return;
      const proseRect = prose.getBoundingClientRect();
      if (!isGutterPointer(proseRect, event.clientX)) return;
      event.preventDefault();
      start = { x: event.clientX, y: event.clientY };
      last = start;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    };
    const key = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        isNodeRangeSelection(editor.state.selection)
      )
        clearBlockSelection(editor);
    };
    surface.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => {
      surface.removeEventListener("pointerdown", down);
      document.removeEventListener("keydown", key);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [canvas, disabled, editor]);
  return rect;
}

function applyBlockType(editor: Editor, value: string) {
  const chain = editor.chain().focus();
  if (value === "paragraph") chain.setParagraph().run();
  else if (value.startsWith("heading"))
    chain
      .setHeading({ level: Number(value.slice(-1)) as 1 | 2 | 3 | 4 | 5 | 6 })
      .run();
  else if (value === "bullet") chain.toggleBulletList().run();
  else if (value === "ordered") chain.toggleOrderedList().run();
  else if (value === "task") chain.toggleTaskList().run();
  else if (value === "quote") chain.toggleBlockquote().run();
  else if (value === "code") chain.toggleCodeBlock().run();
}

function BlockMenu({
  editor,
  block,
  close,
  insert,
  onError,
  assetScopeId,
}: {
  editor: Editor;
  block: NonNullable<ActiveBlock>;
  close: () => void;
  insert: () => void;
  onError: (message: string) => void;
  assetScopeId?: string;
}) {
  const access = useDocumentAccess();
  const atomic =
    block.node.isAtom ||
    [
      "image",
      "attachment",
      "table",
      "horizontalRule",
      "mathBlock",
      "mermaid",
    ].includes(block.node.type.name);
  const typeValue = editor.isActive("heading")
    ? `heading${editor.getAttributes("heading").level}`
    : editor.isActive("bulletList")
      ? "bullet"
      : editor.isActive("orderedList")
        ? "ordered"
        : editor.isActive("taskList")
          ? "task"
          : editor.isActive("blockquote")
            ? "quote"
            : editor.isActive("codeBlock")
              ? "code"
              : "paragraph";
  return (
    <div
      className="thought-block-menu"
      role="dialog"
      aria-label="块操作"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <div className="thought-block-menu-title">
        <strong>{blockLabel(block)}</strong>
        <span>块操作</span>
      </div>
      {!atomic ? (
        <div className="thought-block-menu-controls">
          <span className="thought-block-field-label">块类型</span>
          <CustomSelect
            ariaLabel="转换块类型"
            value={typeValue}
            options={[
              { value: "paragraph", label: "正文" },
              ...[1, 2, 3, 4, 5, 6].map((level) => ({
                value: `heading${level}`,
                label: `标题 ${level}`,
              })),
              { value: "bullet", label: "项目列表" },
              { value: "ordered", label: "编号列表" },
              { value: "task", label: "待办清单" },
              { value: "quote", label: "引用" },
              { value: "code", label: "代码块" },
            ]}
            onChange={(value) => {
              applyBlockType(editor, value);
              close();
            }}
          />
          <span className="thought-block-field-label">对齐</span>
          <CustomSelect
            ariaLabel="块对齐"
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
            onChange={(value) =>
              editor.chain().focus().setTextAlign(value).run()
            }
          />
          <div className="thought-block-color-field">
            <span className="thought-block-field-label">文字颜色</span>
            <CustomColorPicker
              compact
              ariaLabel="块文字颜色"
              value={editor.getAttributes("textStyle").color || "#E57B59"}
              onChange={(value) => editor.chain().focus().setColor(value).run()}
            />
          </div>
          <div className="thought-block-color-field">
            <span className="thought-block-field-label">高亮颜色</span>
            <CustomColorPicker
              compact
              ariaLabel="块高亮颜色"
              value={editor.getAttributes("highlight").color || "#EDC36C"}
              onChange={(value) =>
                editor.chain().focus().toggleHighlight({ color: value }).run()
              }
            />
          </div>
        </div>
      ) : null}
      <div
        className="thought-block-actions"
        role="group"
        aria-label="块操作列表"
      >
        <button
          type="button"
          className="thought-mobile-only"
          onClick={() => moveSelectedBlock(editor, -1)}
        >
          <ChevronUp size={16} />
          上移
        </button>
        <button
          type="button"
          className="thought-mobile-only"
          onClick={() => moveSelectedBlock(editor, 1)}
        >
          <ChevronDown size={16} />
          下移
        </button>
        <button
          type="button"
          onClick={() => {
            void copyBlockSelection(editor, assetScopeId, access)
              .then(close)
              .catch((error: Error) => onError(error.message));
          }}
        >
          <Copy size={16} />
          复制
        </button>
        <button type="button" onClick={insert}>
          <Plus size={16} />
          在下方添加
        </button>
        {!atomic ? (
          <button
            type="button"
            onClick={() => editor.chain().focus().unsetAllMarks().run()}
          >
            <RemoveFormatting size={16} />
            清除格式
          </button>
        ) : null}
        <button
          type="button"
          className="is-danger"
          onClick={() => {
            deleteBlockSelection(editor);
            close();
          }}
        >
          <Trash2 size={16} />
          删除
        </button>
      </div>
      <div className="thought-block-history">
        <button
          type="button"
          aria-label="撤销"
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        >
          <Undo2 size={16} />
          撤销
        </button>
        <button
          type="button"
          aria-label="重做"
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        >
          <Redo2 size={16} />
          重做
        </button>
      </div>
    </div>
  );
}

export function BlockEditorChrome({
  editor,
  canvas,
  callbacks,
  onError,
  readOnly,
  assetScopeId,
}: {
  editor: Editor;
  canvas: RefObject<HTMLDivElement | null>;
  callbacks: InsertCallbacks;
  onError: (message: string) => void;
  readOnly: boolean;
  assetScopeId?: string;
}) {
  const access = useDocumentAccess();
  const [block, setBlock] = useState<ActiveBlock>(null);
  const [menu, setMenu] = useState<OpenMenu>(null);
  const [mobileMenu, setMobileMenu] = useState<OpenMenu>(null);
  const [mobileBlock, setMobileBlock] = useState<{
    node: ProseMirrorNode;
    pos: number;
    top: number;
  } | null>(null);
  const menuRoot = useRef<HTMLDivElement>(null);
  const mobileRoot = useRef<HTMLDivElement>(null);
  const selectionBeforeHandleClick = useRef<Selection | null>(null);
  const lastMultiBlockSelection = useRef<Selection | null>(null);
  const marquee = useGutterMarquee(editor, canvas, readOnly);
  const close = () => {
    setMenu(null);
    setMobileMenu(null);
  };
  useEffect(() => {
    editor.view.dispatch(
      editor.state.tr.setMeta("lockDragHandle", !!(menu || mobileMenu)),
    );
  }, [editor, menu, mobileMenu]);
  useEffect(() => {
    if (!menu && !mobileMenu) return;
    const outside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !menuRoot.current?.contains(target) &&
        !mobileRoot.current?.contains(target)
      )
        close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", key);
    };
  }, [menu, mobileMenu]);
  useEffect(() => {
    if (readOnly) return;
    const update = () => {
      const { $from } = editor.state.selection;
      let pos = 0;
      let node: ProseMirrorNode | null = null;
      if ($from.depth > 0) {
        pos = $from.before(1);
        node = $from.node(1);
      } else {
        const found = editor.state.doc.childAfter($from.pos);
        node = found.node;
        pos = found.offset;
      }
      const dom = node ? editor.view.nodeDOM(pos) : null;
      const surface = canvas.current;
      if (!(dom instanceof HTMLElement) || !surface || !node)
        return setMobileBlock(null);
      setMobileBlock({
        node,
        pos,
        top:
          dom.getBoundingClientRect().top - surface.getBoundingClientRect().top,
      });
    };
    update();
    editor.on("selectionUpdate", update);
    editor.on("update", update);
    const rememberRange = () => {
      const selection = editor.state.selection;
      if (isNodeRangeSelection(selection) && selection.ranges.length > 1)
        lastMultiBlockSelection.current = selection;
      else if (!isNodeRangeSelection(selection))
        lastMultiBlockSelection.current = null;
    };
    const forgetRange = ({
      transaction,
    }: {
      transaction: { docChanged: boolean };
    }) => {
      if (transaction.docChanged) lastMultiBlockSelection.current = null;
    };
    editor.on("selectionUpdate", rememberRange);
    editor.on("update", forgetRange);
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("update", update);
      editor.off("selectionUpdate", rememberRange);
      editor.off("update", forgetRange);
    };
  }, [canvas, editor, readOnly]);
  if (readOnly) return null;
  const insertPosition = block
    ? Math.min(editor.state.doc.content.size, block.pos + block.node.nodeSize)
    : editor.state.selection.to;
  return (
    <>
      {marquee ? (
        <div className="thought-marquee" style={marquee} aria-hidden />
      ) : null}
      <DragHandle
        editor={editor}
        className="thought-drag-handle"
        nested={DRAG_NESTED}
        computePositionConfig={DRAG_POSITION}
        onNodeChange={({ node, pos }) => {
          if (!menu) setBlock(node ? { node, pos } : null);
        }}
        onElementDragStart={() => {
          if (
            block &&
            !(
              editor.state.selection.from <= block.pos &&
              editor.state.selection.to >= block.pos + block.node.nodeSize
            )
          )
            selectBlockAt(editor, block.pos, block.node);
          setMenu(null);
        }}
      >
        <div className="thought-block-handle-inner" ref={menuRoot}>
          <button
            type="button"
            className="thought-add-block"
            aria-label="在下方添加块"
            title="在下方添加块"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() =>
              setMenu((current) => (current === "insert" ? null : "insert"))
            }
          >
            <Plus size={15} />
          </button>
          <button
            type="button"
            className="thought-grip"
            aria-label={`打开${blockLabel(block)}菜单；也可拖动`}
            aria-expanded={menu === "block"}
            onMouseDown={() => {
              selectionBeforeHandleClick.current = editor.state.selection;
            }}
            onClick={() => {
              const clickedSelection = selectionBeforeHandleClick.current;
              const preserved =
                clickedSelection &&
                isNodeRangeSelection(clickedSelection) &&
                clickedSelection.ranges.length > 1
                  ? clickedSelection
                  : (lastMultiBlockSelection.current ?? clickedSelection);
              const preserveRange =
                !!preserved &&
                isNodeRangeSelection(preserved) &&
                preserved.ranges.length > 1;
              if (
                preserved &&
                (preserveRange ||
                  (block && selectionContainsBlock(preserved, block)))
              )
                editor.view.dispatch(editor.state.tr.setSelection(preserved));
              if (
                block &&
                !preserveRange &&
                !selectionContainsBlock(
                  preserved ?? editor.state.selection,
                  block,
                )
              )
                selectBlockAt(editor, block.pos, block.node);
              selectionBeforeHandleClick.current = null;
              setMenu((current) => (current === "block" ? null : "block"));
            }}
          >
            <GripVertical size={15} />
          </button>
          {menu === "insert" ? (
            <BlockInsertMenu
              searchable
              onClose={close}
              command={(item) => {
                runInsertCommand(editor, item.key, callbacks, insertPosition);
                close();
              }}
            />
          ) : null}
          {menu === "block" && block ? (
            <BlockMenu
              editor={editor}
              block={block}
              close={close}
              onError={onError}
              assetScopeId={assetScopeId}
              insert={() => setMenu("insert")}
            />
          ) : null}
        </div>
      </DragHandle>
      {isNodeRangeSelection(editor.state.selection) &&
      editor.state.selection.ranges.length > 1 &&
      !menu &&
      !mobileMenu ? (
        <div
          className="thought-range-menu"
          role="toolbar"
          aria-label="多块操作"
          onMouseDown={(event) => event.preventDefault()}
        >
          <span>{editor.state.selection.ranges.length} 个块</span>
          <button
            type="button"
            onClick={() => {
              void copyBlockSelection(editor, assetScopeId, access).catch(
                (error: Error) => onError(error.message),
              );
            }}
          >
            <Copy size={15} />
            复制
          </button>
          <button
            type="button"
            className="is-danger"
            onClick={() => deleteBlockSelection(editor)}
          >
            <Trash2 size={15} />
            删除
          </button>
        </div>
      ) : null}
      {mobileBlock ? (
        <div
          ref={mobileRoot}
          className="thought-mobile-block-controls"
          style={{ top: Math.max(4, mobileBlock.top) }}
        >
          <button
            type="button"
            className="thought-mobile-block-trigger"
            aria-label={`打开${blockLabel(mobileBlock)}菜单`}
            aria-expanded={mobileMenu === "block"}
            onClick={() => {
              selectBlockAt(editor, mobileBlock.pos, mobileBlock.node);
              setMobileMenu((current) =>
                current === "block" ? null : "block",
              );
            }}
          >
            <GripVertical size={17} />
          </button>
          {mobileMenu === "block" ? (
            <BlockMenu
              editor={editor}
              block={mobileBlock}
              close={close}
              onError={onError}
              insert={() => setMobileMenu("insert")}
            />
          ) : null}
          {mobileMenu === "insert" ? (
            <BlockInsertMenu
              searchable
              onClose={close}
              command={(item) => {
                runInsertCommand(
                  editor,
                  item.key,
                  callbacks,
                  Math.min(
                    editor.state.doc.content.size,
                    mobileBlock.pos + mobileBlock.node.nodeSize,
                  ),
                );
                close();
              }}
            />
          ) : null}
        </div>
      ) : null}
    </>
  );
}
