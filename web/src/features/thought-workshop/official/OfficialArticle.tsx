import { OfficialFigure, type OfficialFigureData } from "./OfficialFigure";
import { useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Element, Text } from "hast";
import {
  ReadingHeading,
  ReadingCode,
  ReadingCallout,
  ReadingTable,
} from "./ReadingBlocks";
import { ReadingOutline } from "./ReadingOutline";
import { ReadingNavigation } from "./ReadingNavigation";
import type { Components } from "react-markdown";
import { officialHeadings, remarkOfficialCallouts } from "./content";
import { findOfficialLibrary } from "./catalog";

function codeText(node: Element | Text): string {
  return node.type === "text"
    ? node.value
    : node.children
        .map((child) =>
          child.type === "element" || child.type === "text"
            ? codeText(child)
            : "",
        )
        .join("");
}

export function OfficialArticle({
  markdown,
  onOpen,
  onCopy,
  libraryId,
  documentId,
}: {
  markdown: string;
  libraryId?: string;
  documentId?: string;
  onCopy?: (figure: OfficialFigureData) => void;
  onOpen: (libraryId: string, documentId?: string) => void;
}) {
  const article = useRef<HTMLElement>(null);
  const library = findOfficialLibrary(libraryId);
  const current = library?.documents.find((item) => item.id === documentId);
  const headings = useMemo(() => officialHeadings(markdown), [markdown]);
  useEffect(() => {
    let frame = 0;
    const locate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const id = window.location.hash.slice(1);
        const target = headings.some((item) => item.id === id)
          ? document.getElementById(id)
          : null;
        if (target) target.scrollIntoView?.();
        (target ?? article.current?.querySelector<HTMLElement>("h1"))?.focus({
          preventScroll: true,
        });
      });
    };
    locate();
    window.addEventListener("hashchange", locate);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", locate);
    };
  }, [headings]);
  // A navigation callback can change when the page opens a dialog. It must not
  // remount figure NodeViews, which own the reading viewport and trigger focus.
  const diagramBlock = useMemo<Components["pre"]>(
    () =>
      ({ node, children }) => {
        const code = node?.children[0];
        if (code?.type === "element" && code.tagName === "code") {
          const classes = String(code.properties.className || "");
          const source = codeText(code).replace(/\n$/, "");
          if (classes.includes("language-mermaid"))
            return (
              <OfficialFigure kind="mermaid" source={source} onCopy={onCopy} />
            );
          if (classes.includes("language-fpl-canvas"))
            return (
              <OfficialFigure kind="canvas" source={source} onCopy={onCopy} />
            );
          const language = /language-([^\s,]+)/.exec(classes)?.[1] || "";
          return (
            <ReadingCode source={source} language={language}>
              {children}
            </ReadingCode>
          );
        }
        return <pre>{children}</pre>;
      },
    [onCopy],
  );
  const components = useMemo<Components>(
    () => ({
      pre: diagramBlock,
      h1: ReadingHeading,
      h2: ReadingHeading,
      h3: ReadingHeading,
      h4: ReadingHeading,
      h5: ReadingHeading,
      h6: ReadingHeading,
      blockquote: ReadingCallout,
      table: ReadingTable,
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
      <article
        ref={article}
        className="official-prose"
        aria-label="官方文档正文"
      >
        <ReactMarkdown
          skipHtml
          remarkPlugins={[remarkGfm, remarkOfficialCallouts]}
          rehypePlugins={[
            [
              rehypeHighlight,
              {
                detect: false,
                ignoreMissing: true,
                plainText: ["mermaid", "fpl-canvas"],
              },
            ],
          ]}
          components={components}
        >
          {markdown}
        </ReactMarkdown>
        {library && current && (
          <ReadingNavigation
            library={library}
            current={current}
            onOpen={onOpen}
          />
        )}
      </article>
      <ReadingOutline headings={headings} article={article} />
    </div>
  );
}
