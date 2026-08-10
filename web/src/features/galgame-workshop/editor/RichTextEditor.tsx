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
  Italic,
  Palette,
  Pause,
  Pilcrow,
  SpellCheck2,
  Strikethrough,
} from "lucide-react";
import type {
  GalgameStoryCharacter,
  GalgameStoryProject,
  GalgameStoryRichTextDocument,
  GalgameStoryRichTextNode,
} from "@features/galgame-workshop/api";
import {
  plainRichText,
  richTextPlainText,
} from "@features/galgame-workshop/editor/richText";

type TextNode = Extract<GalgameStoryRichTextNode, { type: "text" }>;
type TextMarks = NonNullable<TextNode["marks"]>;

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
}: {
  value?: GalgameStoryRichTextDocument | null;
  document: GalgameStoryProject;
  character?: GalgameStoryCharacter;
  ariaLabel: string;
  placeholder: string;
  onChange: (value: GalgameStoryRichTextDocument) => void;
  onPlainTextChange?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const content = value ?? plainRichText("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const blurTimerRef = useRef<number | undefined>(undefined);
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
    <div className={`galgame-rich-editor${focused ? " is-focused" : ""}`}>
      {focused && selected ? (
        <div className="galgame-rich-toolbar" aria-label="文字排版工具条">
          <button
            type="button"
            disabled={!selected}
            aria-label="粗体"
            onClick={() => apply({ bold: true })}
          >
            <Bold />
          </button>
          <button
            type="button"
            disabled={!selected}
            aria-label="斜体"
            onClick={() => apply({ italic: true })}
          >
            <Italic />
          </button>
          <button
            type="button"
            disabled={!selected}
            aria-label="删除线"
            onClick={() => apply({ strike: true })}
          >
            <Strikethrough />
          </button>
          <label aria-label="文字颜色">
            <Palette />
            <input
              type="color"
              defaultValue="#ffffff"
              onChange={(event) => apply({ color: event.target.value })}
            />
          </label>
          <label aria-label="文字背景色">
            <SpellCheck2 />
            <input
              type="color"
              defaultValue="#e75b55"
              onChange={(event) =>
                apply({ backgroundColor: event.target.value })
              }
            />
          </label>
          <select
            aria-label="字号"
            defaultValue=""
            onChange={(event) =>
              apply({
                fontSizePx: event.target.value
                  ? Number(event.target.value)
                  : null,
              })
            }
          >
            <option value="">字号</option>
            {[24, 28, 32, 40, 48].map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!selected}
            aria-label="注音"
            onClick={ruby}
          >
            <CaseSensitive />
          </button>
          <select
            aria-label="插入变量"
            defaultValue=""
            onChange={(event) => {
              if (event.target.value)
                insert({ type: "variable", variableId: event.target.value });
              event.target.value = "";
            }}
          >
            <option value="">变量</option>
            {(document.variables ?? []).map((variable) => (
              <option key={variable.id} value={variable.id}>
                {variable.name}
              </option>
            ))}
          </select>
          {character ? (
            <select
              aria-label="插入表情切换"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value)
                  insert({
                    type: "expression",
                    expressionId: event.target.value,
                  });
                event.target.value = "";
              }}
            >
              <option value="">表情</option>
              {(character.expressions ?? []).map((expression) => (
                <option key={expression.id} value={expression.id}>
                  {expression.label}
                </option>
              ))}
            </select>
          ) : null}
          <button
            type="button"
            aria-label="换行"
            onClick={() => insert({ type: "lineBreak" })}
          >
            <Pilcrow />
          </button>
          <select
            aria-label="插入等待"
            defaultValue=""
            onChange={(event) => {
              const durationMs = Number(event.target.value);
              if (durationMs >= 0)
                insert({ type: "wait", mode: "duration", durationMs });
              event.target.value = "";
            }}
          >
            <option value="">等待</option>
            {[500, 1000, 2000, 3000].map((ms) => (
              <option key={ms} value={ms}>
                {ms / 1000}s
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label="等待玩家继续"
            onClick={() =>
              insert({ type: "wait", mode: "player", durationMs: null })
            }
          >
            <Pause />
          </button>
        </div>
      ) : null}
      <textarea
        autoFocus
        rows={1}
        ref={textareaRef}
        aria-label={ariaLabel}
        value={plain}
        placeholder={placeholder}
        onFocus={() => {
          if (blurTimerRef.current !== undefined)
            window.clearTimeout(blurTimerRef.current);
          setFocused(true);
          updateSelection();
        }}
        onBlur={() => {
          blurTimerRef.current = window.setTimeout(
            () => setFocused(false),
            120,
          );
        }}
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
