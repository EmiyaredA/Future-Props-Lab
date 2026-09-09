import { memo, useMemo, useRef, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { GuidePage } from "./types";
import { resolveDocLink } from "./content";

export function CopyButton({
  value,
  label = "复制代码",
}: {
  value: string;
  label?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          if (ref.current) ref.current.textContent = "已复制";
        } catch {
          if (ref.current) ref.current.textContent = "复制失败，请选择文字复制";
        }
      }}
      ref={ref}
    >
      {label}
    </button>
  );
}
function CodeBlock({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className="docs-code">
      <button
        type="button"
        onClick={async (event) => {
          const button = event.currentTarget;
          try {
            await navigator.clipboard.writeText(ref.current?.textContent || "");
            button.textContent = "已复制";
          } catch {
            button.textContent = "请手动复制";
          }
        }}
      >
        复制代码
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}
export const DocsMarkdown = memo(function DocsMarkdown({
  page,
  onImage,
}: {
  page: GuidePage;
  onImage: (src: string, alt: string) => void;
}) {
  const lines = useMemo(() => {
    const map = new Map<number, string>();
    let i = 0;
    let fenced = false;
    page.markdown.split("\n").forEach((line, index) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (!fenced && /^#{1,3} /.test(line))
        map.set(index + 1, page.headings[i++]?.id || "");
    });
    return map;
  }, [page]);
  return (
    <div className="docs-prose">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children, node }) => (
            <h1 tabIndex={-1} id={lines.get(node?.position?.start.line || 0)}>
              {children}
            </h1>
          ),
          h2: ({ children, node }) => (
            <h2 id={lines.get(node?.position?.start.line || 0)}>{children}</h2>
          ),
          h3: ({ children, node }) => (
            <h3 id={lines.get(node?.position?.start.line || 0)}>{children}</h3>
          ),
          a: ({ href = "", children }) => {
            const resolved = resolveDocLink(page, href);
            return (
              <a
                href={resolved}
                {...(/^https?:/.test(resolved)
                  ? { target: "_blank", rel: "noreferrer" }
                  : {})}
              >
                {children}
              </a>
            );
          },
          table: ({ children }) => (
            <div className="docs-table-wrap">
              <table>{children}</table>
            </div>
          ),
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          img: ({ src = "", alt = "", title }) => (
            <span className="docs-shot">
              <button
                type="button"
                aria-label={"放大图片：" + alt}
                onClick={(event) => {
                  event.currentTarget.focus();
                  onImage(src, alt);
                }}
              >
                <img src={src} alt={alt} loading="lazy" />
              </button>
              <span className="docs-caption">{title || alt}</span>
            </span>
          ),
          blockquote: ({ children }) => (
            <aside className="docs-note">{children}</aside>
          ),
        }}
      >
        {page.markdown}
      </ReactMarkdown>
    </div>
  );
});
