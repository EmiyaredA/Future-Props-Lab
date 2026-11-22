import type { PromptRenderDocument } from "./promptRendering";
import type { H3Selection } from "./h3PromptSelection";

export type H3ProtectedRange = H3Selection & {
  kind: "field" | "marker" | "hidden";
};

/** Field names and their minimum line separators are not editable body text. */
export function h3ProtectedSource(
  document: PromptRenderDocument,
  value: string,
): H3ProtectedRange[] {
  const ranges: H3ProtectedRange[] = [];
  let cursor = 0;
  for (const section of document.sections) {
    const start = cursor;
    const headingEnd = start + section.heading.length;
    cursor =
      headingEnd +
      section.blocks.reduce(
        (sum, block) =>
          sum +
          block.tokens.reduce((length, token) => length + token.text.length, 0),
        0,
      );
    if (section.hidden) ranges.push({ start, end: cursor, kind: "hidden" });
    else if (section.field && section.heading) {
      let before = start;
      if (value[before - 1] === "\n")
        before -= value[before - 2] === "\r" ? 2 : 1;
      else if (value[before - 1] === "\r") before -= 1;
      const separator =
        /^[ \t]*(?:\r\n|\r|\n)/.exec(value.slice(headingEnd))?.[0].length ?? 0;
      ranges.push({
        start: before,
        end: headingEnd + separator,
        kind: "field",
      });
    }
    if (section.hidden) continue;
    let position = headingEnd;
    for (const token of section.blocks.flatMap((block) => block.tokens)) {
      if (token.kind === "dialogue") {
        let childStart = position;
        for (const child of token.children ?? []) {
          if (
            child.kind === "marker" &&
            (child.text === "<d>" || child.text === "</d>")
          )
            ranges.push({
              start: childStart,
              end: childStart + child.text.length,
              kind: "marker",
            });
          childStart += child.text.length;
        }
      }
      position += token.text.length;
    }
  }
  const merged: H3ProtectedRange[] = [];
  for (const range of ranges.sort(
    (first, second) => first.start - second.start,
  )) {
    const last = merged.at(-1);
    if (last && range.kind === last.kind && range.start < last.end)
      last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function editH3Source(
  value: string,
  selection: H3Selection,
  text: string,
  protectedRanges: H3Selection[],
  wholePrompt = false,
) {
  let { start, end } = selection;
  start = Math.max(0, Math.min(start, value.length));
  end = Math.max(start, Math.min(end, value.length));
  if (wholePrompt || (start === 0 && end === value.length))
    return {
      value: value.slice(0, start) + text + value.slice(end),
      caret: start + text.length,
    };
  if (start === end) {
    const field = protectedRanges.find(
      (range) => start > range.start && start < range.end,
    );
    if (field) start = end = field.end;
  } else {
    for (const range of protectedRanges) {
      if (start > range.start && start < range.end) start = range.end;
      if (end > range.start && end < range.end) end = range.start;
    }
    end = Math.max(start, end);
  }
  const preserved = protectedRanges
    .filter((range) => range.start < end && range.end > start)
    .map((range) =>
      value.slice(Math.max(start, range.start), Math.min(end, range.end)),
    )
    .join("");
  return {
    value: value.slice(0, start) + text + preserved + value.slice(end),
    caret: start + text.length,
  };
}
