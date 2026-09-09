import type { JSONContent } from "@tiptap/core";

export type HistoryMark = {
  from: number;
  to: number;
  kind: "added" | "deleted" | "format";
  block?: boolean;
};
export type HistoryDiff = { document: JSONContent; marks: HistoryMark[] };
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const size = (node: JSONContent): number =>
  node.type === "text"
    ? (node.text?.length ?? 0)
    : node.content
      ? 2 + node.content.reduce((n, child) => n + size(child), 0)
      : [
            "image",
            "attachment",
            "blockMath",
            "inlineMath",
            "hardBreak",
            "horizontalRule",
            "mermaid",
          ].includes(node.type ?? "")
        ? 1
        : 2;
const text = (node: JSONContent) =>
  (node.content ?? []).map((n) => n.text ?? "").join("");
const plain = (node: JSONContent) =>
  ["paragraph", "heading"].includes(node.type ?? "") &&
  (node.content ?? []).every((n) => n.type === "text");
function slice(nodes: JSONContent[], from: number, to: number): JSONContent[] {
  let pos = 0;
  return nodes.flatMap((node) => {
    const end = pos + (node.text?.length ?? 0);
    const value = (node.text ?? "").slice(
      Math.max(0, from - pos),
      Math.max(0, to - pos),
    );
    const overlap = pos < to && end > from;
    pos = end;
    return overlap && value ? [{ ...node, text: value }] : [];
  });
}

/** Bounded block alignment; preview-only data never becomes an editable document. */
export function historyDiff(
  current: JSONContent,
  previous?: JSONContent | null,
): HistoryDiff {
  if (!previous) return { document: current, marks: [] };
  const before = previous.content ?? [],
    after = current.content ?? [];
  const blocks: JSONContent[] = [],
    marks: HistoryMark[] = [];
  let pos = 0;
  function append(node: JSONContent, kind?: HistoryMark["kind"]) {
    const length = size(node);
    blocks.push(node);
    if (kind) marks.push({ from: pos, to: pos + length, kind, block: true });
    pos += length;
  }
  function pair(old: JSONContent, next: JSONContent) {
    if (equal(old, next)) {
      append(next);
      return;
    }
    if (
      plain(old) &&
      plain(next) &&
      old.type === next.type &&
      equal(old.attrs, next.attrs)
    ) {
      const a = text(old),
        b = text(next);
      if (a === b) {
        append(old, "deleted");
        append(next, "format");
        return;
      }
      let start = 0,
        end = 0;
      while (start < Math.min(a.length, b.length) && a[start] === b[start])
        start++;
      while (
        end < Math.min(a.length, b.length) - start &&
        a[a.length - end - 1] === b[b.length - end - 1]
      )
        end++;
      // Keep surrogate pairs intact when highlighting emoji changes.
      if (start && /[\uD800-\uDBFF]/.test(a[start - 1])) start--;
      if (end && /[\uDC00-\uDFFF]/.test(a[a.length - end])) end--;
      // A text edit can also restyle unchanged text. Show both full blocks
      // instead of silently applying the new marks to the shared prefix/suffix.
      if (
        !equal(
          slice(old.content ?? [], 0, start),
          slice(next.content ?? [], 0, start),
        ) ||
        !equal(
          slice(old.content ?? [], a.length - end, a.length),
          slice(next.content ?? [], b.length - end, b.length),
        )
      ) {
        append(old, "deleted");
        append(next, "format");
        return;
      }
      const deleted = a.length - start - end,
        added = b.length - start - end;
      const node = {
        ...next,
        content: [
          ...slice(next.content ?? [], 0, start),
          ...slice(old.content ?? [], start, a.length - end),
          ...slice(next.content ?? [], start, b.length),
        ],
      };
      const offset = pos + 1 + start;
      if (deleted)
        marks.push({ from: offset, to: offset + deleted, kind: "deleted" });
      if (added)
        marks.push({
          from: offset + deleted,
          to: offset + deleted + added,
          kind: "added",
        });
      append(node);
    } else {
      append(old, "deleted");
      append(next, "added");
    }
  }
  // Exact blocks anchor nearby replacements, including table and attachment nodes.
  const matches: [number, number][] = [];
  if (before.length * after.length <= 160000) {
    const keysA = before.map((n) => JSON.stringify(n)),
      keysB = after.map((n) => JSON.stringify(n));
    const matrix = Array.from(
      { length: before.length + 1 },
      () => new Uint32Array(after.length + 1),
    );
    for (let a = before.length - 1; a >= 0; a--)
      for (let b = after.length - 1; b >= 0; b--)
        matrix[a][b] =
          keysA[a] === keysB[b]
            ? 1 + matrix[a + 1][b + 1]
            : Math.max(matrix[a + 1][b], matrix[a][b + 1]);
    let a = 0,
      b = 0;
    while (a < before.length && b < after.length) {
      if (keysA[a] === keysB[b]) {
        matches.push([a++, b++]);
      } else if (matrix[a + 1][b] >= matrix[a][b + 1]) a++;
      else b++;
    }
  }
  matches.push([before.length, after.length]);
  let a = 0,
    b = 0;
  for (const [ai, bi] of matches) {
    while (a < ai && b < bi) pair(before[a++], after[b++]);
    while (a < ai) append(before[a++], "deleted");
    while (b < bi) append(after[b++], "added");
    if (ai < before.length) {
      append(after[bi]);
      a++;
      b++;
    }
  }
  return { document: { ...current, content: blocks }, marks };
}
