import { useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import type { GuidePage } from "./types";
import { CopyButton } from "./DocsMarkdown";

const languages = [
  ["sync", "Python 同步", "python"],
  ["async", "Python 异步", "python"],
  ["curl", "cURL", "bash"],
] as const;

export function DocsExamples({
  examples,
}: {
  examples: NonNullable<GuidePage["examples"]>;
}) {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const [key, label, language] = languages[selected];
  return (
    <section className="docs-examples" aria-label="调用示例">
      <div className="docs-example-toolbar">
        <div role="tablist" aria-label="示例语言">
          {languages.map(([value, title], index) => (
            <button
              key={value}
              id={`${id}-${value}`}
              role="tab"
              aria-selected={selected === index}
              aria-controls={`${id}-panel`}
              tabIndex={selected === index ? 0 : -1}
              onClick={() => setSelected(index)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? 2
                      : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
                setSelected(next);
                document.getElementById(`${id}-${languages[next][0]}`)?.focus();
              }}
            >
              {title}
            </button>
          ))}
        </div>
        <CopyButton value={examples[key]} />
      </div>
      <div
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${key}`}
        tabIndex={0}
      >
        <span className="sr-only">{label}</span>
        <ReactMarkdown
          rehypePlugins={[rehypeHighlight]}
        >{`\`\`\`${language}\n${examples[key]}\n\`\`\``}</ReactMarkdown>
      </div>
      {examples.response && (
        <details className="docs-example-response">
          <summary>响应示例</summary>
          <ReactMarkdown
            rehypePlugins={[rehypeHighlight]}
          >{`\`\`\`json\n${examples.response}\n\`\`\``}</ReactMarkdown>
        </details>
      )}
    </section>
  );
}
