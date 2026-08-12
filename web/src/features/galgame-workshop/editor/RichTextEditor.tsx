import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  Bold,
  CaseSensitive,
  ChevronDown,
  Italic,
  Palette,
  Pause,
  Pilcrow,
  Smile,
  SpellCheck2,
  Strikethrough,
} from "lucide-react";
import type {
  GalgameStoryCharacter,
  GalgameStoryProject,
  GalgameStoryRichTextDocument,
  GalgameStoryRichTextNode,
} from "@features/galgame-workshop/api";
import { CustomColorPicker } from "@shared/ui/CustomColorPicker";
import {
  plainRichText,
  richTextPlainText,
} from "@features/galgame-workshop/editor/richText";

type TextNode = Extract<GalgameStoryRichTextNode, { type: "text" }>;
type TextMarks = NonNullable<TextNode["marks"]>;

function RichToolbarMenu({
  ariaLabel,
  label,
  icon,
  options,
  onChoose,
}: {
  ariaLabel: string;
  label: string;
  icon?: ReactNode;
  options: Array<{ value: string; label: string }>;
  onChoose: (value: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div className="galgame-rich-menu" ref={root}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown />
      </button>
      {open ? (
        <div role="menu" aria-label={`${label}选项`}>
          {options.length ? (
            options.map((option) => (
              <button
                key={option.value || "__default__"}
                type="button"
                role="menuitem"
                onClick={() => {
                  onChoose(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            ))
          ) : (
            <span>暂无可用选项</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function nodeLength(node: GalgameStoryRichTextNode) {
  return node.type === "text" || node.type === "ruby"
    ? node.text.length
    : node.type === "lineBreak"
      ? 1
      : 0;
}

function markRange(
  content: GalgameStoryRichTextDocument,
  start: number,
  end: number,
  marks: Partial<TextMarks>,
) {
  let cursor = 0;
  const nodes: GalgameStoryRichTextNode[] = [];
  for (const node of content.nodes ?? []) {
    const length = nodeLength(node);
    const nodeStart = cursor;
    const nodeEnd = cursor + length;
    cursor = nodeEnd;
    if (
      (node.type !== "text" && node.type !== "ruby") ||
      end <= nodeStart ||
      start >= nodeEnd
    ) {
      nodes.push(node);
      continue;
    }
    const localStart = Math.max(0, start - nodeStart);
    const localEnd = Math.min(length, end - nodeStart);
    const prefix = node.text.slice(0, localStart);
    const selected = node.text.slice(localStart, localEnd);
    const suffix = node.text.slice(localEnd);
    if (prefix) nodes.push({ ...node, text: prefix });
    if (selected)
      nodes.push({
        ...node,
        text: selected,
        marks: {
          bold: node.marks?.bold ?? false,
          italic: node.marks?.italic ?? false,
          strike: node.marks?.strike ?? false,
          ...(node.marks ?? {}),
          ...marks,
        },
      });
    if (suffix) nodes.push({ ...node, text: suffix });
  }
  return { version: 1, nodes } satisfies GalgameStoryRichTextDocument;
}

function insertNode(
  content: GalgameStoryRichTextDocument,
  offset: number,
  inserted: GalgameStoryRichTextNode,
) {
  let cursor = 0;
  const nodes: GalgameStoryRichTextNode[] = [];
  let complete = false;
  for (const node of content.nodes ?? []) {
    const length = nodeLength(node);
    if (
      !complete &&
      (node.type === "text" || node.type === "ruby") &&
      offset >= cursor &&
      offset <= cursor + length
    ) {
      const local = offset - cursor;
      if (local) nodes.push({ ...node, text: node.text.slice(0, local) });
      nodes.push(inserted);
      if (local < length) nodes.push({ ...node, text: node.text.slice(local) });
      complete = true;
    } else {
      nodes.push(node);
    }
    cursor += length;
  }
  if (!complete) nodes.push(inserted);
  return { version: 1, nodes } satisfies GalgameStoryRichTextDocument;
}

function MarkedText({ node }: { node: TextNode }) {
  const style: CSSProperties = {
    color: node.marks?.color ?? undefined,
    backgroundColor: node.marks?.backgroundColor ?? undefined,
    fontSize: node.marks?.fontSizePx ? `${node.marks.fontSizePx}px` : undefined,
  };
  let value: ReactNode = <span style={style}>{node.text}</span>;
  if (node.marks?.strike) value = <s>{value}</s>;
  if (node.marks?.italic) value = <em>{value}</em>;
  if (node.marks?.bold) value = <strong>{value}</strong>;
  return value;
}

export function RichTextView({
  content,
  document,
  variables = {},
  editorMarks = false,
}: {
  content: GalgameStoryRichTextDocument;
  document?: GalgameStoryProject;
  variables?: Record<string, string | number | boolean>;
  editorMarks?: boolean;
}) {
  return (
    <>
      {(content.nodes ?? []).map((node, index) => {
        if (node.type === "text")
          return <MarkedText key={`${index}-${node.text}`} node={node} />;
        if (node.type === "ruby")
          return (
            <ruby key={`${index}-${node.text}`}>
              <MarkedText
                node={{ type: "text", text: node.text, marks: node.marks }}
              />
              <rp>(</rp>
              <rt>{node.reading}</rt>
              <rp>)</rp>
            </ruby>
          );
        if (node.type === "lineBreak") return <br key={index} />;
        if (node.type === "variable") {
          const variable = document?.variables?.find(
            (candidate) => candidate.id === node.variableId,
          );
          const value = variables[node.variableId];
          return (
            <span
              key={index}
              className={editorMarks ? "rich-token" : undefined}
            >
              {value == null
                ? editorMarks
                  ? `变量·${variable?.name ?? node.variableId}`
                  : String(variable?.defaultValue ?? "")
                : String(value)}
            </span>
          );
        }
        if (!editorMarks) return null;
        if (node.type === "expression")
          return (
            <span key={index} className="rich-token expression">
              表情·{node.expressionId}
            </span>
          );
        return (
          <span key={index} className="rich-token wait">
            {node.mode === "player"
              ? "等待继续"
              : `等待 ${(node.durationMs ?? 0) / 1000}s`}
          </span>
        );
      })}
    </>
  );
}

export function RichTextEditor({
  value,
  document,
  character,
  ariaLabel,
  placeholder,
  onChange,
  onPlainTextChange,
  onKeyDown,
  autoFocus = true,
}: {
  value?: GalgameStoryRichTextDocument | null;
  document: GalgameStoryProject;
  character?: GalgameStoryCharacter;
  ariaLabel: string;
  placeholder: string;
  onChange: (value: GalgameStoryRichTextDocument) => void;
  onPlainTextChange?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  autoFocus?: boolean;
}) {
  const content = value ?? plainRichText("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const blurTimerRef = useRef<number | undefined>(undefined);
  const toolbarPointerRef = useRef(false);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const plain = useMemo(() => richTextPlainText(content), [content]);
  const selected = selection.end > selection.start;
  useEffect(
    () => () => {
      if (blurTimerRef.current !== undefined)
        window.clearTimeout(blurTimerRef.current);
    },
    [],
  );
  const updateSelection = () => {
    const target = textareaRef.current;
    if (!target) return;
    setSelection({ start: target.selectionStart, end: target.selectionEnd });
  };
  const apply = (marks: Partial<TextMarks>) => {
    if (!selected) return;
    onChange(markRange(content, selection.start, selection.end, marks));
  };
  const insert = (node: GalgameStoryRichTextNode) => {
    onChange(insertNode(content, selection.start, node));
  };
  const ruby = () => {
    if (!selected) return;
    const reading = window.prompt("输入注音");
    if (!reading) return;
    const text = plain.slice(selection.start, selection.end);
    const before = plainRichText(plain.slice(0, selection.start)).nodes ?? [];
    const after = plainRichText(plain.slice(selection.end)).nodes ?? [];
    onChange({
      version: 1,
      nodes: [...before, { type: "ruby", text, reading }, ...after],
    });
  };
  return (
    <div
      className={`galgame-rich-editor${focused ? " is-focused" : ""}`}
      onFocusCapture={() => {
        if (blurTimerRef.current !== undefined)
          window.clearTimeout(blurTimerRef.current);
        setFocused(true);
      }}
      onBlurCapture={(event) => {
        if (toolbarPointerRef.current) return;
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        blurTimerRef.current = window.setTimeout(() => {
          setFocused(false);
        }, 120);
      }}
    >
      {focused && selected ? (
        <div
          className="galgame-rich-toolbar"
          aria-label="文字排版工具条"
          onMouseDownCapture={(event) => {
            toolbarPointerRef.current = true;
            event.stopPropagation();
            if (!(event.target instanceof HTMLInputElement))
              event.preventDefault();
          }}
          onMouseUpCapture={() => {
            toolbarPointerRef.current = false;
          }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="galgame-rich-toolbar-group">
            <button
              type="button"
              disabled={!selected}
              aria-label="粗体"
              onClick={() => apply({ bold: true })}
            >
              <Bold /> <span>粗体</span>
            </button>
            <button
              type="button"
              disabled={!selected}
              aria-label="斜体"
              onClick={() => apply({ italic: true })}
            >
              <Italic /> <span>斜体</span>
            </button>
            <button
              type="button"
              disabled={!selected}
              aria-label="删除线"
              onClick={() => apply({ strike: true })}
            >
              <Strikethrough /> <span>删除线</span>
            </button>
          </div>
          <div className="galgame-rich-toolbar-group">
            <span className="galgame-rich-color-control">
              <Palette /> <span>文字色</span>
              <CustomColorPicker
                compact
                ariaLabel="文字颜色"
                value="#172133"
                onChange={(color) => apply({ color })}
              />
            </span>
            <span className="galgame-rich-color-control">
              <SpellCheck2 /> <span>背景色</span>
              <CustomColorPicker
                compact
                ariaLabel="文字背景色"
                value="#E75B55"
                onChange={(backgroundColor) => apply({ backgroundColor })}
              />
            </span>
            <RichToolbarMenu
              ariaLabel="字号"
              label="字号"
              options={[
                { value: "", label: "默认字号" },
                ...[24, 28, 32, 40, 48].map((size) => ({
                  value: String(size),
                  label: `${size}px`,
                })),
              ]}
              onChoose={(value) =>
                apply({ fontSizePx: value ? Number(value) : null })
              }
            />
          </div>
          <div className="galgame-rich-toolbar-group">
            <button
              type="button"
              disabled={!selected}
              aria-label="注音"
              onClick={ruby}
            >
              <CaseSensitive /> <span>注音</span>
            </button>
            <RichToolbarMenu
              ariaLabel="插入变量"
              label="变量"
              options={(document.variables ?? []).map((variable) => ({
                value: variable.id,
                label: variable.name,
              }))}
              onChoose={(variableId) =>
                insert({ type: "variable", variableId })
              }
            />
            {character ? (
              <RichToolbarMenu
                ariaLabel="插入表情切换"
                label="表情"
                icon={<Smile />}
                options={(character.expressions ?? []).map((expression) => ({
                  value: expression.id,
                  label: expression.label,
                }))}
                onChoose={(expressionId) =>
                  insert({ type: "expression", expressionId })
                }
              />
            ) : null}
          </div>
          <div className="galgame-rich-toolbar-group">
            <button
              type="button"
              aria-label="换行"
              onClick={() => insert({ type: "lineBreak" })}
            >
              <Pilcrow /> <span>换行</span>
            </button>
            <RichToolbarMenu
              ariaLabel="插入等待"
              label="等待"
              options={[500, 1000, 2000, 3000].map((ms) => ({
                value: String(ms),
                label: `${ms / 1000}s`,
              }))}
              onChoose={(value) =>
                insert({
                  type: "wait",
                  mode: "duration",
                  durationMs: Number(value),
                })
              }
            />
            <button
              type="button"
              aria-label="等待玩家继续"
              onClick={() =>
                insert({ type: "wait", mode: "player", durationMs: null })
              }
            >
              <Pause /> <span>等待继续</span>
            </button>
          </div>
        </div>
      ) : null}
      <textarea
        autoFocus={autoFocus}
        rows={1}
        ref={textareaRef}
        aria-label={ariaLabel}
        value={plain}
        placeholder={placeholder}
        onFocus={updateSelection}
        onSelect={updateSelection}
        onKeyDown={onKeyDown}
        onChange={(event) => {
          onPlainTextChange?.();
          onChange(plainRichText(event.target.value));
        }}
      />
      {(content.nodes ?? []).some(
        (node) => node.type !== "text" || node.marks,
      ) ? (
        <div className="galgame-rich-preview" aria-label="富文本预览">
          <RichTextView content={content} document={document} editorMarks />
        </div>
      ) : null}
    </div>
  );
}
