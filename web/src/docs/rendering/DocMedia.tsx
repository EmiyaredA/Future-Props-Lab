// Adapted from Sayflow shared/docs; see README.md in this directory.
import { useEffect, useRef, useState } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
export function DocFormula({
  source,
  label,
  inline = false,
}: {
  source: string;
  label?: string;
  inline?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (ref.current)
      katex.render(source, ref.current, {
        displayMode: !inline,
        throwOnError: false,
        strict: "warn",
        trust: false,
        output: "htmlAndMathml",
      });
  }, [source, inline]);
  return inline ? (
    <span ref={ref} aria-label={label || source} />
  ) : (
    <div className="formula-card">
      <span ref={ref} className="formula-block" aria-label={label || source} />
    </div>
  );
}
export function DocCode({
  source,
  language,
}: {
  source: string;
  language: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const fence = "`".repeat(
    Math.max(3, ...[...source.matchAll(/`+/g)].map((m) => m[0].length + 1)),
  );
  return (
    <div className="guide-code">
      <div className="guide-code-label">
        {language || "文本"}
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              .writeText(source)
              .then(() => {
                setCopied(true);
                setCopyError(false);
              })
              .catch(() => setCopyError(true))
          }
        >
          {copyError ? "请手动复制" : copied ? "已复制" : "复制代码"}
        </button>
      </div>
      <ReactMarkdown
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ children }) => (
            <pre
              tabIndex={0}
              aria-label={`${language || "文本"}示例，可横向滚动`}
            >
              {children}
            </pre>
          ),
        }}
      >
        {`${fence}${language}\n${source}\n${fence}`}
      </ReactMarkdown>
    </div>
  );
}
let mermaidQueue: Promise<unknown> = Promise.resolve();
export function DocMermaid({ source }: { source: string }) {
  const [svg, setSvg] = useState(""),
    [error, setError] = useState(""),
    [scale, setScale] = useState(1),
    [showSource, setShowSource] = useState(false);
  const [theme, setTheme] = useState(
    () => document.documentElement.dataset.theme,
  );
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setTheme(document.documentElement.dataset.theme),
    );
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false;
    setSvg("");
    setError("");
    mermaidQueue = mermaidQueue
      .catch(() => undefined)
      .then(async () => {
        const { default: mermaid } = await import("mermaid");
        if (cancelled) return;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          suppressErrorRendering: true,
          themeVariables: {
            darkMode: theme === "dark",
            primaryColor: getComputedStyle(document.documentElement)
              .getPropertyValue("--surface-soft")
              .trim(),
            primaryTextColor: getComputedStyle(document.documentElement)
              .getPropertyValue("--text-strong")
              .trim(),
            primaryBorderColor: getComputedStyle(document.documentElement)
              .getPropertyValue("--accent")
              .trim(),
            lineColor: getComputedStyle(document.documentElement)
              .getPropertyValue("--muted")
              .trim(),
          },
        });
        const result = await mermaid.render(
          `docs-mermaid-${crypto.randomUUID().replaceAll("-", "")}`,
          source,
        );
        if (!cancelled) setSvg(result.svg);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "图表渲染失败");
      });
    return () => {
      cancelled = true;
    };
  }, [source, theme]);
  return (
    <figure className="docs-mermaid">
      <div className="docs-mermaid-toolbar">
        <button
          type="button"
          onClick={() => setScale((v) => Math.min(2.5, v + 0.2))}
        >
          放大
        </button>
        <button
          type="button"
          onClick={() => setScale((v) => Math.max(0.5, v - 0.2))}
        >
          缩小
        </button>
        <button type="button" onClick={() => setScale(1)}>
          复位
        </button>
        <button type="button" onClick={() => setShowSource((v) => !v)}>
          查看源码
        </button>
        <DocCopySource source={source} />
      </div>
      {error ? (
        <p role="alert">Mermaid 图表渲染失败：{error}</p>
      ) : svg ? (
        <div
          className="docs-mermaid-scroll"
          tabIndex={0}
          aria-label="图表，可横向滚动"
        >
          <div
            className="docs-mermaid-canvas"
            style={{ zoom: scale }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      ) : (
        <p>正在绘制图表…</p>
      )}
      {showSource || error ? (
        <DocCode source={source} language="mermaid" />
      ) : null}
    </figure>
  );
}

function DocCopySource({ source }: { source: string }) {
  const [label, setLabel] = useState("复制源码");
  return (
    <button
      type="button"
      onClick={() =>
        void navigator.clipboard
          .writeText(source)
          .then(() => setLabel("已复制"))
          .catch(() => setLabel("请手动复制"))
      }
    >
      {label}
    </button>
  );
}
