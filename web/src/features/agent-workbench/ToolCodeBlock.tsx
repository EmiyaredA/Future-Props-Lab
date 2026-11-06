import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy, WrapText } from "lucide-react";
import type { RootContent } from "hast";
import { highlightCode } from "./codeHighlight";

function renderNode(node: RootContent, key: number): ReactNode {
  if (node.type === "text") return node.value;
  if (node.type !== "element") return null;
  return (
    <span
      key={key}
      className={(node.properties.className as string[] | undefined)?.join(" ")}
    >
      {node.children.map(renderNode)}
    </span>
  );
}
export function HighlightedCode({
  text,
  language,
}: {
  text: string;
  language?: string;
}) {
  return useMemo(() => {
    return highlightCode(text, language, 24000).map(renderNode);
  }, [text, language]);
}

export function ToolCodeBlock({
  text,
  label = "输出",
  language,
}: {
  text: string;
  label?: string;
  language?: string;
}) {
  const [wrap, setWrap] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState("");
  const body = expanded ? text : text.slice(0, 24000);
  return (
    <div className="aw-code-block">
      <div className="aw-code-toolbar">
        <span>{label}</span>
        <span className="aw-code-meta">{text.split("\n").length} 行</span>
        <button
          type="button"
          aria-label={`${label}自动换行`}
          aria-pressed={wrap}
          onClick={() => setWrap(!wrap)}
        >
          <WrapText size={14} />
        </button>
        <button
          type="button"
          aria-label={`复制${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopyState("已复制");
            } catch {
              setCopyState("复制失败，请选择文本复制");
            }
          }}
        >
          {copyState === "已复制" ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      {copyState && (
        <span className="aw-code-feedback" role="status">
          {copyState}
        </span>
      )}
      <pre
        className={wrap ? "is-wrapped" : undefined}
        tabIndex={0}
        aria-label={label}
      >
        <code>
          <HighlightedCode text={body} language={language} />
        </code>
      </pre>
      {text.length > 24000 && (
        <button
          type="button"
          className="aw-link"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起长内容" : "展开完整内容"}
        </button>
      )}
    </div>
  );
}
