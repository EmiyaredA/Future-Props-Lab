import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { prepareStreamingMarkdown } from "./streamingMarkdown";

function CodeBlock({ text, children }: { text: string; children: ReactNode }) {
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  return (
    <div className="amadeus-transcript-code">
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopy("done");
          } catch {
            setCopy("failed");
          }
        }}
      >
        {copy === "done" ? (
          <Check size={14} aria-hidden />
        ) : (
          <Copy size={14} aria-hidden />
        )}
        {copy === "done"
          ? "已复制"
          : copy === "failed"
            ? "复制失败，重试"
            : "复制代码"}
      </button>
      <pre>{children}</pre>
    </div>
  );
}

export function TranscriptMarkdown({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre({ children, node }) {
          const block = node?.children[0];
          const code =
            block?.type === "element" ? block.children[0] : undefined;
          return (
            <CodeBlock
              text={code?.type === "text" ? code.value.replace(/\n$/, "") : ""}
            >
              {children}
            </CodeBlock>
          );
        },
        a({ children, href }) {
          return href ? <a href={href}>{children}</a> : <span>{children}</span>;
        },
        // Conversation output can contain sensitive project context. External images are user-opened links.
        img({ alt, src }) {
          return src ? (
            <a href={src} target="_blank" rel="noreferrer">
              {alt || "打开图片"}
            </a>
          ) : (
            <>{alt}</>
          );
        },
      }}
    >
      {streaming ? prepareStreamingMarkdown(text) : text}
    </ReactMarkdown>
  );
}
