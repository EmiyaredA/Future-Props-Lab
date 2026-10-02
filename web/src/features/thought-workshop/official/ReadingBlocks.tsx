import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Check,
  Copy,
  Info,
  Lightbulb,
  TriangleAlert,
  Link,
} from "lucide-react";
import type { Components } from "react-markdown";

export function ReadingCopy({
  text,
  label,
  anchor = false,
}: {
  text: () => string;
  label: string;
  anchor?: boolean;
}) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span className="official-copy-control">
      <button
        type="button"
        className="official-copy-button"
        aria-label={label}
        title={label}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text());
            setState("done");
          } catch {
            setState("failed");
          }
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setState("idle"), 2400);
        }}
      >
        {state === "done" ? (
          <Check size={15} aria-hidden />
        ) : anchor ? (
          <Link size={15} aria-hidden />
        ) : (
          <Copy size={15} aria-hidden />
        )}
        {!anchor && <span>{state === "done" ? "已复制" : "复制"}</span>}
      </button>
      <span className="official-copy-feedback" role="status">
        {state === "done"
          ? "复制成功"
          : state === "failed"
            ? "复制失败，请手动选择内容复制"
            : ""}
      </span>
    </span>
  );
}

export function ReadingCode({
  source,
  language,
  children,
}: {
  source: string;
  language: string;
  children: ReactNode;
}) {
  return (
    <div className="official-code-block">
      <div className="official-code-toolbar">
        <span>{language || "纯文本"}</span>
        <ReadingCopy text={() => source} label="复制代码" />
      </div>
      <pre tabIndex={0} aria-label={`${language || "纯文本"}代码`}>
        {children}
      </pre>
    </div>
  );
}

export const ReadingHeading: Components["h2"] = ({ node, children }) => {
  const Tag = (node?.tagName || "h2") as
    "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  const id = `section-${node?.position?.start.offset ?? 0}`;
  return (
    <div className={`official-heading official-heading-${Tag}`}>
      <Tag id={id} tabIndex={-1}>
        {children}
      </Tag>
      {Tag !== "h1" && (
        <ReadingCopy
          anchor
          label={`复制章节链接：${node?.children.map((child) => (child.type === "text" ? child.value : "")).join("") || "章节"}`}
          text={() => `${window.location.href.split("#")[0]}#${id}`}
        />
      )}
    </div>
  );
};

export const ReadingTable: Components["table"] = ({ children }) => (
  <div
    className="official-table-scroll"
    tabIndex={0}
    role="region"
    aria-label="文档表格"
  >
    <table>{children}</table>
  </div>
);

export const ReadingCallout: Components["blockquote"] = ({
  node,
  children,
}) => {
  const kind = String(node?.properties?.["data-official-callout"] || "");
  if (!["note", "tip", "warning"].includes(kind))
    return <blockquote>{children}</blockquote>;
  const Icon =
    kind === "tip" ? Lightbulb : kind === "warning" ? TriangleAlert : Info;
  const title = kind === "tip" ? "提示" : kind === "warning" ? "注意" : "说明";
  return (
    <aside
      className={`official-callout official-callout-${kind}`}
      aria-label={title}
    >
      <div className="official-callout-title">
        <Icon size={18} aria-hidden />
        <strong>{title}</strong>
      </div>
      {children}
    </aside>
  );
};
