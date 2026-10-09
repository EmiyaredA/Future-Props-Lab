import type { ReactNode } from "react";
import type { components } from "@generated/api";

type Block = components["schemas"]["SnapshotBlock"];
type Run = components["schemas"]["SnapshotRun"];

function Runs({ runs }: { runs: Run[] }) {
  return runs.map((run, index) => {
    let text: ReactNode = run.text;
    if (run.style?.inline_code) text = <code>{text}</code>;
    if (run.style?.bold) text = <strong>{text}</strong>;
    if (run.style?.italic) text = <em>{text}</em>;
    if (run.style?.strikethrough) text = <s>{text}</s>;
    if (run.style?.underline) text = <u>{text}</u>;
    return <span key={index}>{text}</span>;
  });
}

function Blocks({ blocks }: { blocks: Block[] }) {
  const items = [];
  for (let index = 0; index < blocks.length;) {
    const kind = blocks[index].kind;
    if (kind === "bullet" || kind === "ordered" || kind === "todo") {
      const group = [];
      while (index < blocks.length && blocks[index].kind === kind) {
        group.push(blocks[index]);
        index += 1;
      }
      const List = kind === "ordered" ? "ol" : "ul";
      items.push(
        <List key={index} className={kind === "todo" ? "is-todo" : undefined}>
          {group.map((block, item) => (
            <li key={item}>
              {kind === "todo" ? (block.checked ? "☑ " : "☐ ") : null}
              <Runs runs={block.runs ?? []} />
            </li>
          ))}
        </List>,
      );
      continue;
    }
    items.push(<BlockView key={index} block={blocks[index]} />);
    index += 1;
  }
  return items;
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === "heading") {
    const level = Math.min(4, Math.max(1, block.level ?? 1));
    const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";
    return (
      <Tag>
        <Runs runs={block.runs ?? []} />
      </Tag>
    );
  }
  if (block.kind === "quote") {
    return (
      <blockquote>
        <Runs runs={block.runs ?? []} />
      </blockquote>
    );
  }
  if (block.kind === "code") {
    return (
      <pre>
        <Runs runs={block.runs ?? []} />
      </pre>
    );
  }
  if (block.kind === "image") return <p className="is-image">图片</p>;
  if (block.kind === "table") {
    return (
      <table>
        <tbody>
          {(block.rows ?? []).map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td key={cellIndex}>
                  <Blocks blocks={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  return (
    <p>
      <Runs runs={block.runs ?? []} />
    </p>
  );
}

export function SnapshotView({ blocks }: { blocks: Block[] }) {
  return (
    <div className="article-sync-snapshot" aria-label="写入快照">
      <Blocks blocks={blocks} />
    </div>
  );
}
