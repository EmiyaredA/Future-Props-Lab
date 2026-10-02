import { OfficialFigure, type OfficialFigureData } from "./OfficialFigure";
import { useEffect, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { officialHeadings } from "./content";
import { findOfficialLibrary } from "./catalog";

const heading: Components["h2"] = ({ node, children }) => {
  const Tag = (node?.tagName || "h2") as
    "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return (
    <Tag id={`section-${node?.position?.start.offset ?? 0}`} tabIndex={-1}>
      {children}
    </Tag>
  );
};

export function OfficialArticle({
  markdown,
  onOpen,
  onCopy,
}: {
  markdown: string;
  onCopy?: (figure: OfficialFigureData) => void;
  onOpen: (libraryId: string, documentId?: string) => void;
}) {
  const headings = useMemo(() => officialHeadings(markdown), [markdown]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const id = window.location.hash.slice(1);
      if (headings.some((item) => item.id === id))
        document.getElementById(id)?.scrollIntoView();
    });
    return () => cancelAnimationFrame(frame);
  }, [headings]);
  // A navigation callback can change when the page opens a dialog. It must not
  // remount figure NodeViews, which own the reading viewport and trigger focus.
  const diagramBlock = useMemo<Components["pre"]>(
    () =>
      ({ node, children }) => {
        const code = node?.children[0];
        if (code?.type === "element" && code.tagName === "code") {
          const classes = String(code.properties.className || "");
          const source = code.children
            .map((c) => (c.type === "text" ? c.value : ""))
            .join("")
            .trimEnd();
          if (classes.includes("language-mermaid"))
            return (
              <OfficialFigure kind="mermaid" source={source} onCopy={onCopy} />
            );
          if (classes.includes("language-fpl-canvas"))
            return (
              <OfficialFigure kind="canvas" source={source} onCopy={onCopy} />
            );
        }
        return <pre>{children}</pre>;
      },
    [onCopy],
  );
  const components = useMemo<Components>(
    () => ({
      pre: diagramBlock,
      h1: heading,
      h2: heading,
      h3: heading,
      h4: heading,
      h5: heading,
      h6: heading,
      table: ({ children }) => (
        <div
          className="official-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="文档表格"
        >
          <table>{children}</table>
        </div>
      ),
      a: ({ href, children }) => {
        const match =
          /^\/apps\/thought-workshop\/official-knowledge-bases\/([^/]+)(?:\/documents\/([^/]+))?$/.exec(
            href || "",
          );
        return (
          <a
            href={href}
            {...(/^https?:\/\//.test(href || "")
              ? { target: "_blank", rel: "noopener noreferrer" }
              : {})}
            onClick={(event) => {
              if (
                !match ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey ||
                event.button !== 0
              )
                return;
              const libraryId = decodeURIComponent(match[1]);
              const documentId = match[2]
                ? decodeURIComponent(match[2])
                : undefined;
              const library = findOfficialLibrary(libraryId);
              if (
                !library ||
                (documentId &&
                  !library.documents.some((item) => item.id === documentId))
              )
                return;
              event.preventDefault();
              onOpen(libraryId, documentId);
            }}
          >
            {children}
          </a>
        );
      },
    }),
    [diagramBlock, onOpen],
  );
  return (
    <div className="official-article-layout">
      <details className="official-outline" open>
        <summary>文档大纲</summary>
        <nav aria-label="文档章节">
          {headings.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              style={{ paddingLeft: (item.level - 1) * 12 + 10 }}
              onClick={() =>
                requestAnimationFrame(() =>
                  document
                    .getElementById(item.id)
                    ?.focus({ preventScroll: true }),
                )
              }
            >
              {item.title}
            </a>
          ))}
        </nav>
      </details>
      <article className="official-prose" aria-label="官方文档正文">
        <ReactMarkdown
          skipHtml
          remarkPlugins={[remarkGfm]}
          components={components}
        >
          {markdown}
        </ReactMarkdown>
      </article>
    </div>
  );
}
