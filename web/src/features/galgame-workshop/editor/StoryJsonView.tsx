import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy } from "lucide-react";
import type { GalgameStoryFragment } from "@features/galgame-workshop/api";
import { canonicalBlockJson } from "@features/galgame-workshop/editor/blockRegistry";

const JSON_TOKEN =
  /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;

function highlightedLine(line: string): ReactNode[] {
  const result: ReactNode[] = [];
  let cursor = 0;
  for (const match of line.matchAll(JSON_TOKEN)) {
    const index = match.index ?? 0;
    if (index > cursor) result.push(line.slice(cursor, index));
    const token = match[0];
    const suffix = line.slice(index + token.length);
    const className = token.startsWith('"')
      ? /^\s*:/.test(suffix)
        ? "is-key"
        : "is-string"
      : token === "true" || token === "false" || token === "null"
        ? "is-literal"
        : "is-number";
    result.push(
      <span className={className} key={`${index}-${token}`}>
        {token}
      </span>,
    );
    cursor = index + token.length;
  }
  if (cursor < line.length) result.push(line.slice(cursor));
  return result;
}

export function StoryJsonView({
  fragment,
}: {
  fragment: GalgameStoryFragment;
}) {
  const [copied, setCopied] = useState(false);
  const value = canonicalBlockJson(fragment.blocks ?? []);
  const lines = useMemo(() => value.split("\n"), [value]);

  return (
    <section className="galgame-json-view" aria-label="JSON OP 只读视图">
      <header>
        <span>
          <strong>OP Nodes</strong>
          <small>
            {fragment.blocks?.length ?? 0} 条指令 ·{" "}
            {fragment.blocks?.length ?? 0}个 Block
          </small>
        </span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "已复制" : "复制 JSON"}
        </button>
      </header>
      <pre tabIndex={0}>
        {lines.map((line, index) => (
          <span className="galgame-json-line" key={`${index}-${line}`}>
            <span aria-hidden>{index + 1}</span>
            <code>{highlightedLine(line)}</code>
          </span>
        ))}
      </pre>
    </section>
  );
}
